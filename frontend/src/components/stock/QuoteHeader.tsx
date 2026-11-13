"use client";

import { TrendingDown, TrendingUp } from "lucide-react";

export type Quote = {
  ticker: string;
  name: string;
  price: number | null;
  change: number | null;
  change_percent: number | null;
  volume?: number | null;
  high?: number | null;
  low?: number | null;
  open?: number | null;
  prev_close?: number | null;
  market_cap?: number | null;
};

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function QuoteHeader({ quote, loading }: { quote: Quote | null; loading: boolean }) {
  if (loading) {
    return <div className="h-16 animate-pulse rounded-xl bg-muted/50" />;
  }
  if (!quote) {
    return <p className="text-sm text-muted-foreground">Search a stock to see its live price.</p>;
  }

  const up = (quote.change ?? 0) >= 0;
  const price = quote.price ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{quote.ticker}</h1>
        <p className="text-base text-muted-foreground">{quote.name}</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums">
          {price !== null ? `₹${fmt(price)}` : "Not available"}
        </span>
        <span
          className={`inline-flex items-center gap-1 text-sm font-medium tabular-nums ${
            up ? "text-emerald-600" : "text-red-600"
          }`}
        >
          {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {quote.change !== null ? `${quote.change >= 0 ? "+" : ""}${fmt(quote.change)}` : "—"}
          {quote.change_percent !== null ? ` (${quote.change_percent >= 0 ? "+" : ""}${quote.change_percent.toFixed(2)}%)` : ""}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-muted-foreground sm:grid-cols-4">
        <div>Open <span className="text-foreground font-medium tabular-nums">₹{fmt(quote.open)}</span></div>
        <div>High <span className="text-foreground font-medium tabular-nums">₹{fmt(quote.high)}</span></div>
        <div>Low <span className="text-foreground font-medium tabular-nums">₹{fmt(quote.low)}</span></div>
        <div>Mkt cap <span className="text-foreground font-medium tabular-nums">{quote.market_cap ? `₹${fmt(quote.market_cap)} Cr` : "—"}</span></div>
      </div>
    </div>
  );
}