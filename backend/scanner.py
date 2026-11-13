"""Market Scanner — scan stocks for gaps, volume spikes, breakouts, and more."""

from backend.brokers.market_data_provider import Ticker
from backend.stock_list import get_nifty_50, get_nifty_100, get_bse_250
import numpy as np
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from tradingagents.utils.ticker import normalize_ticker

# --- Stock Universes — all from CSV via stock_list ---
NIFTY_50 = get_nifty_50()
NIFTY_100 = get_nifty_100()
BSE_250 = get_bse_250()

UNIVERSES = {
    "nifty50": NIFTY_50,
    "nifty100": NIFTY_100,
    "bse250": BSE_250,
}


def _to_native(val):
    """Convert numpy types to native Python types for JSON serialization."""
    if hasattr(val, 'item'):
        return val.item()
    return val


def _fetch_stock_data(ticker: str, period: str = "3mo") -> dict | None:
    """Fetch OHLCV data for a single stock."""
    try:
        symbol = f"{ticker}.NS"
        t = Ticker(symbol)
        hist = t.history(period=period)
        if hist.empty or len(hist) < 5:
            return None
        return {
            "ticker": ticker,
            "symbol": symbol,
            "hist": hist,
            "current_close": _to_native(hist.iloc[-1]["Close"]),
            "current_volume": _to_native(hist.iloc[-1]["Volume"]),
            "current_open": _to_native(hist.iloc[-1]["Open"]),
            "current_high": _to_native(hist.iloc[-1]["High"]),
            "current_low": _to_native(hist.iloc[-1]["Low"]),
            "prev_close": _to_native(hist.iloc[-2]["Close"]),
            "prev_volume": _to_native(hist.iloc[-2]["Volume"]),
        }
    except Exception:
        return None


def scan_gaps(stocks_data: list[dict], threshold_pct: float = 2.0) -> list[dict]:
    """Find stocks that gapped up or down from previous close."""
    results = []
    for d in stocks_data:
        gap_pct = ((d["current_open"] - d["prev_close"]) / d["prev_close"]) * 100
        if abs(gap_pct) >= threshold_pct:
            results.append({
                "ticker": d["ticker"],
                "symbol": d["symbol"],
                "price": round(d["current_close"], 2),
                "gap_pct": round(gap_pct, 2),
                "direction": "UP" if gap_pct > 0 else "DOWN",
                "prev_close": round(d["prev_close"], 2),
                "open": round(d["current_open"], 2),
                "filled": bool(d["current_close"] <= d["prev_close"] if gap_pct > 0 else d["current_close"] >= d["prev_close"]),
            })
    results.sort(key=lambda x: abs(x["gap_pct"]), reverse=True)
    return results


def scan_volume_spikes(stocks_data: list[dict], multiplier: float = 2.0) -> list[dict]:
    """Find stocks with volume significantly above average."""
    results = []
    for d in stocks_data:
        hist = d["hist"]
        avg_volume = hist["Volume"].iloc[:-1].mean()
        if avg_volume == 0:
            continue
        vol_ratio = d["current_volume"] / avg_volume
        if vol_ratio >= multiplier:
            price_change = ((d["current_close"] - d["prev_close"]) / d["prev_close"]) * 100
            results.append({
                "ticker": d["ticker"],
                "symbol": d["symbol"],
                "price": round(d["current_close"], 2),
                "change_pct": round(price_change, 2),
                "volume": d["current_volume"],
                "avg_volume": int(avg_volume),
                "volume_ratio": round(vol_ratio, 1),
                "direction": "BULLISH" if price_change > 0 else "BEARISH",
            })
    results.sort(key=lambda x: x["volume_ratio"], reverse=True)
    return results


def scan_breakouts(stocks_data: list[dict], lookback_days: int = 20) -> list[dict]:
    """Find stocks breaking above N-day high with volume confirmation."""
    results = []
    for d in stocks_data:
        hist = d["hist"]
        if len(hist) < lookback_days + 1:
            continue

        # Previous N-day high (excluding today)
        prev_highs = hist["High"].iloc[-(lookback_days + 1):-1]
        n_day_high = float(prev_highs.max())

        # Check if today broke above it
        if d["current_high"] > n_day_high:
            avg_volume = hist["Volume"].iloc[-(lookback_days + 1):-1].mean()
            vol_ratio = d["current_volume"] / avg_volume if avg_volume > 0 else 1

            breakout_pct = ((d["current_close"] - n_day_high) / n_day_high) * 100
            results.append({
                "ticker": d["ticker"],
                "symbol": d["symbol"],
                "price": round(d["current_close"], 2),
                "breakout_level": round(n_day_high, 2),
                "breakout_pct": round(breakout_pct, 2),
                "lookback_days": lookback_days,
                "volume_ratio": round(vol_ratio, 1),
                "volume_confirmed": bool(vol_ratio >= 1.5),
            })
    results.sort(key=lambda x: x["breakout_pct"], reverse=True)
    return results


def run_scan(
    universe: str = "nifty50",
    strategies: list[str] = None,
    gap_threshold: float = 2.0,
    volume_multiplier: float = 2.0,
    breakout_lookback: int = 20,
    on_progress=None,
) -> dict:
    """Run market scan across a stock universe.

    Args:
        universe: "nifty50", "nifty100", or "bse250"
        strategies: List of strategies to run: "gap", "volume", "breakout"
        on_progress: Callback(message) for progress updates

    Returns:
        Dict with scan results per strategy
    """
    if strategies is None:
        strategies = ["gap", "volume", "breakout"]

    stocks = UNIVERSES.get(universe, NIFTY_50)

    if on_progress:
        on_progress(f"Scanning {len(stocks)} stocks from {universe.upper()}...")

    # Fetch data in parallel
    stocks_data = []
    failed = 0

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(_fetch_stock_data, ticker): ticker for ticker in stocks}
        for i, future in enumerate(as_completed(futures)):
            result = future.result()
            if result:
                stocks_data.append(result)
            else:
                failed += 1
            if on_progress and (i + 1) % 20 == 0:
                on_progress(f"  Fetched {i + 1}/{len(stocks)} stocks...")

    if on_progress:
        on_progress(f"Data fetched: {len(stocks_data)} OK, {failed} failed")

    results = {}

    if "gap" in strategies:
        results["gap"] = scan_gaps(stocks_data, gap_threshold)
        if on_progress:
            on_progress(f"Gap scan: {len(results['gap'])} stocks with >{gap_threshold}% gap")

    if "volume" in strategies:
        results["volume"] = scan_volume_spikes(stocks_data, volume_multiplier)
        if on_progress:
            on_progress(f"Volume scan: {len(results['volume'])} stocks with >{volume_multiplier}x avg volume")

    if "breakout" in strategies:
        results["breakout"] = scan_breakouts(stocks_data, breakout_lookback)
        if on_progress:
            on_progress(f"Breakout scan: {len(results['breakout'])} stocks breaking {breakout_lookback}-day high")

    return {
        "universe": universe,
        "total_stocks": len(stocks),
        "scanned": len(stocks_data),
        "results": results,
    }
