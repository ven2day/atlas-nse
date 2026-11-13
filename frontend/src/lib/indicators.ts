// @ts-nocheck
/**
 * indicators.ts
 *
 * Calculation layer over @debut/indicators. Every function here was verified
 * against real Reliance data (see test_indicators_batch.mjs) for sane values
 * and known return shapes. Returns {time,value} arrays for Lightweight Charts.
 *
 * Verified shapes:
 *   plain number : SMA, EMA, WMA, DEMA, RSI, ATR, ROC
 *   {macd,signal,histogram} : MACD
 *   {upper,middle,lower}    : BollingerBands
 *   {adx,pdi,mdi}           : ADX
 *   {k,d}                   : Stochastic
 */

"use client";

import {
  SMA, EMA, WMA, DEMA, RSI, ATR, ROC, MACD, BollingerBands, ADX, Stochastic,
  VWMA, CMO, TRIX, Momentum, CCI, Aroon, SuperTrend, Vortex, KeltnerChannel, PSAR, MFI, OBV,
  DPO, CoppockCurve, KST, TSI, UltimateOscillator, MassIndex, Choppiness, AO, AC,
  RVI, FisherTransform, SMIErgodic, BullBearPower, ElderRay, ForceIndex, EaseOfMovement,
  ChaikinOscillator, PVT,
  HMA, TEMA, ALMA, SMMA, McGinleyDynamic, LSMA, DC, Envelopes, HistoricalVolatility, Klinger, DMI,
} from "@debut/indicators";

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface LinePoint {
  time: number;
  value: number;
}

function toLine(times: number[], values: (number | undefined | null)[]): LinePoint[] {
  const out: LinePoint[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === "number" && !Number.isNaN(v)) out.push({ time: times[i], value: v });
  }
  return out;
}

const closesOf = (c: Candle[]) => c.map((x) => x.close);
const timesOf = (c: Candle[]) => c.map((x) => x.time);

// ---- Close-based, plain-number overlays ----
function closeLine(
  Cls: new (...a: number[]) => { nextValue: (v: number) => number | undefined },
  candles: Candle[],
  ...args: number[]
): LinePoint[] {
  const ind = new Cls(...args);
  const times = timesOf(candles);
  const vals = closesOf(candles).map((c) => ind.nextValue(c));
  return toLine(times, vals);
}

export const sma = (c: Candle[], p = 20) => closeLine(SMA, c, p);
export const ema = (c: Candle[], p = 20) => closeLine(EMA, c, p);
export const wma = (c: Candle[], p = 20) => closeLine(WMA, c, p);
export const dema = (c: Candle[], p = 20) => closeLine(DEMA, c, p);
export const rsi = (c: Candle[], p = 14) => closeLine(RSI, c, p);
export const roc = (c: Candle[], p = 12) => closeLine(ROC, c, p);

// ---- ATR (high/low/close) ----
export function atr(candles: Candle[], period = 14): LinePoint[] {
  const ind = new ATR(period);
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}

// ---- MACD => {macd, signal, histogram} ----
export interface MacdResult {
  macd: LinePoint[];
  signal: LinePoint[];
  histogram: LinePoint[];
}
export function macd(candles: Candle[], fast = 12, slow = 26, signalP = 9): MacdResult {
  const ind = new MACD(fast, slow, signalP);
  const times = timesOf(candles);
  const m: (number | undefined)[] = [];
  const s: (number | undefined)[] = [];
  const h: (number | undefined)[] = [];
  for (const c of closesOf(candles)) {
    const r = ind.nextValue(c);
    m.push(r?.macd); s.push(r?.signal); h.push(r?.histogram);
  }
  return { macd: toLine(times, m), signal: toLine(times, s), histogram: toLine(times, h) };
}

