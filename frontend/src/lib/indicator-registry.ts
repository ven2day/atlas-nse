// @ts-nocheck
/**
 * indicator-registry.ts
 *
 * Single source of truth for the indicator picker. Each entry describes one
 * indicator: its name, a plain-English "what it tells you" explainer (teaching,
 * never a buy/sell signal), its category, whether it draws ON the price or in
 * its OWN panel, and how to compute its line(s).
 *
 * To add an indicator later: verify its @debut/indicators output, add a calc
 * fn in indicators.ts, then add one entry here. The picker updates automatically.
 */

"use client";

import {
  sma, ema, wma, dema, bollinger, rsi, macd, adx, stochastic, atr, roc,
  cmo, trix, momentum, cci, psar, vwma, obv, mfi, aroon, supertrend, vortex, keltner,
  dpo, coppock, ultimateOsc, massIndex, choppiness, awesome, accelerator, bullBearPower,
  forceIndex, easeOfMovement, chaikinOsc, pvt, kst, tsi, rvi, fisher, smiErgodic, elderRay,
  hma, tema, alma, smma, mcginley, lsma, historicalVol, donchian, envelopes, klinger, dmi,
  type Candle, type LinePoint,
} from "./indicators";

export type IndicatorPane = "price" | "separate";
export type IndicatorCategory =
  | "Moving Averages"
  | "Momentum"
  | "Trend"
  | "Volatility"
  | "Volume";

export interface IndicatorLine {
  label: string;
  color: string;
  data: LinePoint[];
}

// ---- Configurable settings (Groww-style) ----
export type ParamControl = "number" | "select" | "color" | "toggle";
export interface ParamSpec {
  key: string;
  label: string;
  control: ParamControl;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}
export type ParamValues = Record<string, number | string | boolean>;

export const SOURCE_OPTIONS = [
  { value: "close", label: "Close" },
  { value: "open", label: "Open" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];
export const SMOOTH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "sma", label: "SMA" },
  { value: "ema", label: "EMA" },
];

// Common param builders
export const P_LENGTH = (d: number): ParamSpec => ({ key: "length", label: "Length", control: "number", default: d, min: 1, max: 400, step: 1 });
export const P_SOURCE: ParamSpec = { key: "source", label: "Source", control: "select", default: "close", options: SOURCE_OPTIONS };
export const P_COLOR = (d: string): ParamSpec => ({ key: "color", label: "Color", control: "color", default: d });
export const P_SMOOTH_TYPE: ParamSpec = { key: "smoothingType", label: "Smoothing Line", control: "select", default: "none", options: SMOOTH_OPTIONS };
export const P_SMOOTH_LEN: ParamSpec = { key: "smoothingLength", label: "Smoothing Length", control: "number", default: 9, min: 1, max: 200, step: 1 };

// Read helpers (params always merged with defaults at call sites, but stay safe)
const num = (p: ParamValues | undefined, k: string, d: number) => {
  const v = Number(p?.[k]);
  return Number.isFinite(v) ? v : d;
};
const str = (p: ParamValues | undefined, k: string, d: string) => {
  const v = p?.[k];
  return typeof v === "string" && v ? v : d;
};
const bool = (p: ParamValues | undefined, k: string, d: boolean) => {
  const v = p?.[k];
  return typeof v === "boolean" ? v : d;
};

// Use a different OHLC field as the "close" input (for the Source setting)
function withSource(candles: Candle[], source: string): Candle[] {
  if (!source || source === "close") return candles;
  return candles.map((c) => ({
    ...c,
    close: (source === "open" ? c.open : source === "high" ? c.high : source === "low" ? c.low : c.close),
  }));
}

