"""Market data endpoints — stock quotes, charts, indicators, fundamentals, news.

Uses DhanHQ v2 API for market data when the user has a paid Dhan subscription.
Falls back to Yahoo Finance if Dhan is not configured or unavailable.
"""

from functools import lru_cache

from fastapi import APIRouter, Query, HTTPException
import yfinance as yf
from datetime import datetime, timedelta
from tradingagents.utils.ticker import normalize_ticker

from backend.brokers.dhan_market_data import (
    DhanMarketDataError,
    is_dhan_available,
    get_chart_data as dhan_get_chart_data,
    get_fundamentals as dhan_get_fundamentals,
    get_news as dhan_get_news,
    get_quote as dhan_get_quote,
    search_stocks as dhan_search_stocks,
)

router = APIRouter(prefix="/api/market-data", tags=["market-data"])


def _use_dhan() -> bool:
    """Check if Dhan market data should be used (paid API available)."""
    return is_dhan_available()


@lru_cache(maxsize=256)
def _yahoo_nse_search(query: str) -> list:
    """Look up NSE-listed equities by name or ticker via Yahoo's search (same
    source as price data). Cached to limit repeated calls while typing."""
    search = yf.Search(query, max_results=10)
    results, seen = [], set()
    for quote in (search.quotes or []):
        if quote.get("quoteType") != "EQUITY":
            continue
        symbol = quote.get("symbol", "")
        # NSE only (matches the app's .NS default)
        if quote.get("exchange") != "NSI" and not symbol.endswith(".NS"):
            continue
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        name = quote.get("longname") or quote.get("shortname") or symbol
        ticker = symbol[:-3] if symbol.endswith(".NS") else symbol
        results.append({"ticker": ticker, "name": name, "symbol": symbol, "score": 100})
    return results


@router.get("/search")
def search_stocks(q: str = Query("", description="Search query — ticker or company name")):
    """Typeahead search — uses Dhan if available, else Yahoo Finance.

    Falls back to a small curated list only if both lookups fail/offline.
    """
    query = q.strip()
    if not query:
        return []

    # Try Dhan first if available
    if _use_dhan():
        try:
            results = dhan_search_stocks(query)
            if results:
                return results
        except DhanMarketDataError:
            pass

    # Fall back to Yahoo Finance
    try:
        results = _yahoo_nse_search(query)
        if results:
            return results
    except Exception:
        pass
    from backend.stock_list import search_stocks as _search
    return _search(query)


@router.get("/quote/{ticker}")
def get_quote(ticker: str):
    """Get real-time quote for a ticker. Uses Dhan if available, else Yahoo Finance."""
    symbol = normalize_ticker(ticker)

    # Try Dhan first if available
    if _use_dhan():
        try:
            dhan_quote = dhan_get_quote(symbol)
            # Get additional info from Yahoo for fields Dhan doesn't provide
            t = yf.Ticker(symbol)
            info = t.info
            hist = t.history(period="2d")
            prev_close = info.get("previousClose") or (hist.iloc[-2]["Close"] if len(hist) > 1 else dhan_quote.get("close", 0))
            price = dhan_quote.get("price") or dhan_quote.get("close", 0)
            change = price - prev_close
            change_pct = (change / prev_close * 100) if prev_close else 0

            return {
                "ticker": symbol,
                "name": info.get("shortName", symbol),
                "price": round(price, 2),
                "change": round(change, 2),
                "change_percent": round(change_pct, 2),
                "volume": int(hist.iloc[-1].get("Volume", 0)) if not hist.empty else 0,
                "high": round(dhan_quote.get("high", 0), 2),
                "low": round(dhan_quote.get("low", 0), 2),
                "open": round(dhan_quote.get("open", 0), 2),
                "prev_close": round(prev_close, 2),
                "market_cap": info.get("marketCap"),
                "pe_ratio": info.get("trailingPE"),
                "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
                "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
            }
        except DhanMarketDataError:
            pass  # Fall through to Yahoo Finance

    # Fall back to Yahoo Finance
    t = yf.Ticker(symbol)
    info = t.info

    hist = t.history(period="2d")
    if hist.empty:
        return {"error": f"No data found for {symbol}"}

    current = hist.iloc[-1]
    prev_close = info.get("previousClose") or (hist.iloc[-2]["Close"] if len(hist) > 1 else current["Close"])
    price = current["Close"]
    change = price - prev_close
    change_pct = (change / prev_close * 100) if prev_close else 0

    return {
        "ticker": symbol,
        "name": info.get("shortName", symbol),
        "price": round(price, 2),
        "change": round(change, 2),
        "change_percent": round(change_pct, 2),
        "volume": int(current.get("Volume", 0)),
        "high": round(current["High"], 2),
        "low": round(current["Low"], 2),
        "open": round(current["Open"], 2),
        "prev_close": round(prev_close, 2),
        "market_cap": info.get("marketCap"),
        "pe_ratio": info.get("trailingPE"),
        "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
    }


