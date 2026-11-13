"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ModeSwitch } from "@/components/mode/ModeContext";
import { TickerSearch } from "@/components/TickerSearch";
import { QuoteHeader, type Quote } from "@/components/stock/QuoteHeader";
import { PaperTrading } from "@/components/paper/PaperTrading";
import { IndicatorsChart, type IndicatorPaneGroup } from "@/components/stock/IndicatorsChart";
import type { Candle } from "@/lib/indicators";
import { INDICATORS, INDICATOR_BY_ID, INDICATOR_PRESETS, type IndicatorLine } from "@/lib/indicator-registry";
import { getChartData, getQuote } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

const INTERVALS = ["1m", "5m", "15m", "1h"];

type ChartPoint = { time: string; open: number; high: number; low: number; close: number; volume: number };

function toEpoch(t: string): number {
  const iso = t.includes("T") ? t : `${t}T00:00:00`;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

function toCandles(points: ChartPoint[]): Candle[] {
  return points.map((p) => ({
    time: toEpoch(p.time),
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
    volume: p.volume,
  }));
}

function isPoint(value: unknown): value is ChartPoint {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.time === "string" &&
    ["open", "high", "low", "close", "volume"].every(
      (field) => typeof row[field] === "number" && Number.isFinite(row[field]),
    )
  );
}

const CATEGORIES = [...new Set(INDICATORS.map((i) => i.category))];

function IntradayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ticker, setTicker] = useState(searchParams.get("symbol") ?? "");
  const [interval, setIntervalValue] = useState("5m");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [loadingChart, setLoadingChart] = useState(false);
  const [activeIds, setActiveIds] = useState<string[]>([]);

  const toggle = (id: string) => {
    setActiveIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const applyPreset = (indicatorIds: string[]) => {
    setActiveIds(indicatorIds);
  };

  const select = useCallback(
    (symbol: string) => {
      const t = symbol.trim();
      if (!t) return;
      setTicker(t);
      router.replace(`/intraday?symbol=${encodeURIComponent(t)}`, { scroll: false });
    },
    [router],
  );

  // Poll the live quote for a moving price at a gentle cadence.
  useEffect(() => {
    if (!ticker) return;
    let active = true;
    const poll = async () => {
      setLoadingQuote(true);
      const q = await getQuote(ticker).catch(() => null);
      if (active) {
        setQuote(q as Quote | null);
        setLoadingQuote(false);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [ticker]);

  // Reload candles when the symbol or timeframe changes.
  useEffect(() => {
    if (!ticker) return;
    let active = true;
    setLoadingChart(true);
    getChartData(ticker, "5d", interval)
      .then((c) => {
        if (!active) return;
        const raw = Array.isArray((c as { data?: unknown[] })?.data) ? ((c as { data?: unknown[] }).data ?? []) : [];
        setChart(raw.filter(isPoint));
      })
      .catch(() => setChart([]))
      .finally(() => setLoadingChart(false));
    return () => {
      active = false;
    };
  }, [ticker, interval]);

  const candles = useMemo(() => toCandles(chart), [chart]);

  const { priceLines, panes } = useMemo(() => {
    const price: IndicatorLine[] = [];
    const sepMap = new Map<string, IndicatorPaneGroup>();
    for (const id of activeIds) {
      const def = INDICATOR_BY_ID[id];
      if (!def) continue;
      const lines = def.compute(candles);
      if (def.pane === "price") price.push(...lines);
      else sepMap.set(def.id, { id: def.id, label: def.name, lines });
    }
    return { priceLines: price, panes: Array.from(sepMap.values()) };
  }, [activeIds, candles]);

  const legendLines = useMemo(
    () => [...priceLines, ...panes.flatMap((p) => p.lines)],
    [priceLines, panes],
  );

  const price = quote?.price != null && Number.isFinite(quote.price) ? (quote.price as number) : null;

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Home
        </button>
        <ModeSwitch />
      </div>

      {!ticker ? (
        <div className="py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold">Intraday — live chart & paper trading</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Read live candles, layer {INDICATORS.length} technical indicators, and practise entries/exits with virtual money. No real orders.
          </p>
          <div className="max-w-md mx-auto">
            <TickerSearch value={ticker} onChange={setTicker} onSelect={select} placeholder="Search a stock — Reliance, TCS…" />
          </div>
        </div>
      ) : (
        <>
          <div>
            <TickerSearch value={ticker} onChange={setTicker} onSelect={select} placeholder="Search a stock" />
          </div>

          <QuoteHeader quote={quote} loading={loadingQuote && !quote} />

          <div className="flex gap-1 flex-wrap">
            {INTERVALS.map((i) => (
              <Button key={i} variant={interval === i ? "default" : "outline"} size="sm" onClick={() => setIntervalValue(i)} disabled={loadingChart}>
                {i}
              </Button>
            ))}
          </div>

          {/* Strategy presets */}
          <div className="flex flex-wrap gap-1.5">
            {INDICATOR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.indicatorIds)}
                title={p.description}
                className="rounded-full px-3 py-1 text-xs font-medium border border-primary/30 text-primary hover:bg-primary/5 transition-colors"
              >
                {p.name}
              </button>
            ))}
          </div>

          {/* Grouped indicator picker */}
          <div className="space-y-2">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-28 flex-none">{cat}</span>
                <div className="flex flex-wrap gap-1.5">
                  {INDICATORS.filter((i) => i.category === cat).map((ind) => {
                    const active = activeIds.includes(ind.id);
                    return (
                      <button
                        key={ind.id}
                        type="button"
                        onClick={() => toggle(ind.id)}
                        title={ind.short}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                          active
                            ? "bg-primary/10 text-primary border-primary/40"
                            : "bg-card text-muted-foreground border-border hover:text-foreground"
                        }`}
                      >
                        {ind.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card className="lg:col-span-2">
              <CardContent className="p-4">
                {candles.length > 0 ? (
                  <>
                    <IndicatorsChart candles={candles} priceLines={priceLines} panes={panes} height={560} />
                    {legendLines.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        {legendLines.map((line) => (
                          <span key={line.label} className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />
                            {line.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-[480px] flex items-center justify-center text-muted-foreground">
                    {loadingChart ? "Loading candles…" : "No intraday data for this stock."}
                  </div>
                )}
              </CardContent>
            </Card>

            <PaperTrading ticker={ticker} price={price} />
          </div>

          <p className="text-xs text-muted-foreground">
            Indicators are learning tools for reading price history — they are not buy/sell signals.
          </p>
        </>
      )}
    </div>
  );
}

export default function IntradayPage() {
  return (
    <Suspense>
      <IntradayContent />
    </Suspense>
  );
}