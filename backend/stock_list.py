"""Single source of truth for stock symbols.

All symbols come from config/symbols.csv. No fallbacks. No hardcoded lists.
If the CSV is missing or empty, the app has no symbols to work with.
"""

import csv
import os


def _load_symbols_from_csv() -> list[str]:
    """Load symbol list from CSV file. Path from DHAN_SYMBOLS_FILE env var."""
    csv_path = os.getenv("DHAN_SYMBOLS_FILE", "")
    
    # Build list of paths to try
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    possible_paths = []
    
    if csv_path:
        possible_paths.append(csv_path)
        if not os.path.isabs(csv_path):
            possible_paths.append(os.path.join(project_root, csv_path))
            if csv_path.startswith("./"):
                possible_paths.append(os.path.join(project_root, csv_path[2:]))
    
    # Default locations
    possible_paths.extend([
        os.path.join(project_root, "config", "symbols.csv"),
        os.path.join(project_root, "symbols.csv"),
    ])
    
    for path in possible_paths:
        try:
            if os.path.exists(path):
                symbols = []
                with open(path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        symbol = (row.get("symbol") or "").strip().upper()
                        if symbol:
                            symbols.append(symbol)
                if symbols:
                    print(f"[stock_list] Loaded {len(symbols)} symbols from {path}", flush=True)
                    return symbols
        except Exception as e:
            print(f"[stock_list] Error loading {path}: {e}", flush=True)
    
    raise RuntimeError(f"No symbols CSV found. Checked: {possible_paths}")


# Load at import time — raises if CSV missing
_SYMBOLS = _load_symbols_from_csv()


def get_all_symbols() -> list[str]:
    """Get all symbols from CSV."""
    return list(_SYMBOLS)


def get_nifty_50() -> list[str]:
    """First 50 symbols from CSV."""
    return _SYMBOLS[:50]


def get_nifty_100() -> list[str]:
    """First 100 symbols from CSV."""
    return _SYMBOLS[:100]


def get_bse_250() -> list[str]:
    """All symbols from CSV."""
    return list(_SYMBOLS)


def search_stocks(query: str, limit: int = 10) -> list[dict]:
    """Search stocks by ticker prefix."""
    query = query.strip().upper()
    if not query:
        return []
    
    results = []
    for symbol in _SYMBOLS:
        if symbol.startswith(query):
            score = 100 if symbol == query else 50
            results.append({
                "ticker": symbol,
                "name": symbol,
                "symbol": f"{symbol}.NS",
                "score": score,
            })
    
    results.sort(key=lambda x: -x["score"])
    return results[:limit]
