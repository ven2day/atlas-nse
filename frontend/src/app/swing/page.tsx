"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ModeSwitch } from "@/components/mode/ModeContext";
import { TickerSearch } from "@/components/TickerSearch";
import { CandlestickChart, isFinitePoint, type ChartPoint } from "@/components/stock/CandlestickChart";
import { QuoteHeader, type Quote } from "@/components/stock/QuoteHeader";
import { getChartData, getFundamentals, getQuote } from "@/lib/api";
import { METRIC_EXPLANATIONS } from "@/lib/explanations";
import { MetricTooltip } from "@/components/stock/MetricTooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";

const PERIODS = ["1mo", "3mo", "6mo", "1y"];

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not available";
  const n = Number(value);
  if (!Number.isFinite(n)) return "Not available";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtPct(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not available";
  const n = Number(value);
  if (!Number.isFinite(n)) return "Not available";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

function SwingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ticker, setTicker] = useState(searchParams.get("symbol") ?? "");
  const [period, setPeriod] = useState("6mo");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [fundamentals, setFundamentals] = useState<Record<string, unknown> | null>(null);
  const [chart, setChart] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (symbol: string) => {
    if (!symbol.trim()) return;
    setLoading(true);
    setTicker(symbol.trim());
    router.replace(`/swing?symbol=${encodeURIComponent(symbol.trim())}`, { scroll: false });
    try {
      const [q, f, c] = await Promise.all([
        getQuote(symbol.trim()).catch(() => null),
        getFundamentals(symbol.trim()).catch(() => null),
        getChartData(symbol.trim(), period, "1d").catch(() => ({ data: [] })),
      ]);
      setQuote(q as Quote | null);
      setFundamentals(f as Record<string, unknown> | null);
      setChart(
        Array.isArray((c as { data?: unknown[] })?.data)
          ? ((c as { data?: unknown[] }).data ?? []).filter(isFinitePoint)
          : [],
      );
    } finally {
      setLoading(false);
    }
  }, [period, router]);

  useEffect(() => {
    if (ticker) load(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const defaults = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN"];

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
        <ModeSwitch navigate symbol={ticker} />
      </div>

      {!ticker ? (
        <div className="py-16 text-center space-y-4">
          <h1 className="text-2xl font-bold">Swing research</h1>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Understand a company over weeks—live price, 6-month history, and fundamentals in plain English.
          </p>
          <div className="max-w-md mx-auto">
            <TickerSearch value={ticker} onChange={setTicker} onSelect={load} placeholder="Search a stock — Reliance, TCS…" />
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-2">
            {defaults.map((t) => (
              <Button key={t} variant="outline" size="sm" onClick={() => load(t)}>
                {t}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div>
            <TickerSearch value={ticker} onChange={setTicker} onSelect={load} placeholder="Search a stock" />
          </div>

          <QuoteHeader quote={quote} loading={loading} />

          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-muted-foreground">Price chart</h2>
                <div className="flex gap-1">
                  {PERIODS.map((p) => (
                    <Button
                      key={p}
                      variant={period === p ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPeriod(p)}
                      disabled={loading}
                    >
                      {p}
                    </Button>
                  ))}
                </div>
              </div>
              {chart.length > 0 ? (
                <CandlestickChart data={chart} height={460} />
              ) : (
                <div className="h-[460px] flex items-center justify-center text-muted-foreground">
                  {loading ? "Loading chart…" : "No chart data for this stock."}
                </div>
              )}
            </CardContent>
          </Card>

          <Fundamentals data={fundamentals} />
          <HowToReadStock data={fundamentals} />
        </>
      )}
    </div>
  );
}

function Fundamentals({ data }: { data: Record<string, unknown> | null }) {
  type Metric = { key: string; label: string; value: string };

  const sections: { title: string; metrics: Metric[] }[] = [
    {
      title: "Valuation",
      metrics: [
        { key: "pe_ratio", label: "P/E ratio", value: fmt(data?.pe_ratio) },
        { key: "forward_pe", label: "Forward P/E", value: fmt(data?.forward_pe) },
        { key: "pb_ratio", label: "Price / Book", value: fmt(data?.pb_ratio) },
        { key: "eps", label: "EPS", value: fmt(data?.eps) },
        { key: "dividend_yield", label: "Dividend yield", value: fmtPct(data?.dividend_yield) },
        { key: "market_cap", label: "Market cap", value: fmt(data?.market_cap) },
      ],
    },
    {
      title: "Quality",
      metrics: [
        { key: "roe", label: "Return on equity", value: fmtPct(data?.roe) },
        { key: "profit_margin", label: "Profit margin", value: fmtPct(data?.profit_margin) },
      ],
    },
    {
      title: "Risk",
      metrics: [
        { key: "debt_to_equity", label: "Debt / equity", value: fmt(data?.debt_to_equity) },
        { key: "beta", label: "Beta", value: fmt(data?.beta) },
      ],
    },
    {
      title: "Price Range",
      metrics: [
        { key: "fifty_two_week_high", label: "52w high", value: fmt(data?.fifty_two_week_high) },
        { key: "fifty_two_week_low", label: "52w low", value: fmt(data?.fifty_two_week_low) },
      ],
    },
  ];

  const sectorLabel = [data?.sector, data?.industry]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" · ");

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-lg font-semibold">Fundamentals</h2>
        {sectorLabel && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {sectorLabel}
            <MetricTooltip
              text={`${METRIC_EXPLANATIONS.sector.plain} ${METRIC_EXPLANATIONS.sector.howToRead}`}
            />
          </span>
        )}
        <span className="text-xs text-muted-foreground">Hover ⓘ to learn each metric</span>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-6 items-start">
        {sections.map((section) => (
          <section key={section.title}>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">{section.title}</h3>
            <div className="grid grid-cols-2 gap-2">
              {section.metrics.map((m) => {
                const explanation = METRIC_EXPLANATIONS[m.key];
                return (
                  <div key={m.key} className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
                    <p className="text-[11px] text-muted-foreground flex items-center justify-between gap-1">
                      <span>{m.label}</span>
                      {explanation && <MetricTooltip text={`${explanation.plain} ${explanation.howToRead}`} />}
                    </p>
                    <p className="text-sm font-medium tabular-nums">{m.value}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function HowToReadStock({ data }: { data: Record<string, unknown> | null }) {
  const [open, setOpen] = useState(false);
  const sector = typeof data?.sector === "string" ? data.sector : null;
  const pe = Number(data?.pe_ratio);
  const roe = Number(data?.roe);
  const debteq = Number(data?.debt_to_equity);
  const margin = Number(data?.profit_margin);
  const name = typeof data?.name === "string" ? data.name : null;

  const notes: string[] = [];
  if (sector) notes.push(`It operates in the ${sector} sector — compare it against sector peers, not the whole market.`);
  if (Number.isFinite(pe)) notes.push(`At a P/E of ~${pe.toFixed(1)}, the market is paying that much per ₹1 of profit${pe > 30 ? " — a premium that usually prices in fast growth." : pe < 12 ? " — relatively low, which could mean cheap or slow growth." : "."}`);
  if (Number.isFinite(roe)) notes.push(`It returns ~${roe.toFixed(1)}% on shareholders' money${roe >= 15 ? " — a sign of a durable, efficient business." : " — watch whether this improves over time."}`);
  if (Number.isFinite(debteq)) notes.push(`Debt is ~${debteq.toFixed(2)}× equity${debteq > 2 ? " — meaningfully leveraged; check whether profits comfortably cover interest." : " — a manageable level on the face of it."}`);
  if (Number.isFinite(margin)) notes.push(`It keeps ~${margin.toFixed(1)}% of revenue as profit${margin >= 15 ? " — strong pricing power." : " — thin, so costs/competition matter a lot."}`);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">How to read {name || "this stock"}</h2>
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide" : "Show"}
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>

        {open && (
          <>
            <p className="mt-3 text-xs text-muted-foreground">
              A guided pass through the fundamentals above — read each, form your own view.
            </p>
            {notes.length > 0 ? (
              <ol className="mt-3 space-y-2">
                {notes.map((n, i) => (
                  <li key={i} className="flex gap-3 text-sm text-muted-foreground">
                    <span className="flex-none h-5 w-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">{i + 1}</span>
                    <span>{n}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Search a stock to see its guided fundamentals walkthrough.</p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              This is educational — it explains the numbers, it doesn&apos;t tell you what to buy or sell.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function SwingPage() {
  return (
    <Suspense>
      <SwingContent />
    </Suspense>
  );
}