// ---- Bollinger => {upper, middle, lower} ----
export interface BollingerResult {
  upper: LinePoint[];
  middle: LinePoint[];
  lower: LinePoint[];
}
export function bollinger(candles: Candle[], period = 20, stdDev = 2): BollingerResult {
  const ind = new BollingerBands(period, stdDev);
  const times = timesOf(candles);
  const u: (number | undefined)[] = [];
  const m: (number | undefined)[] = [];
  const l: (number | undefined)[] = [];
  for (const c of closesOf(candles)) {
    const r = ind.nextValue(c);
    u.push(r?.upper); m.push(r?.middle); l.push(r?.lower);
  }
  return { upper: toLine(times, u), middle: toLine(times, m), lower: toLine(times, l) };
}

// ---- ADX => {adx, pdi, mdi} ----
export interface AdxResult {
  adx: LinePoint[];
  pdi: LinePoint[];
  mdi: LinePoint[];
}
export function adx(candles: Candle[], period = 14): AdxResult {
  const ind = new ADX(period);
  const times = timesOf(candles);
  const a: (number | undefined)[] = [];
  const p: (number | undefined)[] = [];
  const m: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close);
    a.push(r?.adx); p.push(r?.pdi); m.push(r?.mdi);
  }
  return { adx: toLine(times, a), pdi: toLine(times, p), mdi: toLine(times, m) };
}

// ---- Stochastic => {k, d} ----
export interface StochasticResult {
  k: LinePoint[];
  d: LinePoint[];
}
export function stochastic(candles: Candle[], period = 14, signalP = 3): StochasticResult {
  const ind = new Stochastic(period, signalP);
  const times = timesOf(candles);
  const k: (number | undefined)[] = [];
  const d: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close);
    k.push(r?.k); d.push(r?.d);
  }
  return { k: toLine(times, k), d: toLine(times, d) };
}

// ===== Batch 2 indicators (verified against Reliance daily) =====

// Close-only, plain number
export const cmo = (c: Candle[], p = 14) => closeLine(CMO, c, p);
export const trix = (c: Candle[], p = 15) => closeLine(TRIX, c, p);
export const momentum = (c: Candle[], p = 10) => closeLine(Momentum, c, p);

// CCI uses high/low/close
export function cci(candles: Candle[], period = 20): LinePoint[] {
  const ind = new CCI(period);
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}

// PSAR uses high/low/close, returns a price (overlay)
export function psar(candles: Candle[]): LinePoint[] {
  const ind = new PSAR();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}

// VWMA uses close + volume (overlay)
export function vwma(candles: Candle[], period = 20): LinePoint[] {
  const ind = new VWMA(period);
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.close, c.volume ?? 0));
  return toLine(times, vals);
}

// OBV uses close + volume (sub-panel, cumulative)
export function obv(candles: Candle[]): LinePoint[] {
  const ind = new OBV();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.close, c.volume ?? 0));
  return toLine(times, vals);
}

// MFI uses high/low/close/volume (sub-panel 0..100)
export function mfi(candles: Candle[], period = 14): LinePoint[] {
  const ind = new MFI(period);
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close, c.volume ?? 0));
  return toLine(times, vals);
}

// Aroon => {up, down}
export interface AroonResult { up: LinePoint[]; down: LinePoint[]; }
export function aroon(candles: Candle[], period = 14): AroonResult {
  const ind = new Aroon(period);
  const times = timesOf(candles);
  const up: (number | undefined)[] = [];
  const down: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close);
    up.push(r?.up); down.push(r?.down);
  }
  return { up: toLine(times, up), down: toLine(times, down) };
}

// SuperTrend => {superTrend, direction} (overlay line)
export function supertrend(candles: Candle[], period = 10, mult = 3): LinePoint[] {
  const ind = new SuperTrend(period, mult);
  const times = timesOf(candles);
  const vals = candles.map((c) => {
    const r = ind.nextValue(c.high, c.low, c.close);
    return r?.superTrend;
  });
  return toLine(times, vals);
}