// Optionally smooth a line with an SMA/EMA of the given length
function smoothLine(line: LinePoint[], type: string, length: number): LinePoint[] {
  if (!type || type === "none" || !length || length < 2 || line.length === 0) return line;
  const vals = line.map((p) => p.value);
  const out: number[] = [];
  if (type === "sma") {
    for (let i = 0; i < vals.length; i++) {
      if (i < length - 1) { out.push(NaN); continue; }
      let s = 0;
      for (let j = i - length + 1; j <= i; j++) s += vals[j];
      out.push(s / length);
    }
  } else {
    const k = 2 / (length + 1);
    let prev = vals[0];
    for (let i = 0; i < vals.length; i++) {
      prev = i === 0 ? vals[0] : vals[i] * k + prev * (1 - k);
      out.push(prev);
    }
  }
  const res: LinePoint[] = [];
  for (let i = 0; i < line.length; i++) {
    if (!Number.isNaN(out[i])) res.push({ time: line[i].time, value: out[i] });
  }
  return res;
}

export interface IndicatorDef {
  id: string;
  name: string;
  short: string; // plain-English "what it tells you" (educational, not advice)
  category: IndicatorCategory;
  pane: IndicatorPane;
  params?: ParamSpec[]; // tunable settings (gear icon). Omitted = no settings yet.
  compute: (candles: Candle[], p?: ParamValues) => IndicatorLine[];
}

/** Resolve an indicator's params merged with its schema defaults. */
export function defaultParams(def: IndicatorDef): ParamValues {
  const out: ParamValues = {};
  for (const s of def.params ?? []) out[s.key] = s.default;
  return out;
}
export function mergeParams(def: IndicatorDef, chosen?: ParamValues): ParamValues {
  return { ...defaultParams(def), ...(chosen || {}) };
}

