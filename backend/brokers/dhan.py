"""Read-only DhanHQ v2 integration.

This module only reads holdings/profile data via DhanHQ's REST API. It never
exposes or calls order placement APIs. The access token is a daily (24-hour)
JWT obtained through Dhan's three-step app consent flow; because Dhan does not
echo an OAuth state parameter back to the redirect, the callback instead binds
the login to this installation by verifying that the exchanged session belongs
to the configured client ID.

Headless login is supported using DHAN_PIN and DHAN_TOTP_SECRET from .env.
"""

from __future__ import annotations

import base64
import json
import math
import os
import struct
import time
from datetime import date
from typing import Any
from urllib.parse import quote

import requests

from backend.db import get_setting, set_setting

AUTH_BASE_URL = "https://auth.dhan.co"
API_BASE_URL = "https://api.dhan.co/v2"
REQUEST_TIMEOUT_SECONDS = 30

DHAN_CLIENT_ID = "dhan_client_id"
DHAN_API_KEY = "dhan_api_key"
DHAN_API_SECRET = "dhan_api_secret"
DHAN_ACCESS_TOKEN = "dhan_access_token"
DHAN_ACCESS_TOKEN_DATE = "dhan_access_token_date"
DHAN_PROFILE = "dhan_profile"


def _generate_totp(secret: str) -> str:
    """Generate a 6-digit TOTP code from a Base32-encoded secret."""
    # Decode the Base32 secret
    secret = secret.upper().strip()
    # Add padding if needed
    padding = 8 - (len(secret) % 8)
    if padding != 8:
        secret += "=" * padding
    
    try:
        key = base64.b32decode(secret)
    except Exception:
        raise DhanConfigError("Invalid TOTP secret format")
    
    # Get current time step (30-second intervals)
    time_step = int(time.time()) // 30
    
    # Convert time step to bytes
    time_bytes = struct.pack(">Q", time_step)
    
    # HMAC-SHA1
    import hmac
    import hashlib
    hmac_hash = hmac.new(key, time_bytes, hashlib.sha1).digest()
    
    # Dynamic truncation
    offset = hmac_hash[-1] & 0x0F
    code = struct.unpack(">I", hmac_hash[offset:offset + 4])[0]
    code = (code & 0x7FFFFFFF) % 1000000
    
    return str(code).zfill(6)

# Dhan's v2 holdings rows carry segment enums (NSE_EQ/BSE_EQ, "ALL" in the
# docs example); the position store is exchange-level (NSE/BSE) like every
# other data source in this app.
_EXCHANGE_NAMES = {
    "NSE_EQ": "NSE", "NSE": "NSE",
    "BSE_EQ": "BSE", "BSE": "BSE",
    "ALL": "NSE", "": "NSE",
}
_SEGMENTS = {"NSE": "NSE_EQ", "NSE_EQ": "NSE_EQ", "BSE": "BSE_EQ", "BSE_EQ": "BSE_EQ"}


class DhanConfigError(RuntimeError):
    """Raised when Dhan credentials or access token are not ready."""


class DhanAuthExpired(RuntimeError):
    """Raised when Dhan rejects the current read-only session."""


def _client_id() -> str:
    return (get_setting(DHAN_CLIENT_ID) or os.getenv("DHAN_CLIENT_ID") or "").strip()


def _api_key() -> str:
    return (get_setting(DHAN_API_KEY) or os.getenv("DHAN_API_KEY") or "").strip()


def _api_secret() -> str:
    return (get_setting(DHAN_API_SECRET) or os.getenv("DHAN_API_SECRET") or "").strip()


def _access_token() -> str:
    return (get_setting(DHAN_ACCESS_TOKEN) or os.getenv("DHAN_ACCESS_TOKEN") or "").strip()


def _access_token_date() -> str | None:
    stored = get_setting(DHAN_ACCESS_TOKEN_DATE)
    if stored:
        return stored
    if os.getenv("DHAN_ACCESS_TOKEN"):
        return (os.getenv("DHAN_ACCESS_TOKEN_DATE") or _today()).strip()
    return None


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "****"
    return f"{value[:4]}...{value[-4:]}"


def _today() -> str:
    return date.today().isoformat()


