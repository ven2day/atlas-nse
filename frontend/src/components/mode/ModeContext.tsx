"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { LineChart, Zap } from "lucide-react";

export type TradingMode = "swing" | "intraday";

const STORAGE_KEY = "trading-mode";

type ModeContextValue = {
  mode: TradingMode;
  setMode: (mode: TradingMode) => void;
  ready: boolean;
};

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<TradingMode>("swing");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "swing" || saved === "intraday") setModeState(saved);
    } catch {
      // ignore storage errors
    }
    setReady(true);
  }, []);

  const setMode = (next: TradingMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

  return <ModeContext.Provider value={{ mode, setMode, ready }}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within a ModeProvider");
  return ctx;
}

/** Segmented control to flip between Swing and Intraday at any time. */
export function ModeSwitch() {
  const { mode, setMode, ready } = useMode();
  if (!ready) return null;

  const item = (m: TradingMode, label: string, Icon: typeof LineChart, activeColor: string) => {
    const active = mode === m;
    return (
      <button
        type="button"
        onClick={() => setMode(m)}
        aria-pressed={active}
        className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
          active ? `bg-background shadow-sm ${activeColor}` : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1 rounded-full bg-secondary p-1">
      {item("swing", "Swing", LineChart, "text-emerald-600")}
      {item("intraday", "Intraday", Zap, "text-amber-600")}
    </div>
  );
}