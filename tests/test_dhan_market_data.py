import unittest

from backend.brokers import dhan_market_data as md


class DhanMarketDataHelperTests(unittest.TestCase):
    def test_ticker_to_symbol_strips_exchange_suffixes(self):
        self.assertEqual(md._ticker_to_symbol("RELIANCE.NS"), "RELIANCE")
        self.assertEqual(md._ticker_to_symbol("reliance.bo"), "RELIANCE")
        self.assertEqual(md._ticker_to_symbol("TCS"), "TCS")

    def test_parse_ohlc_parallel_arrays(self):
        response = {
            "open": [10.0, 20.0],
            "high": [11.0, 21.0],
            "low": [9.0, 19.0],
            "close": [10.5, 20.5],
            "volume": [1000, 2000],
            "timestamp": [1_700_000_000, 1_700_086_400],
        }
        rows = md._parse_ohlc(response)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["Open"], 10.0)
        self.assertEqual(rows[-1]["Close"], 20.5)
        self.assertEqual(rows[-1]["Volume"], 2000)
        self.assertEqual(rows[-1]["Date"].isoformat().startswith("2023-11-"), True)

    def test_parse_ohlc_unwraps_data_envelope(self):
        response = {
            "data": {
                "open": [30.0],
                "high": [31.0],
                "low": [29.0],
                "close": [30.5],
                "volume": [500],
                "timestamp": [1_700_086_400],
            }
        }
        rows = md._parse_ohlc(response)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["Close"], 30.5)

    def test_parse_ohlc_skips_bad_timestamp_and_returns_empty(self):
        rows = md._parse_ohlc({"open": [1.0], "high": [1.0], "low": [1.0],
                               "close": [1.0], "volume": [1], "timestamp": ["not-a-number"]})
        self.assertEqual(rows, [])
        self.assertEqual(md._parse_ohlc({"unexpected": "shape"}), [])

    def test_resolve_security_prefers_nse_and_honours_bse_suffix(self):
        original = md._security_map
        try:
            md._security_map = {
                "RELIANCE": {"NSE_EQ": "2885", "BSE_EQ": "500325"},
            }
            self.assertEqual(md._resolve_security("RELIANCE.NS"), ("2885", "NSE_EQ"))
            self.assertEqual(md._resolve_security("RELIANCE"), ("2885", "NSE_EQ"))
            self.assertEqual(md._resolve_security("RELIANCE.BO"), ("500325", "BSE_EQ"))
            self.assertIsNone(md._resolve_security("UNKNOWN.NS"))
        finally:
            md._security_map = original

    def test_resolve_security_falls_back_to_available_segment(self):
        original = md._security_map
        try:
            md._security_map = {"X": {"BSE_EQ": "1"}}
            self.assertEqual(md._resolve_security("X"), ("1", "BSE_EQ"))
        finally:
            md._security_map = original


if __name__ == "__main__":
    unittest.main()