def _load_profile() -> dict | None:
    raw = get_setting(DHAN_PROFILE)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def get_dhan_status() -> dict:
    client_id = _client_id()
    api_key = _api_key()
    api_secret = _api_secret()
    token_date = _access_token_date()
    access_token = _access_token()
    return {
        "client_id_configured": bool(client_id),
        "api_key_configured": bool(api_key),
        "api_secret_configured": bool(api_secret),
        "configured": bool(client_id and api_key and api_secret),
        "connected_today": bool(access_token and token_date == _today()),
        "token_date": token_date,
        "login_ready": bool(client_id and api_key and api_secret),
        "masked_client_id": mask_secret(client_id),
        "masked_api_key": mask_secret(api_key),
        "profile": _load_profile(),
    }


def save_dhan_credentials(client_id: str, api_key: str, api_secret: str) -> dict:
    client_id = (client_id or "").strip()
    api_key = (api_key or "").strip()
    api_secret = (api_secret or "").strip()
    if not client_id or not api_key or not api_secret:
        raise DhanConfigError("Dhan client ID, API key, and API secret are all required")
    set_setting(DHAN_CLIENT_ID, client_id)
    set_setting(DHAN_API_KEY, api_key)
    set_setting(DHAN_API_SECRET, api_secret)
    clear_dhan_access_token()
    return get_dhan_status()


def clear_dhan_access_token():
    set_setting(DHAN_ACCESS_TOKEN, None)
    set_setting(DHAN_ACCESS_TOKEN_DATE, None)


