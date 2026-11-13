"""News aggregator — pulls from multiple Indian market news sources.

Supports:
- Dhan news headlines (when logged in)
- yfinance search queries (general market / custom queries)
- RSS feeds from Indian news sites
- Stock-specific news via yfinance/Dhan
"""

from backend.brokers.market_data_provider import Ticker, Search
import feedparser
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from backend.db import get_setting, set_setting
import json
import io
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit
import requests


# Default RSS feeds for Indian financial news
DEFAULT_RSS_FEEDS = {
    "moneycontrol_markets": {
        "name": "MoneyControl - Markets",
        "url": "https://www.moneycontrol.com/rss/MCtopnews.xml",
        "enabled": True,
    },
    "moneycontrol_business": {
        "name": "MoneyControl - Business",
        "url": "https://www.moneycontrol.com/rss/business.xml",
        "enabled": True,
    },
    "economictimes_markets": {
        "name": "Economic Times - Markets",
        "url": "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms",
        "enabled": True,
    },
    "economictimes_ipo": {
        "name": "Economic Times - IPO",
        "url": "https://economictimes.indiatimes.com/markets/ipos/fpos/rssfeeds/62256163.cms",
        "enabled": False,
    },
    "livemint_markets": {
        "name": "LiveMint - Markets",
        "url": "https://www.livemint.com/rss/markets",
        "enabled": True,
    },
    "business_standard": {
        "name": "Business Standard",
        "url": "https://www.business-standard.com/rss/markets-106.rss",
        "enabled": True,
    },
    "ndtv_profit": {
        "name": "NDTV Profit",
        "url": "https://feeds.feedburner.com/ndtvprofit-latest",
        "enabled": True,
    },
}


# Default yfinance search queries for general market news
DEFAULT_YF_QUERIES = [
    "Nifty Sensex Indian stock market",
    "RBI monetary policy India interest rates",
    "FII DII activity Indian markets",
    "India GDP inflation economic",
    "India rupee forex dollar",
]


# Feed URLs are user-configurable, so the server must never be steered into
# fetching (and echoing back) local files or addresses on a private network,
# e.g. file:///etc/passwd or a cloud metadata endpoint.
FEED_TIMEOUT_SECONDS = 10
FEED_MAX_BYTES = 5 * 1024 * 1024
FEED_MAX_REDIRECTS = 3


class UnsafeFeedURL(ValueError):
    """A feed URL that isn't a plain http(s) address on the public internet."""


def _is_public_ip(ip) -> bool:
    return ip.is_global and not ip.is_multicast


def validate_feed_url(url) -> str:
    """Return ``url`` stripped if it is an http(s) URL that isn't obviously local."""
    if not isinstance(url, str) or not url.strip():
        raise UnsafeFeedURL("Feed URL is required")
    url = url.strip()
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError as exc:
        raise UnsafeFeedURL("Feed URL is not a valid URL") from exc
    if parts.scheme not in ("http", "https") or not host:
        raise UnsafeFeedURL("Feed URL must start with http:// or https://")
    if parts.username or parts.password:
        raise UnsafeFeedURL("Feed URL must not contain a username or password")
    if host == "localhost" or host.endswith(".localhost"):
        raise UnsafeFeedURL("Feed URL must not point to this machine")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and not _is_public_ip(literal):
        raise UnsafeFeedURL("Feed URL must not point to a private or local address")
    return url


def _check_resolves_public(host: str, port: int) -> None:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeFeedURL(f"Cannot resolve feed host {host}") from exc
    for info in infos:
        address = info[4][0].split("%", 1)[0]  # drop any IPv6 zone id
        if not _is_public_ip(ipaddress.ip_address(address)):
            raise UnsafeFeedURL(f"Feed host {host} resolves to a private or local address")