@router.get("/chart/{ticker}")
def get_chart_data(
    ticker: str,
    period: str = Query("3mo", description="1d, 5d, 1mo, 3mo, 6mo, 1y, 2y"),
    interval: str = Query("1d", description="1m, 5m, 15m, 1h, 1d, 1wk"),
):
    """Get OHLCV chart data for a ticker. Uses Dhan if available, else Yahoo Finance."""
    symbol = normalize_ticker(ticker)

    # Try Dhan first if available
    if _use_dhan():
        try:
            return dhan_get_chart_data(symbol, period=period, interval=interval)
        except DhanMarketDataError:
            pass  # Fall through to Yahoo Finance

    # Fall back to Yahoo Finance
    t = yf.Ticker(symbol)
    hist = t.history(period=period, interval=interval)

    if hist.empty:
        return {"error": f"No data for {symbol}", "data": []}

    data = []
    for idx, row in hist.iterrows():
        ts = idx.strftime("%Y-%m-%d") if interval in ("1d", "1wk", "1mo") else idx.isoformat()
        data.append({
            "time": ts,
            "open": round(row["Open"], 2),
            "high": round(row["High"], 2),
            "low": round(row["Low"], 2),
            "close": round(row["Close"], 2),
            "volume": int(row["Volume"]),
        })

    return {"ticker": symbol, "period": period, "interval": interval, "data": data}


@router.get("/indicators/{ticker}")
def get_indicators(
    ticker: str,
    indicators: str = Query("rsi,macd,boll_ub,boll_lb,close_10_ema,close_50_sma,atr,vwma"),
    lookback_days: int = Query(60),
):
    """Get technical indicators for a ticker."""
    from tradingagents.dataflows.interface import route_to_vendor

    symbol = normalize_ticker(ticker)
    end_date = datetime.now().strftime("%Y-%m-%d")

    results = {}
    for indicator in indicators.split(","):
        indicator = indicator.strip()
        try:
            result = route_to_vendor("get_indicators", symbol, indicator, end_date, lookback_days)
            results[indicator] = result
        except Exception as e:
            results[indicator] = f"Error: {str(e)}"

    return {"ticker": symbol, "indicators": results}


@router.get("/fundamentals/{ticker}")
def get_fundamentals(ticker: str):
    """Get company fundamentals. Uses Dhan if available, else Yahoo Finance."""
    symbol = normalize_ticker(ticker)

    # Try Dhan first if available
    if _use_dhan():
        try:
            return dhan_get_fundamentals(symbol)
        except DhanMarketDataError:
            pass  # Fall through to Yahoo Finance

    # Fall back to Yahoo Finance
    t = yf.Ticker(symbol)
    info = t.info

    return {
        "ticker": symbol,
        "name": info.get("shortName", symbol),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "market_cap": info.get("marketCap"),
        "pe_ratio": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "pb_ratio": info.get("priceToBook"),
        "dividend_yield": info.get("dividendYield"),
        "eps": info.get("trailingEps"),
        "roe": info.get("returnOnEquity"),
        "debt_to_equity": info.get("debtToEquity"),
        "revenue": info.get("totalRevenue"),
        "profit_margin": info.get("profitMargins"),
        "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
        "avg_volume": info.get("averageVolume"),
        "beta": info.get("beta"),
    }


@router.get("/news/{ticker}")
def get_news(ticker: str, count: int = Query(10)):
    """Get latest news for a ticker. Uses Dhan if available, else Yahoo Finance."""
    symbol = normalize_ticker(ticker)

    # Try Dhan first if available
    if _use_dhan():
        try:
            articles = dhan_get_news(symbol, count=count)
            if articles:
                return {"ticker": symbol, "news": articles, "source": "dhan"}
        except DhanMarketDataError:
            pass  # Fall through to Yahoo Finance

    # Fall back to Yahoo Finance
    t = yf.Ticker(symbol)
    news = t.get_news(count=count)

    articles = []
    for article in (news or []):
        if "content" in article:
            content = article["content"]
            articles.append({
                "title": content.get("title", ""),
                "summary": content.get("summary", ""),
                "publisher": content.get("provider", {}).get("displayName", "Unknown"),
                "url": (content.get("canonicalUrl") or content.get("clickThroughUrl") or {}).get("url", ""),
                "published_at": content.get("pubDate", ""),
            })
        else:
            articles.append({
                "title": article.get("title", ""),
                "summary": "",
                "publisher": article.get("publisher", "Unknown"),
                "url": article.get("link", ""),
                "published_at": "",
            })

    return {"ticker": symbol, "news": articles, "source": "yahoo"}


@router.get("/market-status")
def get_market_status():
    """Get current Indian market status (NIFTY, BANKNIFTY, session). Uses Dhan if available."""
    from tradingagents.utils.market_calendar import get_market_session, is_trading_day
    from backend.brokers.dhan_market_data import get_market_status as dhan_get_market_status

    # Try Dhan first if available
    if _use_dhan():
        try:
            return dhan_get_market_status()
        except DhanMarketDataError:
            pass  # Fall through to Yahoo Finance

    # Fall back to Yahoo Finance
    nifty = yf.Ticker("^NSEI")
    banknifty = yf.Ticker("^NSEBANK")

    nifty_hist = nifty.history(period="2d")
    banknifty_hist = banknifty.history(period="2d")

    def extract_quote(hist, info_ticker):
        if hist.empty:
            return {"price": 0, "change": 0, "change_percent": 0}
        current = hist.iloc[-1]
        prev = hist.iloc[-2]["Close"] if len(hist) > 1 else current["Close"]
        price = current["Close"]
        change = price - prev
        return {
            "price": round(price, 2),
            "change": round(change, 2),
            "change_percent": round(change / prev * 100, 2) if prev else 0,
        }

    return {
        "session": get_market_session(),
        "is_trading_day": is_trading_day(),
        "nifty": extract_quote(nifty_hist, nifty),
        "banknifty": extract_quote(banknifty_hist, banknifty),
        "source": "yahoo",
    }
