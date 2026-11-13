"""Unified market data provider — uses Dhan when available, falls back to Yahoo Finance.

This module provides a drop-in replacement for yfinance that automatically
uses Dhan's paid API when the user is logged in, and falls back to Yahoo
Finance on any error (including rate limits).
"""

from __future__ import annotations

from typing import Any


class Ticker:
    """Drop-in replacement for yfinance.Ticker that uses Dhan when available."""

    def __init__(self, symbol: str):
        self.symbol = symbol
        self._dhan_available = None

    def _check_dhan(self) -> bool:
        if self._dhan_available is None:
            from backend.brokers.dhan_market_data import is_dhan_available
            self._dhan_available = is_dhan_available()
        return self._dhan_available

    def history(self, period: str = "1mo", interval: str = "1d", start=None, end=None) -> "pd.DataFrame":
        """Get historical data (yfinance-compatible)."""
        if self._check_dhan():
            try:
                from backend.brokers.dhan_market_data import get_history_as_dataframe
                df = get_history_as_dataframe(self.symbol, period=period, interval=interval, start=start, end=end)
                if df is not None and not df.empty:
                    return df
                # Dhan returned no rows (e.g. rate limited) — fall through to Yahoo.
            except Exception:
                pass  # Fall through to Yahoo
        
        # Fallback to Yahoo Finance
        import yfinance as yf
        if start is not None or end is not None:
            return yf.Ticker(self.symbol).history(start=start, end=end, interval=interval)
        else:
            return yf.Ticker(self.symbol).history(period=period, interval=interval)

    @property
    def info(self) -> dict:
        """Get ticker info (yfinance-compatible)."""
        if self._check_dhan():
            try:
                from backend.brokers.dhan_market_data import get_ticker_info
                return get_ticker_info(self.symbol)
            except Exception:
                pass  # Fall through to Yahoo
        
        # Fallback to Yahoo Finance
        import yfinance as yf
        return yf.Ticker(self.symbol).info

    def get_news(self, count: int = 10) -> list[dict]:
        """Get news for this ticker."""
        if self._check_dhan():
            try:
                from backend.brokers.dhan_market_data import get_news
                return get_news(ticker=self.symbol, count=count)
            except Exception:
                pass  # Fall through to Yahoo
        
        # Fallback to Yahoo Finance
        import yfinance as yf
        return yf.Ticker(self.symbol).get_news(count=count)


class Search:
    """Drop-in replacement for yfinance.Search."""

    def __init__(self, query: str, max_results: int = 10, **kwargs):
        self.query = query
        self.max_results = max_results
        self._fetch()

    def _fetch(self):
        from backend.brokers.dhan_market_data import is_dhan_available
        if is_dhan_available():
            try:
                from backend.brokers.dhan_market_data import search_stocks
                results = search_stocks(self.query, self.max_results)
                self.quotes = [
                    {
                        "symbol": r.get("symbol", ""),
                        "longname": r.get("name", ""),
                        "shortname": r.get("name", ""),
                        "exchange": "NSI" if r.get("symbol", "").endswith(".NS") else "BSE",
                        "quoteType": "EQUITY",
                    }
                    for r in results
                ]
                self.news = []
                return
            except Exception:
                pass  # Fall through to Yahoo
        
        # Fallback to Yahoo Finance
        import yfinance as yf
        search = yf.Search(self.query, max_results=self.max_results)
        self.quotes = search.quotes or []
        self.news = getattr(search, "news", [])


# Convenience function to get a Ticker instance
def get_ticker(symbol: str) -> Ticker:
    """Get a Ticker instance that uses Dhan when available."""
    return Ticker(symbol)
