"""DhanHQ v2 market data API integration.

This module provides market data (charts, quotes, search, fundamentals, news)
using the DhanHQ paid API, replacing Yahoo Finance for users with a Dhan subscription.

Dhan's API accepts trading symbols directly and resolves security IDs internally,
so no manual symbol-to-ID mapping is needed.
"""

from __future__ import annotations

import csv
import json
import os
import threading
from datetime import datetime, timedelta
from typing import Any

import requests

from backend.brokers.dhan import (
    API_BASE_URL,
    DhanAuthExpired,
    DhanConfigError,
    _access_token,
    _access_token_date,
    _client_id,
    _today,
    clear_dhan_access_token,
)

REQUEST_TIMEOUT_SECONDS = 30


class DhanMarketDataError(RuntimeError):
    """Raised when Dhan market data API fails."""


def _get_headers() -> dict[str, str]:
    """Get authentication headers for Dhan API."""
    access_token = _access_token()
    client_id = _client_id()
    if not access_token or not client_id:
        raise DhanConfigError("Dhan login is required for market data access")
    return {
        "access-token": access_token,
        "client-id": client_id,
        "Content-type": "application/json",
        "Accept": "application/json",
    }


def _api_request(method: str, path: str, *, params=None, json_body=None) -> Any:
    """Make a request to Dhan market data API."""
    url = f"{API_BASE_URL}{path}"
    headers = _get_headers()
    try:
        response = requests.request(
            method, url, headers=headers, params=params, json=json_body,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise DhanMarketDataError("Dhan market data API is unreachable") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = None

    if 200 <= response.status_code < 300:
        if payload is None:
            raise DhanMarketDataError("Dhan API returned an invalid response")
        return payload

    error_code = payload.get("errorCode") if isinstance(payload, dict) else None
    if response.status_code == 401 or error_code == "DH-901":
        clear_dhan_access_token()
        raise DhanAuthExpired("Dhan session expired. Please connect Dhan again.")
    raise DhanMarketDataError(f"Dhan API request failed ({response.status_code})")


# Dhan's v2 market data endpoints require an integer security ID; the trading
# symbol alone is not accepted. The authoritative symbol -> security ID mapping
# is Dhan's scrip master CSV, downloaded once and cached to disk (and in memory)
# so the paid API is not hammered for a symbol lookup on every request.
SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv"

# symbol (upper, no suffix) -> {"NSE_EQ": security_id, "BSE_EQ": security_id}
_security_map: dict[str, dict[str, str]] | None = None
_security_map_lock = threading.Lock()


def _scrip_master_cache_path() -> str:
    home = os.getenv("TRADINGAGENTS_HOME")
    if not home:
        home = os.path.join(os.path.expanduser("~"), ".tradingagents")
    return os.path.join(home, "dhan_security_map.json")


def _download_scrip_master() -> dict[str, dict[str, str]]:
    """Download Dhan's scrip master CSV and build symbol -> exchange -> security_id."""
    tmp_csv = f"{_scrip_master_cache_path()}.csv.tmp"
    with requests.get(SCRIP_MASTER_URL, timeout=60, stream=True) as response:
        response.raise_for_status()
        with open(tmp_csv, "wb") as fh:
            for chunk in response.iter_content(chunk_size=1 << 20):
                fh.write(chunk)

    mapping: dict[str, dict[str, str]] = {}
    try:
        with open(tmp_csv, "r", encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                # Equity rows carry the trading symbol in UNDERLYING_SYMBOL;
                # SYMBOL_NAME is the company display name for cash equities.
                if row.get("INSTRUMENT") != "EQUITY":
                    continue
                symbol = (row.get("UNDERLYING_SYMBOL") or "").strip().upper()
                security_id = (row.get("SECURITY_ID") or "").strip()
                exchange = (row.get("EXCH_ID") or "").strip().upper()
                if not symbol or not security_id or exchange not in ("NSE", "BSE"):
                    continue
                segment = "NSE_EQ" if exchange == "NSE" else "BSE_EQ"
                mapping.setdefault(symbol, {})[segment] = security_id
    finally:
        try:
            os.remove(tmp_csv)
        except OSError:
            pass
    return mapping


def _load_security_map() -> dict[str, dict[str, str]]:
    global _security_map
    if _security_map is not None:
        return _security_map
    with _security_map_lock:
        if _security_map is not None:
            return _security_map

        cache_path = _scrip_master_cache_path()
        try:
            if os.path.exists(cache_path):
                with open(cache_path, "r", encoding="utf-8") as fh:
                    _security_map = json.load(fh)
        except (OSError, ValueError):
            _security_map = None

        if not _security_map:
            try:
                mapping = _download_scrip_master()
            except Exception:
                mapping = {}
            _security_map = mapping
            if mapping:
                try:
                    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                    tmp_path = f"{cache_path}.tmp"
                    with open(tmp_path, "w", encoding="utf-8") as fh:
                        json.dump(mapping, fh)
                    os.replace(tmp_path, cache_path)
                except OSError:
                    pass

    return _security_map


def _resolve_security(ticker: str) -> tuple[str, str] | None:
    """Resolve a ticker (e.g. 'RELIANCE.NS' or 'RELIANCE') to (security_id, exchange_segment)."""
    raw = (ticker or "").strip().upper()
    prefer_bse = raw.endswith(".BO")
    symbol = _ticker_to_symbol(raw)

    entry = _load_security_map().get(symbol)
    if not entry:
        return None

    if prefer_bse and entry.get("BSE_EQ"):
        return entry["BSE_EQ"], "BSE_EQ"
    if entry.get("NSE_EQ"):
        return entry["NSE_EQ"], "NSE_EQ"
    if entry.get("BSE_EQ"):
        return entry["BSE_EQ"], "BSE_EQ"
    return None


def get_symbol_info_cached(symbol: str) -> dict | None:
    """Return security-id info for a symbol (kept as a small compatibility helper)."""
    entry = _load_security_map().get(_ticker_to_symbol(symbol))
    if not entry:
        return None
    segment = "NSE_EQ" if entry.get("NSE_EQ") else "BSE_EQ"
    security_id = entry.get(segment)
    if not security_id:
        return None
    return {"security_id": security_id, "symbol": _ticker_to_symbol(symbol), "exchange": segment}


def _ticker_to_symbol(ticker: str) -> str:
    """Convert ticker (e.g., 'RELIANCE.NS') to Dhan symbol format ('RELIANCE')."""
    symbol = ticker.strip().upper()
    if symbol.endswith(".NS"):
        symbol = symbol[:-3]
    elif symbol.endswith(".BO"):
        symbol = symbol[:-3]
    return symbol


def _get_exchange_segment(ticker: str) -> str:
    """Determine exchange segment from ticker suffix."""
    if ticker.endswith(".BO"):
        return "BSE_EQ"
    return "NSE_EQ"


# --- Market Data Functions ---

def get_quote(ticker: str) -> dict:
    """Get real-time quote for a ticker using Dhan market feed API."""
    resolved = _resolve_security(ticker)
    if not resolved:
        raise DhanMarketDataError(f"No Dhan security ID for {ticker}")
    security_id, exchange = resolved
    symbol = _ticker_to_symbol(ticker)

    payload = {
        exchange: [int(security_id)],
        "dhanClientId": _client_id(),
    }

    response = _api_request("POST", "/marketfeed/quote", json_body=payload)
    data = response.get("data", {})

    # Response is keyed by security ID
    segment_data = data.get(exchange, {})
    if not segment_data:
        raise DhanMarketDataError(f"No quote data for {ticker}")

    # Get the first (and only) quote from the response
    quote_data = next(iter(segment_data.values()), {})
    if not quote_data:
        raise DhanMarketDataError(f"No quote data for {ticker}")

    ohlc = quote_data.get("ohlc", {})
    last_price = quote_data.get("last_price", 0)

    return {
        "ticker": ticker,
        "symbol": symbol,
        "price": last_price,
        "open": ohlc.get("open", 0),
        "high": ohlc.get("high", 0),
        "low": ohlc.get("low", 0),
        "close": ohlc.get("close", 0),
    }


def _historical_request(ticker: str, period: str, interval: str):
    """Resolve a ticker and issue the matching Dhan v2 historical/candle request.

    Returns the raw JSON payload from Dhan. Daily candles come from
    POST /charts/historical and intraday candles from POST /charts/intraday —
    both keyed by integer security ID, not trading symbol.
    """
    resolved = _resolve_security(ticker)
    if not resolved:
        raise DhanMarketDataError(f"No Dhan security ID for {ticker}")
    security_id, exchange = resolved

    period_map = {
        "1d": 1, "5d": 5, "1mo": 30, "3mo": 90, "6mo": 180,
        "1y": 365, "2y": 730, "5y": 1825,
    }
    end_date = datetime.now()
    start_date = end_date - timedelta(days=period_map.get(period, 90))

    payload = {
        "securityId": int(security_id),
        "exchangeSegment": exchange,
        "instrument": "EQUITY",
        "fromDate": start_date.strftime("%Y-%m-%d"),
        "toDate": end_date.strftime("%Y-%m-%d"),
        "oi": False,
        "dhanClientId": _client_id(),
    }

    is_intraday = interval in ("1m", "5m", "15m", "30m", "1h")
    if is_intraday:
        payload["interval"] = {"1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60"}.get(interval, "5")
        endpoint = "/charts/intraday"
    else:
        payload["expiryCode"] = 0
        endpoint = "/charts/historical"

    return _api_request("POST", endpoint, json_body=payload)


def _parse_ohlc(response: Any) -> list[dict]:
    """Parse Dhan's parallel-array candle response into a list of OHLCV rows.

    Dhan returns open/high/low/close/volume/timestamp as sibling arrays.
    """
    payload = response.get("data", response) if isinstance(response, dict) else response
    if not isinstance(payload, dict):
        return []

    opens = payload.get("open") or []
    highs = payload.get("high") or []
    lows = payload.get("low") or []
    closes = payload.get("close") or []
    volumes = payload.get("volume") or []
    stamps = payload.get("timestamp") or []

    rows = []
    for i in range(min(len(opens), len(highs), len(lows), len(closes), len(stamps))):
        try:
            ts = float(stamps[i])
            dt = datetime.fromtimestamp(ts / 1000 if ts > 1e10 else ts)
        except (TypeError, ValueError, OverflowError):
            continue
        rows.append({
            "Date": dt,
            "Open": float(opens[i]),
            "High": float(highs[i]),
            "Low": float(lows[i]),
            "Close": float(closes[i]),
            "Volume": int(float(volumes[i]) if volumes[i] is not None else 0),
        })
    return rows


def get_chart_data(
    ticker: str,
    period: str = "3mo",
    interval: str = "1d",
) -> dict:
    """Get OHLCV chart data for a ticker using Dhan HQ v2."""
    response = _historical_request(ticker, period, interval)

    daily = interval in ("1d", "1wk", "1mo")
    data = []
    for row in _parse_ohlc(response):
        data.append({
            "time": row["Date"].strftime("%Y-%m-%d") if daily else row["Date"].isoformat(),
            "open": round(row["Open"], 2),
            "high": round(row["High"], 2),
            "low": round(row["Low"], 2),
            "close": round(row["Close"], 2),
            "volume": row["Volume"],
        })

    return {
        "ticker": ticker,
        "period": period,
        "interval": interval,
        "data": data,
    }


def search_stocks(query: str, limit: int = 10) -> list[dict]:
    """Search stocks by ticker or company name.
    
    Uses the local stock list for search since Dhan doesn't provide a search API.
    The actual market data is fetched from Dhan using symbols directly.
    """
    # Use the existing stock_list module for search
    from backend.stock_list import search_stocks as local_search
    return local_search(query, limit)


def get_fundamentals(ticker: str) -> dict:
    """Get company fundamentals using Dhan Company Info API.
    
    Dhan's company info endpoint accepts trading symbols directly.
    """
    symbol = _ticker_to_symbol(ticker)
    exchange = _get_exchange_segment(ticker)

    # Try company info endpoint with symbol. Dhan's v2 API does not expose a
    # working company-info endpoint, so a failure here should propagate and let
    # the caller fall back to the full fundamentals source.
    try:
        params = {
            "trading_symbol": symbol,
            "exchange_segment": exchange,
        }
        response = _api_request("GET", "/company-info", params=params)
    except DhanMarketDataError:
        raise DhanMarketDataError(f"Fundamentals unavailable for {ticker}")

    data = response.get("data", response) if isinstance(response, dict) else response

    return {
        "ticker": ticker,
        "name": data.get("companyName") or data.get("name") or symbol,
        "sector": data.get("sector") or data.get("industry"),
        "industry": data.get("industry"),
        "market_cap": data.get("marketCap") or data.get("market_cap"),
        "pe_ratio": data.get("peRatio") or data.get("pe_ratio"),
        "forward_pe": data.get("forwardPe") or data.get("forward_pe"),
        "pb_ratio": data.get("priceToBook") or data.get("pb_ratio"),
        "dividend_yield": data.get("dividendYield") or data.get("dividend_yield"),
        "eps": data.get("eps"),
        "roe": data.get("roe") or data.get("returnOnEquity"),
        "debt_to_equity": data.get("debtToEquity") or data.get("debt_to_equity"),
        "revenue": data.get("revenue") or data.get("totalRevenue"),
        "profit_margin": data.get("profitMargin") or data.get("profit_margin"),
        "fifty_two_week_high": data.get("high52Week") or data.get("fifty_two_week_high"),
        "fifty_two_week_low": data.get("low52Week") or data.get("fifty_two_week_low"),
        "avg_volume": data.get("avgVolume") or data.get("avg_volume"),
        "beta": data.get("beta"),
    }


def get_news(ticker: str | None = None, count: int = 10) -> list[dict]:
    """Get news headlines using Dhan News API.
    
    Dhan's news endpoint accepts trading symbols directly.
    """
    try:
        if ticker:
            symbol = _ticker_to_symbol(ticker)
            exchange = _get_exchange_segment(ticker)
            params = {
                "trading_symbol": symbol,
                "exchange_segment": exchange,
                "count": count,
            }
        else:
            params = {"count": count}

        response = _api_request("GET", "/news", params=params)
        news_data = response.get("data", []) if isinstance(response, dict) else response

        articles = []
        if isinstance(news_data, list):
            for article in news_data[:count]:
                if isinstance(article, dict):
                    articles.append({
                        "title": article.get("headline") or article.get("title", ""),
                        "summary": article.get("summary") or article.get("description", ""),
                        "publisher": article.get("source") or article.get("publisher", "Unknown"),
                        "url": article.get("url") or article.get("link", ""),
                        "published_at": article.get("publishedAt") or article.get("date", ""),
                    })

        return articles

    except DhanMarketDataError:
        return []


def get_market_status() -> dict:
    """Get current market status using Dhan API.
    
    Dhan's quote endpoint accepts index symbols directly.
    """
    from tradingagents.utils.market_calendar import get_market_session, is_trading_day

    # Try to get NIFTY and BANKNIFTY quotes
    nifty_data = {"price": 0, "change": 0, "change_percent": 0}
    banknifty_data = {"price": 0, "change": 0, "change_percent": 0}

    try:
        # NIFTY 50 index - Dhan accepts symbol names directly
        payload = {"NSE_INDEX": ["NIFTY"], "dhanClientId": _client_id()}
        response = _api_request("POST", "/marketfeed/quote", json_body=payload)
        data = response.get("data", {}).get("NSE_INDEX", {})
        quote = next(iter(data.values()), {}) if data else {}
        if quote:
            nifty_data["price"] = quote.get("last_price", 0)
            ohlc = quote.get("ohlc", {})
            nifty_data["change"] = round(nifty_data["price"] - ohlc.get("close", 0), 2)
            close = ohlc.get("close", 1)
            nifty_data["change_percent"] = round((nifty_data["change"] / close) * 100, 2) if close else 0
    except Exception:
        pass

    try:
        # BANKNIFTY index
        payload = {"NSE_INDEX": ["BANKNIFTY"], "dhanClientId": _client_id()}
        response = _api_request("POST", "/marketfeed/quote", json_body=payload)
        data = response.get("data", {}).get("NSE_INDEX", {})
        quote = next(iter(data.values()), {}) if data else {}
        if quote:
            banknifty_data["price"] = quote.get("last_price", 0)
            ohlc = quote.get("ohlc", {})
            banknifty_data["change"] = round(banknifty_data["price"] - ohlc.get("close", 0), 2)
            close = ohlc.get("close", 1)
            banknifty_data["change_percent"] = round((banknifty_data["change"] / close) * 100, 2) if close else 0
    except Exception:
        pass

    return {
        "session": get_market_session(),
        "is_trading_day": is_trading_day(),
        "nifty": nifty_data,
        "banknifty": banknifty_data,
        "source": "dhan",
    }


def is_dhan_available() -> bool:
    """Check if Dhan market data API is available (user logged in today)."""
    access_token = _access_token()
    token_date = _access_token_date()
    return bool(access_token and token_date == _today())


# --- Pandas-compatible helpers for drop-in yfinance replacement ---

def get_history_as_dataframe(
    ticker: str,
    period: str = "1mo",
    interval: str = "1d",
    start: str | None = None,
    end: str | None = None,
) -> "pd.DataFrame":
    """Get historical data as a pandas DataFrame (yfinance-compatible).

    Returns DataFrame with columns: Open, High, Low, Close, Volume
    Index is DatetimeIndex.
    """
    import pandas as pd

    resolved = _resolve_security(ticker)
    if not resolved:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    security_id, exchange = resolved

    if start and end:
        def _to_datetime(value):
            if isinstance(value, datetime):
                return value
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))

        start_date = _to_datetime(start)
        end_date = _to_datetime(end)
    else:
        end_date = datetime.now()
        period_map = {
            "1d": 1, "5d": 5, "1mo": 30, "3mo": 90, "6mo": 180,
            "1y": 365, "2y": 730, "5y": 1825, "max": 3650,
        }
        days = period_map.get(period, 30)
        start_date = end_date - timedelta(days=days)

    is_intraday = interval in ("1m", "5m", "15m", "30m", "1h")

    payload = {
        "securityId": int(security_id),
        "exchangeSegment": exchange,
        "instrument": "EQUITY",
        "fromDate": start_date.strftime("%Y-%m-%d"),
        "toDate": end_date.strftime("%Y-%m-%d"),
        "oi": False,
        "dhanClientId": _client_id(),
    }
    if is_intraday:
        payload["interval"] = {"1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60"}.get(interval, "5")
        endpoint = "/charts/intraday"
    else:
        payload["expiryCode"] = 0
        endpoint = "/charts/historical"

    try:
        response = _api_request("POST", endpoint, json_body=payload)
    except DhanMarketDataError:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    rows = _parse_ohlc(response)
    if not rows:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    df = pd.DataFrame(rows)
    df.set_index("Date", inplace=True)
    df.index = pd.to_datetime(df.index)
    return df[["Open", "High", "Low", "Close", "Volume"]]
