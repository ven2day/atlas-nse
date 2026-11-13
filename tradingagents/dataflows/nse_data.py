"""NSE-specific data functions — stubs for Phase 2, full implementation with Dhan in Phase 4."""


def get_fii_dii_activity(date: str) -> str:
    """Get FII/DII buy/sell activity for a given date.

    Args:
        date: Date in yyyy-mm-dd format

    Returns:
        Formatted string with FII/DII net buy/sell data
    """
    # TODO: Implement with NSE website scraping or Dhan API
    return (
        f"FII/DII activity data for {date} is not available in the current data source. "
        "This will be available when Dhan API integration is enabled. "
        "For now, check https://www.moneycontrol.com/stocks/marketstats/fii_dii_activity/ "
        "for the latest FII/DII data."
    )


def get_bulk_block_deals(symbol: str, start_date: str, end_date: str) -> str:
    """Get bulk and block deal data for a symbol.

    Args:
        symbol: Stock ticker symbol
        start_date: Start date in yyyy-mm-dd format
        end_date: End date in yyyy-mm-dd format

    Returns:
        Formatted string with bulk/block deal information
    """
    # TODO: Implement with NSE website scraping or Dhan API
    return (
        f"Bulk/block deals data for {symbol} from {start_date} to {end_date} "
        "is not available in the current data source. "
        "This will be available when Dhan API integration is enabled."
    )


def get_delivery_percentage(symbol: str, date: str) -> str:
    """Get delivery percentage data for a symbol.

    High delivery percentage indicates genuine buying interest.

    Args:
        symbol: Stock ticker symbol
        date: Date in yyyy-mm-dd format

    Returns:
        Formatted string with delivery data
    """
    # TODO: Implement with NSE website scraping or Dhan API
    return (
        f"Delivery percentage data for {symbol} on {date} "
        "is not available in the current data source. "
        "This will be available when Dhan API integration is enabled."
    )
