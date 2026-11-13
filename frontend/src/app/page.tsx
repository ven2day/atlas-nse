"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { TickerSearch } from "@/components/TickerSearch";
import { ModeSwitch, useMode } from "@/components/mode/ModeContext";
import { LineChart, Zap, ArrowRight, Sparkles } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const { mode } = useMode();
  const [ticker, setTicker] = useState("");

  const open = useCallback(
    (target: "swing" | "intraday", symbol?: string) => {
      router.push(
        symbol ? `/${target}?symbol=${encodeURIComponent(symbol)}` : `/${target}`,
      );
    },
    [router],
  );

  const handleSelect = useCallback(
    (symbol: string) => {
      open(mode, symbol);
    },
    [mode, open],
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-8 flex justify-center">
          <ModeSwitch />
        </div>

        <section className="flex flex-col items-center text-center">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Pick your mode — switch anytime
          </span>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Trade with a plan
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Research stocks for weeks-long swings, or practise fast intraday
            mechanics on live charts and paper trades.
          </p>

          <div className="mt-9 w-full max-w-2xl">
            <TickerSearch
              value={ticker}
              onChange={setTicker}
              onSelect={handleSelect}
              placeholder="Search a stock — Reliance, TCS, HDFC…"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Opens in {mode === "swing" ? "Swing (research)" : "Intraday (live chart)"}. You can flip via the switch above.
            </p>
          </div>
        </section>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ModeCard
            active={mode === "swing"}
            icon={<LineChart className="h-6 w-6 text-emerald-600" />}
            title="Swing"
            tagline="Research & fundamentals"
            description="A calm, company-first view: live price, 6-month history, and fundamentals explained in plain English."
            cta="Explore a stock"
            onClick={() => open("swing")}
          />
          <ModeCard
            active={mode === "intraday"}
            icon={<Zap className="h-6 w-6 text-amber-500" />}
            title="Intraday"
            tagline="Live chart & paper trading"
            description="Read live candles and practise entries/exits with virtual money — no real orders."
            cta="Open the chart"
            onClick={() => open("intraday")}
          />
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  icon,
  title,
  tagline,
  description,
  cta,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  title: string;
  tagline: string;
  description: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl border p-6 transition-colors ${
        active
          ? "border-primary/50 bg-primary/5"
          : "border-border/60 bg-card hover:border-border hover:bg-secondary/40"
      }`}
    >
      <div className="mb-3">{icon}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{tagline}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
        {cta} <ArrowRight className="h-4 w-4" />
      </span>
    </button>
  );
}