def get_ticker_info(ticker: str) -> dict:
    """Get ticker info (yfinance-compatible).

    Returns dict with keys like: shortName, sector, industry, marketCap, etc.
    """
    fundamentals = get_fundamentals(ticker)
    # Map to yfinance-compatible format
    return {
        "shortName": fundamentals.get("name", _ticker_to_symbol(ticker)),
        "longName": fundamentals.get("name", _ticker_to_symbol(ticker)),
        "sector": fundamentals.get("sector"),
        "industry": fundamentals.get("industry"),
        "marketCap": fundamentals.get("market_cap"),
        "trailingPE": fundamentals.get("pe_ratio"),
        "forwardPE": fundamentals.get("forward_pe"),
        "priceToBook": fundamentals.get("pb_ratio"),
        "dividendYield": fundamentals.get("dividend_yield"),
        "trailingEps": fundamentals.get("eps"),
        "returnOnEquity": fundamentals.get("roe"),
        "debtToEquity": fundamentals.get("debt_to_equity"),
        "totalRevenue": fundamentals.get("revenue"),
        "profitMargins": fundamentals.get("profit_margin"),
        "fiftyTwoWeekHigh": fundamentals.get("fifty_two_week_high"),
        "fiftyTwoWeekLow": fundamentals.get("fifty_two_week_low"),
        "averageVolume": fundamentals.get("avg_volume"),
        "beta": fundamentals.get("beta"),
        "previousClose": fundamentals.get("close"),
    }


def get_sector_for_symbol(symbol: str) -> str | None:
    """Dhan's v2 API has no sector/industry endpoint; sector data is unavailable here.

    Sector membership is maintained locally in backend.cyclical.SECTOR_MAP.
    """
    return None


def get_sector_map_for_symbols(symbols: list[str]) -> dict[str, str]:
    """Return an empty map — Dhan has no symbol -> sector API."""
    return {}