// Vortex => {plus, minus}
export interface VortexResult { plus: LinePoint[]; minus: LinePoint[]; }
export function vortex(candles: Candle[], period = 14): VortexResult {
  const ind = new Vortex(period);
  const times = timesOf(candles);
  const plus: (number | undefined)[] = [];
  const minus: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close);
    plus.push(r?.plus); minus.push(r?.minus);
  }
  return { plus: toLine(times, plus), minus: toLine(times, minus) };
}

// Keltner Channel => {upper, middle, lower} (overlay)
export interface KeltnerResult { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[]; }
export function keltner(candles: Candle[], period = 20): KeltnerResult {
  const ind = new KeltnerChannel(period);
  const times = timesOf(candles);
  const u: (number | undefined)[] = [];
  const m: (number | undefined)[] = [];
  const l: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close);
    u.push(r?.upper); m.push(r?.middle); l.push(r?.lower);
  }
  return { upper: toLine(times, u), middle: toLine(times, m), lower: toLine(times, l) };
}

// ===== Batch 3 indicators (verified against Reliance daily) =====

// Close-only, plain number
export const dpo = (c: Candle[], p = 20) => closeLine(DPO, c, p);
export const coppock = (c: Candle[]) => closeLine(CoppockCurve, c);

// HLC, plain number
export function ultimateOsc(candles: Candle[]): LinePoint[] {
  const ind = new UltimateOscillator();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}
export function massIndex(candles: Candle[]): LinePoint[] {
  const ind = new MassIndex();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}
export function choppiness(candles: Candle[], period = 14): LinePoint[] {
  const ind = new Choppiness(period);
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}
export function awesome(candles: Candle[]): LinePoint[] {
  const ind = new AO();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}
export function accelerator(candles: Candle[]): LinePoint[] {
  const ind = new AC();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}
export function bullBearPower(candles: Candle[], period = 13): LinePoint[] {
  const ind = new BullBearPower(period);
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close));
  return toLine(times, vals);
}

// Volume, plain number
export function forceIndex(candles: Candle[]): LinePoint[] {
  const ind = new ForceIndex();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.close, c.volume ?? 0));
  return toLine(times, vals);
}
export function easeOfMovement(candles: Candle[]): LinePoint[] {
  const ind = new EaseOfMovement();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close, c.volume ?? 0));
  return toLine(times, vals);
}
export function chaikinOsc(candles: Candle[]): LinePoint[] {
  const ind = new ChaikinOscillator();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.high, c.low, c.close, c.volume ?? 0));
  return toLine(times, vals);
}
export function pvt(candles: Candle[]): LinePoint[] {
  const ind = new PVT();
  const times = timesOf(candles);
  const vals = candles.map((c) => ind.nextValue(c.close, c.volume ?? 0));
  return toLine(times, vals);
}

// Two-line objects
export interface TwoLine { a: LinePoint[]; b: LinePoint[]; }

function twoLineClose(
  Cls: new (...x: number[]) => { nextValue: (v: number) => Record<string, number> | undefined },
  candles: Candle[],
  keyA: string,
  keyB: string
): TwoLine {
  const ind = new Cls();
  const times = timesOf(candles);
  const a: (number | undefined)[] = [];
  const b: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.close);
    a.push(r?.[keyA]); b.push(r?.[keyB]);
  }
  return { a: toLine(times, a), b: toLine(times, b) };
}
function twoLineHLC(
  Cls: new (...x: number[]) => { nextValue: (h: number, l: number, c: number) => Record<string, number> | undefined },
  candles: Candle[],
  keyA: string,
  keyB: string,
  ...args: number[]
): TwoLine {
  const ind = new Cls(...args);
  const times = timesOf(candles);
  const a: (number | undefined)[] = [];
  const b: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close);
    a.push(r?.[keyA]); b.push(r?.[keyB]);
  }
  return { a: toLine(times, a), b: toLine(times, b) };
}

