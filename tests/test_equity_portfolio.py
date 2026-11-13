import unittest
from datetime import date, timedelta
import os
from unittest.mock import patch

from tests._support import IsolatedStateTestCase, csrf_headers, fresh_test_client, login


class EquityPortfolioTests(IsolatedStateTestCase, unittest.TestCase):
    def test_normalize_holdings_computes_values_and_pnl(self):
        from backend.brokers.dhan import normalize_holdings

        rows = normalize_holdings([
            {
                "tradingSymbol": "RELIANCE",
                "exchange": "NSE_EQ",
                "securityId": "2885",
                "isin": "INE002A01018",
                "totalQty": 10,
                "avgCostPrice": 100,
            }
        ], quotes={("NSE_EQ", "2885"): {"last_price": 125, "close": 123}})

        self.assertEqual(rows[0]["tradingsymbol"], "RELIANCE")
        self.assertEqual(rows[0]["exchange"], "NSE")
        self.assertEqual(rows[0]["invested_value"], 1000)
        self.assertEqual(rows[0]["current_value"], 1250)
        self.assertEqual(rows[0]["pnl"], 250)
        self.assertEqual(rows[0]["pnl_pct"], 25)
        self.assertEqual(rows[0]["close_price"], 123)
        self.assertEqual(rows[0]["day_change"], 2)

    def test_normalize_holdings_falls_back_to_cost_without_quotes(self):
        from backend.brokers.dhan import normalize_holdings

        rows = normalize_holdings([{
            "tradingSymbol": "RELIANCE",
            "exchange": "NSE",
            "totalQty": 10,
            "avgCostPrice": 100,
        }])

        self.assertEqual(rows[0]["last_price"], 100)
        self.assertEqual(rows[0]["current_value"], 1000)
        self.assertEqual(rows[0]["pnl"], 0)
        self.assertEqual(rows[0]["day_change"], 0)

    def test_dhan_status_masks_credentials_and_expires_old_token(self):
        from backend.brokers.dhan import get_dhan_status

        self.db.set_setting("dhan_client_id", "1100123456")
        self.db.set_setting("dhan_api_key", "abcd1234wxyz")
        self.db.set_setting("dhan_api_secret", "secret1234")
        self.db.set_setting("dhan_access_token", "token123")
        self.db.set_setting(
            "dhan_access_token_date",
            (date.today() - timedelta(days=1)).isoformat(),
        )

        status = get_dhan_status()

        self.assertTrue(status["configured"])
        self.assertFalse(status["connected_today"])
        self.assertEqual(status["masked_api_key"], "abcd...wxyz")
        self.assertEqual(status["masked_client_id"], "1100...3456")
        self.assertNotIn("secret1234", str(status))
        self.assertNotIn("token123", str(status))

    def test_dhan_credentials_can_be_read_from_environment(self):
        from backend.brokers.dhan import get_dhan_status

        with patch.dict(os.environ, {
            "DHAN_CLIENT_ID": "env-client",
            "DHAN_API_KEY": "env-key",
            "DHAN_API_SECRET": "env-secret",
        }):
            status = get_dhan_status()

        self.assertTrue(status["configured"])
        self.assertEqual(status["masked_api_key"], "****")

    def test_dhan_access_token_can_be_read_from_environment_for_today(self):
        from backend.brokers.dhan import get_dhan_status

        with patch.dict(os.environ, {
            "DHAN_CLIENT_ID": "env-client",
            "DHAN_API_KEY": "env-key",
            "DHAN_API_SECRET": "env-secret",
            "DHAN_ACCESS_TOKEN": "env-token",
        }):
            status = get_dhan_status()

        self.assertTrue(status["configured"])
        self.assertTrue(status["connected_today"])
        self.assertEqual(status["token_date"], date.today().isoformat())

    def test_invalid_dhan_snapshot_is_rejected_before_normalization(self):
        from backend.brokers.dhan import DhanConfigError, normalize_holdings

        with self.assertRaises(DhanConfigError):
            normalize_holdings(None)
        with self.assertRaises(DhanConfigError):
            normalize_holdings([{"tradingSymbol": "RELIANCE", "totalQty": 1}])
        with self.assertRaises(DhanConfigError):
            normalize_holdings([
                {"tradingSymbol": "RELIANCE", "exchange": "NSE", "totalQty": 1, "avgCostPrice": 100},
                {"tradingSymbol": "RELIANCE", "exchange": "NSE", "totalQty": 1, "avgCostPrice": 100},
            ])

    def test_review_rejects_stale_dhan_positions_before_analysis(self):
        from backend.brokers.dhan import normalize_holdings

        holding = normalize_holdings([{
            "tradingSymbol": "RELIANCE",
            "exchange": "NSE",
            "totalQty": 10,
            "avgCostPrice": 100,
        }])[0]
        self.db.upsert_position({**holding, "source": "dhan"})
        self.db.set_setting(
            "positions_last_sync_at",
            (date.today() - timedelta(days=1)).isoformat(),
        )

        with fresh_test_client() as client:
            login(client)
            response = client.post(
                "/api/equity-portfolio/reviews",
                headers=csrf_headers(client),
            )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("stale", response.json()["detail"])

    def test_review_calculates_summary_actions_and_persists(self):
        from backend.equity_portfolio import build_equity_portfolio_review, create_and_save_review

        holdings = [
            {
                "tradingsymbol": "RELIANCE",
                "exchange": "NSE",
                "quantity": 10,
                "average_price": 100,
                "last_price": 125,
                "invested_value": 1000,
                "current_value": 1250,
                "pnl": 250,
                "pnl_pct": 25,
                "day_change": 1,
            },
            {
                "tradingsymbol": "TCS",
                "exchange": "NSE",
                "quantity": 5,
                "average_price": 200,
                "last_price": 160,
                "invested_value": 1000,
                "current_value": 800,
                "pnl": -200,
                "pnl_pct": -20,
                "day_change": -2,
            },
        ]

        review = build_equity_portfolio_review(holdings, enrich=False)
        self.assertEqual(review["summary"]["total_current"], 2050)
        self.assertEqual(review["summary"]["total_pnl"], 50)
        self.assertEqual(review["summary"]["total_pnl_pct"], 2.5)
        self.assertEqual(review["summary"]["total_day_pnl"], 0)
        self.assertEqual(review["summary"]["total_holdings"], 2)
        self.assertEqual(review["summary"]["total_positions"], 2)
        self.assertTrue(review["summary"]["sector_allocation"])
        self.assertEqual(review["summary"]["top_winners"][0]["tradingsymbol"], "RELIANCE")
        self.assertEqual(review["summary"]["top_losers"][0]["tradingsymbol"], "TCS")
        self.assertTrue(any(h["action"] == "REVIEW" for h in review["holdings"]))

        saved = create_and_save_review(holdings, enrich=False)
        latest = self.db.get_latest_equity_portfolio_review()
        history = self.db.list_equity_portfolio_reviews()

        self.assertEqual(latest["review_id"], saved["review_id"])
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["summary"]["total_current"], 2050)

    def test_latest_review_uses_insert_order_when_reviews_share_a_timestamp(self):
        from backend.equity_portfolio import create_and_save_review

        holdings = [{
            "tradingsymbol": "RELIANCE",
            "exchange": "NSE",
            "quantity": 1,
            "average_price": 100,
            "last_price": 110,
            "invested_value": 100,
            "current_value": 110,
            "pnl": 10,
            "pnl_pct": 10,
            "day_change": 0,
        }]
        first = create_and_save_review(holdings, enrich=False)
        second = create_and_save_review(holdings, enrich=False)

        self.assertNotEqual(first["review_id"], second["review_id"])
        self.assertEqual(self.db.get_latest_equity_portfolio_review()["review_id"], second["review_id"])

    def test_review_route_uses_mocked_dhan_and_recommender_boundaries(self):
        holdings = [{
            "tradingsymbol": "RELIANCE",
            "exchange": "NSE",
            "quantity": 10,
            "average_price": 100,
            "last_price": 125,
            "invested_value": 1000,
            "current_value": 1250,
            "pnl": 250,
            "pnl_pct": 25,
            "day_change": 0,
        }]
        recommendation = {
            "direction": "BUY",
            "score": 3,
            "confidence": "HIGH",
            "success_probability": 80,
            "signals": ["trend"],
        }

        with (
            fresh_test_client() as client,
            patch("backend.recommender._analyze_stock", return_value={
                **recommendation,
            }),
        ):
            login(client)
            position = client.post(
                "/api/positions",
                json={
                    "tradingsymbol": "RELIANCE",
                    "exchange": "NSE",
                    "quantity": 10,
                    "average_price": 100,
                    "last_price": 125,
                },
                headers=csrf_headers(client),
            )
            self.assertEqual(position.status_code, 200, position.text)
            response = client.post(
                "/api/equity-portfolio/reviews",
                headers=csrf_headers(client),
            )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["summary"]["total_current"], 1250)
        self.assertEqual(response.json()["holdings"][0]["recommendation"]["direction"], "BUY")


if __name__ == "__main__":
    unittest.main()