def _auth_request(method: str, path: str, *, params=None, headers=None) -> Any:
    """Call auth.dhan.co consent endpoints; rejected app credentials are a
    configuration problem here, not an expired data session."""
    url = f"{AUTH_BASE_URL}{path}"
    try:
        response = requests.request(
            method, url, params=params, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise DhanConfigError("Dhan auth service is unreachable") from exc
    if not 200 <= response.status_code < 300:
        raise DhanConfigError("Dhan app credentials were rejected") from None
    try:
        return response.json()
    except ValueError as exc:
        raise DhanConfigError("Dhan auth service returned an invalid response") from exc


class _DhanClient:
    """Minimal read-only v2 data client (holdings + market quotes)."""

    def __init__(self, client_id: str, access_token: str):
        self.client_id = client_id
        self._headers = {
            "access-token": access_token,
            "client-id": client_id,
            "Content-type": "application/json",
            "Accept": "application/json",
        }

    def holdings(self) -> Any:
        return self._data_request("GET", "/holdings")

    def quotes(self, request: dict) -> Any:
        return self._data_request("POST", "/marketfeed/quote", json_body=request)

    def _data_request(self, method: str, path: str, *, json_body=None) -> Any:
        url = f"{API_BASE_URL}{path}"
        try:
            response = requests.request(
                method, url, headers=self._headers, json=json_body,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise DhanConfigError("Dhan API is unreachable") from exc
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if 200 <= response.status_code < 300:
            if payload is None:
                raise DhanConfigError("Dhan API returned an invalid response")
            return payload
        error_code = payload.get("errorCode") if isinstance(payload, dict) else None
        if response.status_code == 401 or error_code == "DH-901":
            raise DhanAuthExpired("Dhan rejected the current session")
        raise DhanConfigError(f"Dhan API request failed ({response.status_code})")


def get_login_url() -> str:
    """Generate a fresh consent session and return Dhan's browser login URL."""
    client_id = _client_id()
    api_key = _api_key()
    api_secret = _api_secret()
    if not (client_id and api_key and api_secret):
        raise DhanConfigError("Dhan client ID, API key, and API secret are required for login")
    consent = _auth_request(
        "POST", "/app/generate-consent",
        params={"client_id": client_id}, headers={"app_id": api_key, "app_secret": api_secret},
    )
    consent_app_id = consent.get("consentAppId") if isinstance(consent, dict) else None
    if not consent_app_id:
        raise DhanConfigError("Dhan consent session could not be created")
    return f"{AUTH_BASE_URL}/login/consentApp-login?consentAppId={quote(str(consent_app_id), safe='')}"


def exchange_token_id(token_id: str) -> dict:
    """Consume the tokenId from Dhan's redirect and store today's access token.

    Dhan redirects with only a tokenId — no OAuth state echo — so the login is
    bound to this installation by comparing the consumed session's
    dhanClientId with the configured client ID: a token minted for a
    different Dhan account is rejected instead of stored.
    """
    token_id = (token_id or "").strip()
    api_key = _api_key()
    api_secret = _api_secret()
    client_id = _client_id()
    if not token_id:
        raise DhanConfigError("Missing Dhan token ID")
    if not api_key or not api_secret:
        raise DhanConfigError("Dhan API key and secret are not configured")
    if not client_id:
        raise DhanConfigError("Dhan client ID is not configured")
    try:
        session = _auth_request(
            "GET", "/app/consumeApp-consent",
            params={"tokenId": token_id}, headers={"app_id": api_key, "app_secret": api_secret},
        )
    except DhanConfigError as exc:
        raise DhanConfigError("Dhan login could not be completed") from exc
    if not isinstance(session, dict):
        raise DhanConfigError("Dhan login could not be completed")
    access_token = session.get("accessToken")
    if not access_token:
        raise DhanConfigError("Dhan login did not return an access token")
    if str(session.get("dhanClientId") or "").strip() != client_id:
        raise DhanConfigError("Dhan login did not match the configured client ID")

    set_setting(DHAN_ACCESS_TOKEN, str(access_token))
    set_setting(DHAN_ACCESS_TOKEN_DATE, _today())
    profile = {
        "client_id": session.get("dhanClientId"),
        "client_name": session.get("dhanClientName"),
        "client_ucc": session.get("dhanClientUcc"),
        "ddpi_enabled": session.get("givenPowerOfAttorney"),
        "token_expiry": session.get("expiryTime"),
    }
    set_setting(DHAN_PROFILE, json.dumps({k: v for k, v in profile.items() if v is not None}))
    return get_dhan_status()


def get_authenticated_client() -> _DhanClient:
    client_id = _client_id()
    access_token = _access_token()
    token_date = _access_token_date()
    if not client_id:
        raise DhanConfigError("Dhan client ID is not configured")
    if not access_token or token_date != _today():
        # Try automatic headless login using DhanHQ SDK
        try:
            headless_login()
            access_token = _access_token()
            token_date = _access_token_date()
        except Exception as e:
            print(f"[Dhan] Headless login failed: {e}", flush=True)
            clear_dhan_access_token()
            raise DhanConfigError("Dhan login is required for today")
    return _DhanClient(client_id, access_token)


def headless_login() -> dict:
    """Perform automatic headless login using DhanHQ SDK with PIN + TOTP."""
    client_id = _client_id()
    api_key = _api_key()
    api_secret = _api_secret()
    pin = (os.getenv("DHAN_PIN") or "").strip()
    totp_secret = (os.getenv("DHAN_TOTP_SECRET") or "").strip()
    
    if not (client_id and api_key and api_secret):
        raise DhanConfigError("Dhan credentials not configured")
    if not pin:
        raise DhanConfigError("DHAN_PIN not configured for headless login")
    if not totp_secret:
        raise DhanConfigError("DHAN_TOTP_SECRET not configured for headless login")
    
    # Generate TOTP code
    totp_code = _generate_totp(totp_secret)
    
    # Use DhanHQ SDK for headless login
    try:
        from dhanhq import DhanLogin
        
        login_client = DhanLogin(client_id)
        
        # Step 1: Generate consent session (skip browser open)
        login_client.generate_login_session(api_key, api_secret)
        
        # Step 2: Generate access token using PIN + TOTP
        result = login_client.generate_token(pin, totp_code)
        
        if not isinstance(result, dict):
            raise DhanConfigError("Dhan login returned invalid response")
        
        access_token = result.get("accessToken") or result.get("access_token")
        if not access_token:
            # Try nested data structure
            data = result.get("data", {})
            if isinstance(data, dict):
                access_token = data.get("accessToken") or data.get("access_token")
        
        if not access_token:
            raise DhanConfigError(f"Dhan login did not return access token. Response: {result}")
        
        # Store the access token
        set_setting(DHAN_ACCESS_TOKEN, str(access_token))
        set_setting(DHAN_ACCESS_TOKEN_DATE, _today())
        
        # Store profile info
        profile = login_client.user_profile if hasattr(login_client, "user_profile") else {}
        if isinstance(profile, dict):
            set_setting(DHAN_PROFILE, json.dumps(profile))
        
        print(f"[Dhan] Headless login successful for client {client_id}", flush=True)
        return get_dhan_status()
        
    except ImportError:
        raise DhanConfigError("dhanhq SDK not installed. Run: pip install dhanhq")
    except Exception as e:
        raise DhanConfigError(f"Headless login failed: {e}")


def fetch_equity_holdings() -> list[dict[str, Any]]:
    client = get_authenticated_client()
    try:
        holdings = client.holdings()
        quotes = _fetch_quote_snapshot(client, holdings)
    except DhanAuthExpired as exc:
        clear_dhan_access_token()
        raise DhanAuthExpired("Dhan session expired. Please connect Dhan again.") from exc
    return normalize_holdings(holdings, quotes)


def _exchange_name(raw: Any) -> str:
    exchange = str(raw or "").strip().upper()
    return _EXCHANGE_NAMES.get(exchange, exchange or "NSE")


def _fetch_quote_snapshot(client: _DhanClient, holdings: Any) -> dict[tuple[str, str], dict[str, float]]:
    """Batch-quote every holding's securityId via the v2 market quote feed.

    Dhan's holdings rows carry no last price, so the quote snapshot supplies
    last_price and the previous close needed for valuation and day P&L.
    """
    if not isinstance(holdings, list):
        return {}
    segments: dict[str, list[str]] = {}
    for holding in holdings:
        if not isinstance(holding, dict):
            continue
        security_id = str(holding.get("securityId") or "").strip()
        segment = _SEGMENTS.get(_exchange_name(holding.get("exchange")))
        if security_id and segment:
            segments.setdefault(segment, []).append(security_id)
    if not segments:
        return {}
    payload = client.quotes({**segments, "dhanClientId": client.client_id})
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise DhanConfigError("Dhan quotes could not be fetched")
    snapshot: dict[tuple[str, str], dict[str, float]] = {}
    for segment, security_map in data.items():
        if not isinstance(security_map, dict):
            continue
        for security_id, quote in security_map.items():
            if not isinstance(quote, dict):
                continue
            ohlc = quote.get("ohlc") if isinstance(quote.get("ohlc"), dict) else {}
            entry = {}
            last_price = _num(quote.get("last_price"))
            close = _num(ohlc.get("close"))
            if last_price:
                entry["last_price"] = last_price
            if close:
                entry["close"] = close
            snapshot[(str(segment), str(security_id))] = entry
    return snapshot


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def normalize_holdings(holdings: Any, quotes: dict[tuple[str, str], dict[str, float]] | None = None) -> list[dict[str, Any]]:
    if not isinstance(holdings, list):
        raise DhanConfigError("Dhan returned an invalid holdings snapshot")
    quotes = quotes or {}
    normalized = []
    seen: set[tuple[str, str]] = set()
    for holding in holdings or []:
        if not isinstance(holding, dict):
            raise DhanConfigError("Dhan returned an invalid holdings row")
        raw_symbol = holding.get("tradingSymbol") or holding.get("trading_symbol")
        raw_exchange = holding.get("exchange")
        if not isinstance(raw_symbol, str) or not isinstance(raw_exchange, str):
            raise DhanConfigError("Dhan returned a holdings row with an invalid symbol or exchange")
        symbol = raw_symbol.strip().upper().removesuffix("-EQ")
        exchange = _exchange_name(raw_exchange)
        if not symbol or not exchange:
            raise DhanConfigError("Dhan returned a holdings row without a symbol or exchange")
        identity = (symbol, exchange)
        if identity in seen:
            raise DhanConfigError(f"Dhan returned duplicate holding {symbol} ({exchange})")
        seen.add(identity)

        quantity = _num(holding.get("totalQty") or holding.get("availableQty"))
        average_price = _num(holding.get("avgCostPrice") or holding.get("averagePrice"))
        for field, value in (("quantity", quantity), ("average_price", average_price)):
            if not math.isfinite(value) or value < 0:
                raise DhanConfigError(f"Dhan returned an invalid {field} for {symbol}")

        security_id = str(holding.get("securityId") or "").strip()
        segment = _SEGMENTS.get(exchange)
        quote = quotes.get((segment, security_id)) if segment and security_id else None
        last_price = _num((quote or {}).get("last_price")) or _num((quote or {}).get("close")) or average_price
        close_price = _num((quote or {}).get("close")) or last_price
        if not math.isfinite(last_price) or last_price < 0:
            raise DhanConfigError(f"Dhan returned an invalid last_price for {symbol}")

        invested_value = average_price * quantity
        current_value = last_price * quantity
        pnl = current_value - invested_value
        day_change = (last_price - close_price) if close_price > 0 else 0.0
        normalized.append({
            "tradingsymbol": symbol,
            "exchange": exchange,
            "isin": holding.get("isin"), "product": holding.get("product") or "CNC",
            "quantity": quantity, "t1_quantity": _num(holding.get("t1Qty")),
            "average_price": round(average_price, 2), "last_price": round(last_price, 2),
            "close_price": round(close_price, 2), "invested_value": round(invested_value, 2),
            "current_value": round(current_value, 2), "pnl": round(pnl, 2),
            "pnl_pct": round(pnl / invested_value * 100, 2) if invested_value else 0.0,
            "day_change": round(day_change, 2),
            "day_change_pct": round(day_change / close_price * 100, 2) if close_price else 0.0,
        })
    return normalized