def _fetch_feed(url: str) -> tuple[bytes, str]:
    """Download a feed, re-checking the destination on every redirect hop.

    Returns the body and its Content-Type.
    """
    current = validate_feed_url(url)
    for _ in range(FEED_MAX_REDIRECTS + 1):
        parts = urlsplit(current)
        _check_resolves_public(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
        response = requests.get(
            current,
            timeout=FEED_TIMEOUT_SECONDS,
            allow_redirects=False,
            stream=True,
            headers={"User-Agent": feedparser.USER_AGENT},
        )
        try:
            if response.is_redirect:
                current = validate_feed_url(urljoin(current, response.headers["Location"]))
                continue
            response.raise_for_status()
            body = bytearray()
            for chunk in response.iter_content(chunk_size=65536):
                body.extend(chunk)
                if len(body) > FEED_MAX_BYTES:
                    raise UnsafeFeedURL("Feed is too large")
            return bytes(body), response.headers.get("Content-Type", "")
        finally:
            response.close()
    raise UnsafeFeedURL("Feed redirected too many times")


def _safe_link(url) -> str:
    """Pass through only http(s) article links; drop javascript:, data:, etc."""
    if not isinstance(url, str):
        return ""
    url = url.strip()
    try:
        scheme = urlsplit(url).scheme
    except ValueError:
        return ""
    return url if scheme in ("http", "https") else ""


def get_news_sources_config() -> dict:
    """Get current news sources configuration (merge DB overrides with defaults)."""
    from backend.brokers.dhan_market_data import is_dhan_available

    # RSS feeds
    db_rss = get_setting("news_rss_feeds")
    if db_rss:
        try:
            rss_feeds = json.loads(db_rss)
        except Exception:
            rss_feeds = DEFAULT_RSS_FEEDS
    else:
        rss_feeds = DEFAULT_RSS_FEEDS

    # yfinance queries
    db_queries = get_setting("news_yf_queries")
    if db_queries:
        try:
            yf_queries = json.loads(db_queries)
        except Exception:
            yf_queries = DEFAULT_YF_QUERIES
    else:
        yf_queries = DEFAULT_YF_QUERIES

    # Dhan news setting
    dhan_enabled = get_setting("news_dhan_enabled")
    dhan_available = is_dhan_available()

    return {
        "rss_feeds": rss_feeds,
        "yf_queries": yf_queries,
        "dhan": {
            "enabled": dhan_enabled != "false",  # Default to True if not set
            "available": dhan_available,
            "name": "Dhan News Headlines",
            "source_type": "dhan",
        },
    }


def save_news_sources_config(rss_feeds: dict = None, yf_queries: list = None, dhan_enabled: bool = None):
    """Save custom news sources config to DB.

    Raises UnsafeFeedURL if any feed URL isn't a public http(s) address.
    """
    if rss_feeds is not None:
        for info in rss_feeds.values():
            if not isinstance(info, dict):
                raise UnsafeFeedURL("Each feed must be an object with a url")
            validate_feed_url(info.get("url"))
        set_setting("news_rss_feeds", json.dumps(rss_feeds))
    if yf_queries is not None:
        set_setting("news_yf_queries", json.dumps(yf_queries))
    if dhan_enabled is not None:
        set_setting("news_dhan_enabled", "true" if dhan_enabled else "false")


def _parse_rss(feed_key: str, feed_info: dict, max_items: int = 10) -> list[dict]:
    """Parse an RSS feed and return normalized articles."""
    if not feed_info.get("enabled", True):
        return []

    try:
        content, content_type = _fetch_feed(feed_info["url"])
        # Hand feedparser the bytes as a stream: given a string, it opens
        # anything that looks like a URL or a local file path by itself.
        parsed = feedparser.parse(io.BytesIO(content), response_headers={"content-type": content_type})
        articles = []
        for entry in parsed.entries[:max_items]:
            pub_date = ""
            if hasattr(entry, "published"):
                try:
                    dt = datetime(*entry.published_parsed[:6])
                    pub_date = dt.strftime("%Y-%m-%d %H:%M")
                except Exception:
                    pub_date = entry.published
            articles.append({
                "source_key": feed_key,
                "source": feed_info.get("name", feed_key),
                "source_type": "rss",
                "title": entry.get("title", ""),
                "summary": (entry.get("summary", "") or entry.get("description", ""))[:500],
                "url": _safe_link(entry.get("link", "")),
                "published_at": pub_date,
            })
        return articles
    except Exception as e:
        return []


def _fetch_yf_news_for_query(query: str, max_items: int = 5) -> list[dict]:
    """Fetch news from yfinance for a search query."""
    try:
        search = Search(query=query, max_results=max_items)
        articles = []
        if search.news:
            for article in search.news[:max_items]:
                content = article.get("content", {}) if "content" in article else article
                title = content.get("title", "") or article.get("title", "")
                summary = content.get("summary", "") or ""
                provider = content.get("provider", {}).get("displayName", "") or article.get("publisher", "Unknown")
                url_obj = content.get("canonicalUrl") or content.get("clickThroughUrl") or {}
                url = url_obj.get("url", "") or article.get("link", "")
                pub_date = content.get("pubDate", "")
                if pub_date:
                    try:
                        dt = datetime.fromisoformat(pub_date.replace("Z", "+00:00"))
                        pub_date = dt.strftime("%Y-%m-%d %H:%M")
                    except Exception:
                        pass

                articles.append({
                    "source_key": f"yf_{query[:20]}",
                    "source": f"{provider} (via yfinance)",
                    "source_type": "yfinance",
                    "query": query,
                    "title": title,
                    "summary": (summary or "")[:500],
                    "url": _safe_link(url),
                    "published_at": pub_date,
                })
        return articles
    except Exception:
        return []


def fetch_all_news(max_per_source: int = 10, source_filter: str | None = None) -> list[dict]:
    """Fetch news from all enabled sources in parallel.
    
    Args:
        max_per_source: Maximum articles per source
        source_filter: Optional filter - "dhan", "rss", "yfinance", or None for all
    """
    from backend.brokers.dhan_market_data import is_dhan_available

    config = get_news_sources_config()
    rss_feeds = config["rss_feeds"]
    yf_queries = config["yf_queries"]
    dhan_config = config.get("dhan", {})
    dhan_enabled = dhan_config.get("enabled", True)
    dhan_available = is_dhan_available()

    all_articles = []
    seen_titles = set()

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = []

        # RSS feeds (if not filtered out)
        if source_filter is None or source_filter == "rss":
            for key, info in rss_feeds.items():
                if info.get("enabled", True):
                    futures.append(executor.submit(_parse_rss, key, info, max_per_source))

        # yfinance queries (if not filtered out)
        if source_filter is None or source_filter == "yfinance":
            for query in yf_queries:
                futures.append(executor.submit(_fetch_yf_news_for_query, query, 5))

        # Dhan news (if enabled, available, and not filtered out)
        if dhan_enabled and dhan_available and (source_filter is None or source_filter == "dhan"):
            futures.append(executor.submit(_fetch_dhan_news, max_per_source))

        for f in as_completed(futures):
            articles = f.result()
            for art in articles:
                if art["title"] and art["title"] not in seen_titles:
                    seen_titles.add(art["title"])
                    all_articles.append(art)

    # Sort by published date (newest first), unknown dates go last
    def sort_key(a):
        return a.get("published_at", "") or ""
    all_articles.sort(key=sort_key, reverse=True)

    return all_articles


def _fetch_dhan_news(max_items: int = 10) -> list[dict]:
    """Fetch news headlines from Dhan API."""
    try:
        from backend.brokers.dhan_market_data import get_news as dhan_get_news
        articles = dhan_get_news(count=max_items)
        # Normalize to match other news sources format
        normalized = []
        for art in articles:
            normalized.append({
                "source_key": "dhan_news",
                "source": art.get("publisher", "Dhan"),
                "source_type": "dhan",
                "title": art.get("title", ""),
                "summary": (art.get("summary", "") or "")[:500],
                "url": art.get("url", ""),
                "published_at": art.get("published_at", ""),
            })
        return normalized
    except Exception:
        return []


def fetch_ticker_news(ticker: str, max_items: int = 15) -> list[dict]:
    """Fetch news for a specific ticker."""
    from tradingagents.utils.ticker import normalize_ticker
    from backend.brokers.dhan_market_data import is_dhan_available, get_news as dhan_get_news

    symbol = normalize_ticker(ticker)

    articles = []

    # Try Dhan news first if available
    if is_dhan_available():
        try:
            dhan_articles = dhan_get_news(ticker=symbol, count=max_items)
            for art in dhan_articles:
                articles.append({
                    "source": art.get("publisher", "Dhan"),
                    "source_type": "dhan",
                    "title": art.get("title", ""),
                    "summary": (art.get("summary", "") or "")[:500],
                    "url": art.get("url", ""),
                    "published_at": art.get("published_at", ""),
                })
        except Exception:
            pass

    # Also fetch from Yahoo Finance
    try:
        t = Ticker(symbol)
        news = t.get_news(count=max_items)
        for article in (news or []):
            content = article.get("content", {}) if "content" in article else article
            title = content.get("title", "") or article.get("title", "")
            summary = content.get("summary", "") or ""
            provider = content.get("provider", {}).get("displayName", "") or article.get("publisher", "Unknown")
            url_obj = content.get("canonicalUrl") or content.get("clickThroughUrl") or {}
            url = url_obj.get("url", "") or article.get("link", "")
            pub_date = content.get("pubDate", "")
            if pub_date:
                try:
                    dt = datetime.fromisoformat(pub_date.replace("Z", "+00:00"))
                    pub_date = dt.strftime("%Y-%m-%d %H:%M")
                except Exception:
                    pass

            articles.append({
                "source": provider,
                "source_type": "yfinance",
                "title": title,
                "summary": (summary or "")[:500],
                "url": _safe_link(url),
                "published_at": pub_date,
            })
    except Exception as e:
        pass

    # Deduplicate by title
    seen_titles = set()
    unique_articles = []
    for art in articles:
        if art["title"] and art["title"] not in seen_titles:
            seen_titles.add(art["title"])
            unique_articles.append(art)

    return unique_articles[:max_items]