function twoLineOHLC(
  Cls: new (...x: number[]) => { nextValue: (o: number, h: number, l: number, c: number) => Record<string, number> | undefined },
  candles: Candle[],
  keyA: string,
  keyB: string,
  ...args: number[]
): TwoLine {
  const ind = new Cls(...args);
  const times = timesOf(candles);
  const a: (number | undefined)[] = [];
  const b: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.open, c.high, c.low, c.close);
    a.push(r?.[keyA]); b.push(r?.[keyB]);
  }
  return { a: toLine(times, a), b: toLine(times, b) };
}

export const kst = (c: Candle[]) => twoLineClose(KST, c, "kst", "signal");
export const tsi = (c: Candle[]) => twoLineClose(TSI, c, "tsi", "signal");
export const rvi = (c: Candle[]) => twoLineOHLC(RVI, c, "rvi", "signal");
export const fisher = (c: Candle[]) => twoLineHLC(FisherTransform, c, "fisher", "trigger");
export const smiErgodic = (c: Candle[]) => twoLineHLC(SMIErgodic, c, "smi", "signal");
export const elderRay = (c: Candle[]) => twoLineHLC(ElderRay, c, "bull", "bear", 13);

// ===== Batch 4 indicators (verified against Reliance daily) =====

// Moving averages (close-only, plain number, overlays)
export const hma = (c: Candle[], p = 20) => closeLine(HMA, c, p);
export const tema = (c: Candle[], p = 20) => closeLine(TEMA, c, p);
export const alma = (c: Candle[], p = 20) => closeLine(ALMA, c, p);
export const smma = (c: Candle[], p = 20) => closeLine(SMMA, c, p);
export const mcginley = (c: Candle[], p = 14) => closeLine(McGinleyDynamic, c, p);
export const lsma = (c: Candle[], p = 20) => closeLine(LSMA, c, p);

// Historical Volatility (close-only, sub-panel)
export const historicalVol = (c: Candle[]) => closeLine(HistoricalVolatility, c);

// Donchian Channel => {upper, middle, lower} via high/low/close (overlay)
export interface BandResult { upper: LinePoint[]; middle: LinePoint[]; lower: LinePoint[]; }
export function donchian(candles: Candle[], period = 20): BandResult {
  const ind = new DC(period);
  const times = timesOf(candles);
  const u: (number | undefined)[] = [];
  const m: (number | undefined)[] = [];
  const l: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close);
    u.push(r?.upper); m.push(r?.middle); l.push(r?.lower);
  }
  return { upper: toLine(times, u), middle: toLine(times, m), lower: toLine(times, l) };
}

// Envelopes => {upper, middle, lower} via close (overlay)
export function envelopes(candles: Candle[], period = 20): BandResult {
  const ind = new Envelopes(period);
  const times = timesOf(candles);
  const u: (number | undefined)[] = [];
  const m: (number | undefined)[] = [];
  const l: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.close);
    u.push(r?.upper); m.push(r?.middle); l.push(r?.lower);
  }
  return { upper: toLine(times, u), middle: toLine(times, m), lower: toLine(times, l) };
}

// Klinger => {kvo, signal} via high/low/close/volume (sub-panel)
export function klinger(candles: Candle[]): TwoLine {
  const ind = new Klinger();
  const times = timesOf(candles);
  const a: (number | undefined)[] = [];
  const b: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close, c.volume ?? 0);
    a.push(r?.kvo); b.push(r?.signal);
  }
  return { a: toLine(times, a), b: toLine(times, b) };
}

// DMI => {plusDI, minusDI} via high/low/close (sub-panel)
export function dmi(candles: Candle[], period = 14): TwoLine {
  const ind = new DMI(period);
  const times = timesOf(candles);
  const a: (number | undefined)[] = [];
  const b: (number | undefined)[] = [];
  for (const c of candles) {
    const r = ind.nextValue(c.high, c.low, c.close);
    a.push(r?.plusDI); b.push(r?.minusDI);
  }
  return { a: toLine(times, a), b: toLine(times, b) };
}
