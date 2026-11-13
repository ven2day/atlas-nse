// Plain-language explanations for the fundamentals shown in Swing mode.
// Each entry is a one-line "what it means" plus a one-line "how to read it".
export type MetricExplanation = {
  label: string;
  plain: string;
  howToRead: string;
};

export const METRIC_EXPLANATIONS: Record<string, MetricExplanation> = {
  sector: {
    label: "Sector & industry",
    plain: "The broad group this company belongs to (e.g. Energy, IT) and the narrower industry inside it.",
    howToRead: "Use it for context — compare the stock to peers in its own sector rather than to the whole market.",
  },
  pe_ratio: {
    label: "P/E ratio",
    plain: "Price ÷ earnings per share. How much you pay for each ₹1 of the company's profit.",
    howToRead: "A high P/E means the market expects fast growth; a low P/E can mean cheaper — or that growth is expected to slow.",
  },
  forward_pe: {
    label: "Forward P/E",
    plain: "The P/E using *estimated* future earnings instead of last year's actual earnings.",
    howToRead: "Lower than trailing P/E usually means analysts expect earnings to rise. Compare the two to see the growth expectation.",
  },
  pb_ratio: {
    label: "Price / Book",
    plain: "Price ÷ book value per share (what's left if assets were sold and debts paid).",
    howToRead: "Below 1 can mean the stock trades below its accounting net worth — but it can also signal real problems.",
  },
  roe: {
    label: "Return on equity",
    plain: "Profit as a % of shareholders' money. How efficiently the company turns your capital into profit.",
    howToRead: "Consistently high ROE (say 15%+) often points to a business with a durable advantage. Watch whether it's stable over years.",
  },
  eps: {
    label: "EPS",
    plain: "Earnings per share — the company's profit divided by the number of shares.",
    howToRead: "Look at whether EPS is growing year over year. A single quarter matters less than the trend.",
  },
  dividend_yield: {
    label: "Dividend yield",
    plain: "The annual dividend per share as a % of the current price.",
    howToRead: "Higher yields look attractive but check whether dividends are actually being paid from real profits, not debt.",
  },
  market_cap: {
    label: "Market cap",
    plain: "Share price × total shares. The total value the market places on the company.",
    howToRead: "It tells you the company's size — large-caps are usually steadier, small-caps can grow faster but swing more.",
  },
  beta: {
    label: "Beta",
    plain: "How much the stock tends to move relative to the whole market.",
    howToRead: "Beta > 1 moves more than the market (more aggressive), beta < 1 moves less (more defensive).",
  },
  debt_to_equity: {
    label: "Debt / equity",
    plain: "Total debt ÷ shareholders' equity. How much the company relies on borrowing.",
    howToRead: "A very high number means more risk if earnings dip — interest still has to be paid. Compare with sector norms.",
  },
  profit_margin: {
    label: "Profit margin",
    plain: "How much of every ₹1 of revenue is left as profit after all costs.",
    howToRead: "A stable or rising margin is a good sign of pricing power. A high margin can mean the business is hard to copy.",
  },
  revenue: {
    label: "Revenue",
    plain: "The total money the company takes in from selling its goods or services.",
    howToRead: "Revenue growth shows demand. Steady revenue but no profit growth can signal rising costs.",
  },
  fifty_two_week_high: {
    label: "52w high",
    plain: "The highest price the stock reached in the last year.",
    howToRead: "Use it with the 52w low to see where today's price sits in its yearly range — the top, bottom, or middle.",
  },
  fifty_two_week_low: {
    label: "52w low",
    plain: "The lowest price the stock reached in the last year.",
    howToRead: "Combine with the 52w high (and the current price) to judge whether a stock is near its highs, lows, or mid-range.",
  },
};