"""FastAPI application for the Indian Market Trading Agent."""

import sys
import os
import math
import numpy as np

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"), override=True)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from backend.db import ensure_db
from backend.auth import AuthMiddleware, allowed_origins
from backend.routers import market_data, analysis, watchlist, backtest, strategies, scanner, performance, recommender, settings as settings_router, news as news_router, simulation as simulation_router, insights as insights_router, fii_dii as fii_dii_router, calendar as calendar_router, concentration as concentration_router, daily_verdict as daily_verdict_router, signal_performance as signal_performance_router, verdict_calibration as verdict_calibration_router, regime as regime_router, confidence_calibration as confidence_calibration_router, shadow_trades as shadow_trades_router, memory as memory_router, auth as auth_router, dhan as dhan_router, equity_portfolio as equity_portfolio_router, positions as positions_router, telegram as telegram_router
from backend.settings_manager import load_api_keys_into_env, apply_llm_config_to_default
from tradingagents.utils.ticker import InvalidTickerError


def _sanitize_nonfinite(value):
    """Recursively convert non-finite floats (NaN/±Inf) to JSON ``null``.

    Price/indicator math can yield ``np.float64(nan)`` for symbols with missing
    or delisted data, and ``json.dumps`` rejects non-finite floats by default.
    Returning ``null`` is the JSON-compliant (and frontend-safe) representation.
    """
    if isinstance(value, dict):
        return {k: _sanitize_nonfinite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_sanitize_nonfinite(v) for v in value]
    if isinstance(value, (float, np.floating)):
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    return value


class SafeJSONResponse(JSONResponse):
    """``JSONResponse`` that renders NaN/Infinity as ``null`` instead of raising."""

    def render(self, content):
        return super().render(_sanitize_nonfinite(content))


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_db()
    # Load API keys from DB (UI takes priority over .env)
    load_api_keys_into_env()
    # Apply saved LLM config to DEFAULT_CONFIG
    apply_llm_config_to_default()
    yield


app = FastAPI(
    title="Indian Market Trading Agent",
    description="AI-powered short-term trading decisions for NSE/BSE",
    version="0.1.0",
    lifespan=lifespan,
    default_response_class=SafeJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
)

# This middleware covers every /api HTTP route and every /api WebSocket route.
# WebSocket failures are sent as a close frame before endpoint code can accept
# the connection, so analysis/backtest/scanner streams cannot bypass auth.
app.add_middleware(AuthMiddleware)


@app.exception_handler(InvalidTickerError)
async def invalid_ticker(request: Request, exc: InvalidTickerError):
    # normalize_ticker is the single gate for user-supplied symbols; a bad one
    # is the caller's mistake, not a server error.
    return JSONResponse(status_code=400, content={"detail": str(exc)})


app.include_router(auth_router.router)
app.include_router(market_data.router)
app.include_router(analysis.router)
app.include_router(watchlist.router)
app.include_router(backtest.router)
app.include_router(strategies.router)
app.include_router(scanner.router)
app.include_router(performance.router)
app.include_router(recommender.router)
app.include_router(settings_router.router)
app.include_router(news_router.router)
app.include_router(simulation_router.router)
app.include_router(insights_router.router)
app.include_router(fii_dii_router.router)
app.include_router(calendar_router.router)
app.include_router(concentration_router.router)
app.include_router(daily_verdict_router.router)
app.include_router(signal_performance_router.router)
app.include_router(verdict_calibration_router.router)
app.include_router(regime_router.router)
app.include_router(confidence_calibration_router.router)
app.include_router(shadow_trades_router.router)
app.include_router(memory_router.router)
app.include_router(dhan_router.router)
app.include_router(equity_portfolio_router.router)
app.include_router(positions_router.router)
app.include_router(telegram_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "indian-trading-agent"}


@app.get("/api/config")
def get_config():
    from tradingagents.default_config import DEFAULT_CONFIG
    safe_keys = [
        "llm_provider", "deep_think_llm", "quick_think_llm",
        "market", "default_exchange", "trading_style",
        "max_debate_rounds", "max_risk_discuss_rounds",
        "dry_run", "order_execution_enabled",
        "max_position_value", "max_loss_per_trade", "max_daily_loss",
        "max_open_positions",
    ]
    return {k: DEFAULT_CONFIG.get(k) for k in safe_keys}