export const INDICATORS: IndicatorDef[] = [
  // ---- Moving Averages (price overlays) ----
  {
    id: "sma",
    name: "Simple Moving Average (SMA)",
    short: "The average closing price over a period — smooths out day-to-day noise to show the broader direction.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_SOURCE, P_SMOOTH_TYPE, P_SMOOTH_LEN, P_COLOR("#2563eb")],
    compute: (c, p) => {
      const length = num(p, "length", 20);
      let line = sma(withSource(c, str(p, "source", "close")), length);
      line = smoothLine(line, str(p, "smoothingType", "none"), num(p, "smoothingLength", 9));
      return [{ label: `SMA ${length}`, color: str(p, "color", "#2563eb"), data: line }];
    },
  },
  {
    id: "ema",
    name: "Exponential Moving Average (EMA)",
    short: "Like the SMA, but weights recent prices more heavily — so it reacts faster to new moves.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_SOURCE, P_SMOOTH_TYPE, P_SMOOTH_LEN, P_COLOR("#0891b2")],
    compute: (c, p) => {
      const length = num(p, "length", 20);
      let line = ema(withSource(c, str(p, "source", "close")), length);
      line = smoothLine(line, str(p, "smoothingType", "none"), num(p, "smoothingLength", 9));
      return [{ label: `EMA ${length}`, color: str(p, "color", "#0891b2"), data: line }];
    },
  },
  {
    id: "wma",
    name: "Weighted Moving Average (WMA)",
    short: "A moving average that gives steadily more weight to recent prices than older ones.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_SOURCE, P_COLOR("#7c3aed")],
    compute: (c, p) => {
      const length = num(p, "length", 20);
      return [{ label: `WMA ${length}`, color: str(p, "color", "#7c3aed"), data: wma(withSource(c, str(p, "source", "close")), length) }];
    },
  },
  {
    id: "dema",
    name: "Double Exponential MA (DEMA)",
    short: "A smoother, lower-lag moving average designed to track price more closely than a plain EMA.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_SOURCE, P_COLOR("#db2777")],
    compute: (c, p) => {
      const length = num(p, "length", 20);
      return [{ label: `DEMA ${length}`, color: str(p, "color", "#db2777"), data: dema(withSource(c, str(p, "source", "close")), length) }];
    },
  },
  {
    id: "bollinger",
    name: "Bollinger Bands",
    short: "A moving average with an upper and lower band. The bands widen when price swings are larger and narrow when calmer.",
    category: "Volatility",
    pane: "price",
    params: [
      P_LENGTH(20),
      { key: "stdDev", label: "Std Dev", control: "number", default: 2, min: 0.5, max: 5, step: 0.1 },
      P_SOURCE,
    ],
    compute: (c, p) => {
      const period = num(p, "length", 20);
      const sd = num(p, "stdDev", 2);
      const b = bollinger(withSource(c, str(p, "source", "close")), period, sd);
      return [
        { label: "Upper", color: "#94a3b8", data: b.upper },
        { label: "Middle", color: "#64748b", data: b.middle },
        { label: "Lower", color: "#94a3b8", data: b.lower },
      ];
    },
  },

  // ---- Momentum / oscillators (own panel) ----
  {
    id: "rsi",
    name: "Relative Strength Index (RSI)",
    short: "Measures how fast price has risen or fallen, on a 0–100 scale. Often used to gauge whether a stock has moved a lot recently.",
    category: "Momentum",
    pane: "separate",
    params: [P_LENGTH(14), P_SOURCE, P_COLOR("#9333ea")],
    compute: (c, p) => {
      const length = num(p, "length", 14);
      return [{ label: `RSI ${length}`, color: str(p, "color", "#9333ea"), data: rsi(withSource(c, str(p, "source", "close")), length) }];
    },
  },
  {
    id: "macd",
    name: "MACD",
    short: "Compares a faster and slower moving average to show shifts in momentum. The signal line is a smoothed version of it.",
    category: "Momentum",
    pane: "separate",
    params: [
      { key: "fast", label: "Fast Length", control: "number", default: 12, min: 1, max: 200, step: 1 },
      { key: "slow", label: "Slow Length", control: "number", default: 26, min: 1, max: 400, step: 1 },
      { key: "signal", label: "Signal Length", control: "number", default: 9, min: 1, max: 200, step: 1 },
    ],
    compute: (c, p) => {
      const m = macd(c, num(p, "fast", 12), num(p, "slow", 26), num(p, "signal", 9));
      return [
        { label: "MACD", color: "#2563eb", data: m.macd },
        { label: "Signal", color: "#f59e0b", data: m.signal },
      ];
    },
  },
  {
    id: "stochastic",
    name: "Stochastic Oscillator",
    short: "Shows where the latest close sits within the recent high–low range, on a 0–100 scale.",
    category: "Momentum",
    pane: "separate",
    params: [
      { key: "length", label: "%K Length", control: "number", default: 14, min: 1, max: 200, step: 1 },
      { key: "smooth", label: "%D Smoothing", control: "number", default: 3, min: 1, max: 50, step: 1 },
    ],
    compute: (c, p) => {
      const s = stochastic(c, num(p, "length", 14), num(p, "smooth", 3));
      return [
        { label: "%K", color: "#2563eb", data: s.k },
        { label: "%D", color: "#f59e0b", data: s.d },
      ];
    },
  },
  {
    id: "roc",
    name: "Rate of Change (ROC)",
    short: "The percentage change in price over a set number of periods — a simple momentum reading.",
    category: "Momentum",
    pane: "separate",
    params: [P_LENGTH(12), P_COLOR("#0d9488")],
    compute: (c, p) => {
      const n = num(p, "length", 12);
      return [{ label: `ROC ${n}`, color: str(p, "color", "#0d9488"), data: roc(c, n) }];
    },
  },

  // ---- Trend ----
  {
    id: "adx",
    name: "Average Directional Index (ADX)",
    short: "Measures how strong a trend is, not its direction, on a 0–100 scale. Higher means a stronger trend. For up vs down pressure, add the DMI indicator.",
    category: "Trend",
    pane: "separate",
    params: [
      P_LENGTH(14),
      { key: "showDI", label: "Show +DI / −DI", control: "toggle", default: false },
      P_COLOR("#dc2626"),
    ],
    compute: (c, p) => {
      const length = num(p, "length", 14);
      const a = adx(c, length);
      const lines = [{ label: `ADX ${length}`, color: str(p, "color", "#dc2626"), data: a.adx }];
      if (bool(p, "showDI", false)) {
        lines.push({ label: "+DI", color: "#16a34a", data: a.pdi });
        lines.push({ label: "−DI", color: "#f59e0b", data: a.mdi });
      }
      return lines;
    },
  },

  // ---- Volatility ----
  {
    id: "atr",
    name: "Average True Range (ATR)",
    short: "The average size of recent price ranges — a measure of how much a stock typically moves, i.e. its volatility.",
    category: "Volatility",
    pane: "separate",
    params: [P_LENGTH(14), P_COLOR("#ea580c")],
    compute: (c, p) => {
      const n = num(p, "length", 14);
      return [{ label: `ATR ${n}`, color: str(p, "color", "#ea580c"), data: atr(c, n) }];
    },
  },

  // ===== Batch 2 =====

  // Moving Averages / overlays
  {
    id: "vwma",
    name: "Volume Weighted MA (VWMA)",
    short: "A moving average that gives more weight to days with higher trading volume — so busier days shape the line more.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_COLOR("#0ea5e9")],
    compute: (c, p) => {
      const n = num(p, "length", 20);
      return [{ label: `VWMA ${n}`, color: str(p, "color", "#0ea5e9"), data: vwma(c, n) }];
    },
  },
  {
    id: "supertrend",
    name: "SuperTrend",
    short: "A line that sits below or above price to help visualise the current trend direction. It flips sides as the trend changes.",
    category: "Trend",
    pane: "price",
    params: [
      P_LENGTH(10),
      { key: "mult", label: "Multiplier", control: "number", default: 3, min: 0.5, max: 10, step: 0.5 },
      P_COLOR("#9333ea"),
    ],
    compute: (c, p) => [{ label: "SuperTrend", color: str(p, "color", "#9333ea"), data: supertrend(c, num(p, "length", 10), num(p, "mult", 3)) }],
  },
  {
    id: "psar",
    name: "Parabolic SAR",
    short: "A series of dots that trail the price, used to visualise trend direction and where it may be pausing or reversing.",
    category: "Trend",
    pane: "price",
    params: [P_COLOR("#e11d48")],
    compute: (c, p) => [{ label: "PSAR", color: str(p, "color", "#e11d48"), data: psar(c) }],
  },
  {
    id: "keltner",
    name: "Keltner Channel",
    short: "A moving-average channel based on volatility (ATR). Price tends to stay within the bands; moves outside can signal strong momentum.",
    category: "Volatility",
    pane: "price",
    params: [P_LENGTH(20)],
    compute: (c, p) => {
      const k = keltner(c, num(p, "length", 20));
      return [
        { label: "Upper", color: "#94a3b8", data: k.upper },
        { label: "Middle", color: "#64748b", data: k.middle },
        { label: "Lower", color: "#94a3b8", data: k.lower },
      ];
    },
  },

  // Momentum / oscillators
  {
    id: "cci",
    name: "Commodity Channel Index (CCI)",
    short: "Measures how far price has moved from its recent average. Large positive or negative readings show unusually strong moves.",
    category: "Momentum",
    pane: "separate",
    params: [P_LENGTH(20), P_COLOR("#0d9488")],
    compute: (c, p) => {
      const n = num(p, "length", 20);
      return [{ label: `CCI ${n}`, color: str(p, "color", "#0d9488"), data: cci(c, n) }];
    },
  },
  {
    id: "cmo",
    name: "Chande Momentum Oscillator (CMO)",
    short: "A momentum reading from −100 to +100 that compares recent gains and losses. Extremes show strong one-sided moves.",
    category: "Momentum",
    pane: "separate",
    params: [P_LENGTH(14), P_COLOR("#7c3aed")],
    compute: (c, p) => {
      const n = num(p, "length", 14);
      return [{ label: `CMO ${n}`, color: str(p, "color", "#7c3aed"), data: cmo(c, n) }];
    },
  },
  {
    id: "trix",
    name: "TRIX",
    short: "A smoothed momentum line that filters out small wiggles, used to study the underlying direction of momentum.",
    category: "Momentum",
    pane: "separate",
    params: [P_LENGTH(15), P_COLOR("#2563eb")],
    compute: (c, p) => {
      const n = num(p, "length", 15);
      return [{ label: `TRIX ${n}`, color: str(p, "color", "#2563eb"), data: trix(c, n) }];
    },
  },
  {
    id: "momentum",
    name: "Momentum",
    short: "The simplest momentum measure — how much the price has changed over a set number of periods.",
    category: "Momentum",
    pane: "separate",
    params: [P_LENGTH(10), P_COLOR("#db2777")],
    compute: (c, p) => {
      const n = num(p, "length", 10);
      return [{ label: `Momentum ${n}`, color: str(p, "color", "#db2777"), data: momentum(c, n) }];
    },
  },
  {
    id: "mfi",
    name: "Money Flow Index (MFI)",
    short: "Like RSI but factoring in volume — a 0–100 reading of buying vs selling pressure based on price and how much traded.",
    category: "Momentum",
    pane: "separate",
    params: [P_LENGTH(14), P_COLOR("#16a34a")],
    compute: (c, p) => {
      const n = num(p, "length", 14);
      return [{ label: `MFI ${n}`, color: str(p, "color", "#16a34a"), data: mfi(c, n) }];
    },
  },

  // Trend / direction
  {
    id: "aroon",
    name: "Aroon",
    short: "Two lines (0–100) measuring how recently the highest high and lowest low occurred — used to gauge trend strength and direction.",
    category: "Trend",
    pane: "separate",
    params: [P_LENGTH(14)],
    compute: (c, p) => {
      const a = aroon(c, num(p, "length", 14));
      return [
        { label: "Aroon Up", color: "#16a34a", data: a.up },
        { label: "Aroon Down", color: "#dc2626", data: a.down },
      ];
    },
  },
  {
    id: "vortex",
    name: "Vortex Indicator",
    short: "Two lines capturing upward vs downward movement. When one crosses above the other, it can mark a shift in trend direction.",
    category: "Trend",
    pane: "separate",
    params: [P_LENGTH(14)],
    compute: (c, p) => {
      const v = vortex(c, num(p, "length", 14));
      return [
        { label: "VI +", color: "#16a34a", data: v.plus },
        { label: "VI −", color: "#dc2626", data: v.minus },
      ];
    },
  },

  // Volume
  {
    id: "obv",
    name: "On-Balance Volume (OBV)",
    short: "A running total that adds volume on up days and subtracts it on down days — used to see whether volume is flowing in or out.",
    category: "Volume",
    pane: "separate",
    params: [P_COLOR("#0891b2")],
    compute: (c, p) => [{ label: "OBV", color: str(p, "color", "#0891b2"), data: obv(c) }],
  },

  // ===== Batch 3 =====

  // Momentum
  {
    id: "dpo",
    name: "Detrended Price Oscillator (DPO)",
    short: "Strips out the longer-term trend to highlight shorter price cycles — useful for spotting rhythm in the ups and downs.",
    category: "Momentum",
    pane: "separate",
    params: [P_LENGTH(20), P_COLOR("#7c3aed")],
    compute: (c, p) => {
      const n = num(p, "length", 20);
      return [{ label: `DPO ${n}`, color: str(p, "color", "#7c3aed"), data: dpo(c, n) }];
    },
  },
  {
    id: "coppock",
    name: "Coppock Curve",
    short: "A slow momentum curve, traditionally used on long-term charts to study major shifts in direction.",
    category: "Momentum",
    pane: "separate",
    params: [P_COLOR("#2563eb")],
    compute: (c, p) => [{ label: "Coppock", color: str(p, "color", "#2563eb"), data: coppock(c) }],
  },
  {
    id: "ultimate",
    name: "Ultimate Oscillator",
    short: "Blends short, medium and long-term momentum into one 0–100 line, aiming to reduce false signals from any single timeframe.",
    category: "Momentum",
    pane: "separate",
    params: [P_COLOR("#9333ea")],
    compute: (c, p) => [{ label: "Ultimate", color: str(p, "color", "#9333ea"), data: ultimateOsc(c) }],
  },
  {
    id: "awesome",
    name: "Awesome Oscillator (AO)",
    short: "Compares recent momentum to a longer average, shown as a histogram-style line around zero — a quick read on momentum shifts.",
    category: "Momentum",
    pane: "separate",
    params: [P_COLOR("#0d9488")],
    compute: (c, p) => [{ label: "AO", color: str(p, "color", "#0d9488"), data: awesome(c) }],
  },
  {
    id: "accelerator",
    name: "Accelerator Oscillator (AC)",
    short: "Measures whether momentum itself is speeding up or slowing down — an early read on changes in the pace of a move.",
    category: "Momentum",
    pane: "separate",
    params: [P_COLOR("#db2777")],
    compute: (c, p) => [{ label: "AC", color: str(p, "color", "#db2777"), data: accelerator(c) }],
  },
  {
    id: "kst",
    name: "Know Sure Thing (KST)",
    short: "Combines several rate-of-change readings into one smoothed momentum line with a signal line.",
    category: "Momentum",
    pane: "separate",
    compute: (c) => {
      const k = kst(c);
      return [
        { label: "KST", color: "#2563eb", data: k.a },
        { label: "Signal", color: "#f59e0b", data: k.b },
      ];
    },
  },
  {
    id: "tsi",
    name: "True Strength Index (TSI)",
    short: "A smoothed momentum oscillator with a signal line, used to study the strength and direction of price moves.",
    category: "Momentum",
    pane: "separate",
    compute: (c) => {
      const t = tsi(c);
      return [
        { label: "TSI", color: "#2563eb", data: t.a },
        { label: "Signal", color: "#f59e0b", data: t.b },
      ];
    },
  },
  {
    id: "rvi",
    name: "Relative Vigour Index (RVI)",
    short: "Compares where price closes relative to its open over time, with a signal line — a read on the conviction behind moves.",
    category: "Momentum",
    pane: "separate",
    compute: (c) => {
      const r = rvi(c);
      return [
        { label: "RVI", color: "#2563eb", data: r.a },
        { label: "Signal", color: "#f59e0b", data: r.b },
      ];
    },
  },
  {
    id: "fisher",
    name: "Fisher Transform",
    short: "Sharpens price turning points into clearer peaks and troughs, with a trigger line, to highlight potential reversals.",
    category: "Momentum",
    pane: "separate",
    compute: (c) => {
      const f = fisher(c);
      return [
        { label: "Fisher", color: "#9333ea", data: f.a },
        { label: "Trigger", color: "#f59e0b", data: f.b },
      ];
    },
  },
  {
    id: "smi",
    name: "SMI Ergodic",
    short: "A smoothed momentum oscillator (a refined version of the Stochastic Momentum Index) with a signal line.",
    category: "Momentum",
    pane: "separate",
    compute: (c) => {
      const s = smiErgodic(c);
      return [
        { label: "SMI", color: "#2563eb", data: s.a },
        { label: "Signal", color: "#f59e0b", data: s.b },
      ];
    },
  },

  // Trend / volatility
  {
    id: "massindex",
    name: "Mass Index",
    short: "Watches the high–low range expanding and contracting — used to spot potential reversals when volatility bulges.",
    category: "Volatility",
    pane: "separate",
    params: [P_COLOR("#ea580c")],
    compute: (c, p) => [{ label: "Mass Index", color: str(p, "color", "#ea580c"), data: massIndex(c) }],
  },
  {
    id: "choppiness",
    name: "Choppiness Index",
    short: "A 0–100 reading of whether the market is trending (low) or moving sideways and choppy (high). It shows condition, not direction.",
    category: "Volatility",
    pane: "separate",
    params: [P_LENGTH(14), P_COLOR("#64748b")],
    compute: (c, p) => {
      const n = num(p, "length", 14);
      return [{ label: `Choppiness ${n}`, color: str(p, "color", "#64748b"), data: choppiness(c, n) }];
    },
  },
  {
    id: "elderray",
    name: "Elder Ray (Bull/Bear Power)",
    short: "Two lines showing buying power (bull) and selling power (bear) relative to an average — a read on which side is in control.",
    category: "Trend",
    pane: "separate",
    compute: (c) => {
      const e = elderRay(c);
      return [
        { label: "Bull Power", color: "#16a34a", data: e.a },
        { label: "Bear Power", color: "#dc2626", data: e.b },
      ];
    },
  },
  {
    id: "bullbear",
    name: "Bull Bear Power",
    short: "A single line summarising whether buyers or sellers have the upper hand relative to a recent average.",
    category: "Trend",
    pane: "separate",
    params: [P_LENGTH(13), P_COLOR("#0891b2")],
    compute: (c, p) => {
      const n = num(p, "length", 13);
      return [{ label: `Bull Bear ${n}`, color: str(p, "color", "#0891b2"), data: bullBearPower(c, n) }];
    },
  },

  // Volume
  {
    id: "forceindex",
    name: "Force Index",
    short: "Combines price change and volume to measure the power behind a move — bigger moves on bigger volume read stronger.",
    category: "Volume",
    pane: "separate",
    params: [P_COLOR("#7c3aed")],
    compute: (c, p) => [{ label: "Force Index", color: str(p, "color", "#7c3aed"), data: forceIndex(c) }],
  },
  {
    id: "eom",
    name: "Ease of Movement",
    short: "Relates price change to volume to show how 'easily' price is moving — high values mean price rises on light volume.",
    category: "Volume",
    pane: "separate",
    params: [P_COLOR("#0d9488")],
    compute: (c, p) => [{ label: "EOM", color: str(p, "color", "#0d9488"), data: easeOfMovement(c) }],
  },
  {
    id: "chaikinosc",
    name: "Chaikin Oscillator",
    short: "Tracks the momentum of money flowing in and out (accumulation vs distribution) using price and volume together.",
    category: "Volume",
    pane: "separate",
    params: [P_COLOR("#2563eb")],
    compute: (c, p) => [{ label: "Chaikin Osc", color: str(p, "color", "#2563eb"), data: chaikinOsc(c) }],
  },
  {
    id: "pvt",
    name: "Price Volume Trend (PVT)",
    short: "A cumulative line combining price change and volume — similar to OBV but weighting by how much price moved.",
    category: "Volume",
    pane: "separate",
    params: [P_COLOR("#db2777")],
    compute: (c, p) => [{ label: "PVT", color: str(p, "color", "#db2777"), data: pvt(c) }],
  },

  // ===== Batch 4 =====

  // Moving Averages (overlays)
  {
    id: "hma",
    name: "Hull Moving Average (HMA)",
    short: "A moving average designed to be very responsive while staying smooth — it hugs price closely with little lag.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_COLOR("#2563eb")],
    compute: (c, p) => {
      const n = num(p, "length", 20);
      return [{ label: `HMA ${n}`, color: str(p, "color", "#2563eb"), data: hma(c, n) }];
    },
  },
  {
    id: "tema",
    name: "Triple Exponential MA (TEMA)",
    short: "An even lower-lag moving average than DEMA, built to track fast-moving price closely.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_COLOR("#0891b2")],
    compute: (c, p) => {
      const n = num(p, "length", 20);
      return [{ label: `TEMA ${n}`, color: str(p, "color", "#0891b2"), data: tema(c, n) }];
    },
  },
  {
    id: "alma",
    name: "Arnaud Legoux MA (ALMA)",
    short: "A moving average that balances smoothness and responsiveness using a weighting curve, aiming to reduce lag and noise.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_COLOR("#7c3aed")],
    compute: (c, p) => {
      const n = num(p, "length", 20);
      return [{ label: `ALMA ${n}`, color: str(p, "color", "#7c3aed"), data: alma(c, n) }];
    },
  },
  {
    id: "smma",
    name: "Smoothed Moving Average (SMMA)",
    short: "A heavily smoothed moving average that reacts slowly — good for seeing the longer-term direction without noise.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_COLOR("#db2777")],
    compute: (c, p) => {
      const n = num(p, "length", 20);
      return [{ label: `SMMA ${n}`, color: str(p, "color", "#db2777"), data: smma(c, n) }];
    },
  },
  {
    id: "mcginley",
    name: "McGinley Dynamic",
    short: "An adaptive moving average that speeds up and slows down with the market, aiming to track price more steadily than a fixed MA.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(14), P_COLOR("#ea580c")],
    compute: (c, p) => {
      const n = num(p, "length", 14);
      return [{ label: `McGinley ${n}`, color: str(p, "color", "#ea580c"), data: mcginley(c, n) }];
    },
  },
  {
    id: "lsma",
    name: "Least Squares MA (LSMA)",
    short: "A moving average based on a best-fit line through recent prices — it leans into the current direction of the trend.",
    category: "Moving Averages",
    pane: "price",
    params: [P_LENGTH(20), P_COLOR("#16a34a")],
    compute: (c, p) => {
      const n = num(p, "length", 20);
      return [{ label: `LSMA ${n}`, color: str(p, "color", "#16a34a"), data: lsma(c, n) }];
    },
  },

  // Channels (overlays)
  {
    id: "donchian",
    name: "Donchian Channel",
    short: "Bands tracing the highest high and lowest low over a period. Price reaching a band shows a new short-term extreme.",
    category: "Volatility",
    pane: "price",
    params: [P_LENGTH(20)],
    compute: (c, p) => {
      const d = donchian(c, num(p, "length", 20));
      return [
        { label: "Upper", color: "#94a3b8", data: d.upper },
        { label: "Middle", color: "#64748b", data: d.middle },
        { label: "Lower", color: "#94a3b8", data: d.lower },
      ];
    },
  },
  {
    id: "envelopes",
    name: "Envelopes",
    short: "Bands set a fixed percentage above and below a moving average — a simple way to frame how far price has stretched.",
    category: "Volatility",
    pane: "price",
    params: [P_LENGTH(20)],
    compute: (c, p) => {
      const e = envelopes(c, num(p, "length", 20));
      return [
        { label: "Upper", color: "#94a3b8", data: e.upper },
        { label: "Middle", color: "#64748b", data: e.middle },
        { label: "Lower", color: "#94a3b8", data: e.lower },
      ];
    },
  },

  // Volatility (sub-panel)
  {
    id: "histvol",
    name: "Historical Volatility",
    short: "Measures how much the price has fluctuated recently, as a percentage — higher means bigger, faster swings.",
    category: "Volatility",
    pane: "separate",
    params: [P_COLOR("#ea580c")],
    compute: (c, p) => [{ label: "Hist Vol", color: str(p, "color", "#ea580c"), data: historicalVol(c) }],
  },

  // Trend (sub-panel)
  {
    id: "dmi",
    name: "Directional Movement Index (DMI)",
    short: "The +DI and −DI lines showing upward vs downward pressure. When +DI is above −DI, buyers are more in control, and vice versa.",
    category: "Trend",
    pane: "separate",
    params: [P_LENGTH(14)],
    compute: (c, p) => {
      const d = dmi(c, num(p, "length", 14));
      return [
        { label: "+DI", color: "#16a34a", data: d.a },
        { label: "−DI", color: "#dc2626", data: d.b },
      ];
    },
  },

  // Volume (sub-panel)
  {
    id: "klinger",
    name: "Klinger Oscillator",
    short: "Tracks long-term money flow versus short-term, using price and volume, with a signal line — a read on accumulation vs distribution.",
    category: "Volume",
    pane: "separate",
    compute: (c) => {
      const k = klinger(c);
      return [
        { label: "KVO", color: "#2563eb", data: k.a },
        { label: "Signal", color: "#f59e0b", data: k.b },
      ];
    },
  },
];

export const INDICATOR_BY_ID = Object.fromEntries(
  INDICATORS.map((i) => [i.id, i])
) as Record<string, IndicatorDef>;

// ---- Strategy presets: named combinations to LEARN how indicators work
// together. These are educational lenses, NOT buy/sell strategies. ----
export interface IndicatorPreset {
  id: string;
  name: string;
  description: string;
  indicatorIds: string[];
}

export const INDICATOR_PRESETS: IndicatorPreset[] = [
  {
    id: "trend",
    name: "Trend View",
    description:
      "Moving averages plus ADX — a common way to look at the broader direction and how strong it is.",
    indicatorIds: ["ema", "sma", "adx"],
  },
  {
    id: "momentum",
    name: "Momentum View",
    description:
      "RSI, MACD and Stochastic together — a typical set for studying how price momentum is behaving.",
    indicatorIds: ["rsi", "macd", "stochastic"],
  },
  {
    id: "volatility",
    name: "Volatility View",
    description:
      "Bollinger Bands with ATR — a way to see how much the price is swinging around its average.",
    indicatorIds: ["bollinger", "atr"],
  },
];
