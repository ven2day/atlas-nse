"""DhanHQ consent, credential status, and read-only session routes."""

from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from backend.auth import frontend_page_url, public_mode
from backend.brokers.dhan import (
    DhanAuthExpired, DhanConfigError, clear_dhan_access_token, exchange_token_id,
    get_dhan_status, get_login_url, save_dhan_credentials,
)
from backend.brokers.dhan_market_data import is_dhan_available

router = APIRouter(prefix="/api/dhan", tags=["dhan"])


class DhanCredentials(BaseModel):
    client_id: str
    api_key: str
    api_secret: str


def _redirect(query: dict[str, str]) -> RedirectResponse:
    try:
        target = frontend_page_url()
    except (RuntimeError, ValueError):
        if public_mode():
            raise HTTPException(status_code=503, detail="Frontend URL is not configured")
        target = "http://localhost:3000/equity-portfolio-analysis"
    separator = "&" if "?" in target else "?"
    return RedirectResponse(target + separator + urlencode(query))


@router.get("/status")
def status():
    dhan_status = get_dhan_status()
    dhan_status["market_data_available"] = is_dhan_available()
    dhan_status["data_provider"] = "dhan" if is_dhan_available() else "yahoo"
    return dhan_status


@router.put("/credentials")
def credentials(data: DhanCredentials):
    try:
        return save_dhan_credentials(data.client_id, data.api_key, data.api_secret)
    except DhanConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/login-url")
def login_url():
    try:
        return {"login_url": get_login_url()}
    except DhanConfigError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/callback")
def callback(request: Request, tokenId: str | None = None, status: str | None = None):
    # Consume before storing: the exchange call validates our app credentials
    # and binds the session to the configured client ID. Dhan echoes no OAuth
    # state, so that client ID match is the login-forgery defense.
    if status and status != "success":
        return _redirect({"dhan": "error", "message": status})
    if not tokenId:
        return _redirect({"dhan": "error", "message": "missing_token_id"})
    try:
        exchange_token_id(tokenId)
        return _redirect({"dhan": "connected"})
    except (DhanConfigError, DhanAuthExpired):
        return _redirect({"dhan": "error", "message": "dhan_login_failed"})
    except Exception:
        return _redirect({"dhan": "error", "message": "dhan_login_failed"})


def _logout_response():
    clear_dhan_access_token()
    return {"status": "logged_out", "dhan": get_dhan_status()}


@router.post("/logout")
def logout():
    return _logout_response()
