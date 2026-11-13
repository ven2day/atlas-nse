"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import type { CandlestickData, HistogramData, IChartApi, LineData } from "lightweight-charts";

export type ChartPoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type IndicatorLine = {
  label: string;
  color: string;
  /** aligned to `data` (null = no value at that bar) */
  data: (number | null)[];
};

export function isFinitePoint(value: unknown): value is ChartPoint {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.time === "string" &&
    ["open", "high", "low", "close", "volume"].every(
      (field) => typeof row[field] === "number" && Number.isFinite(row[field]),
    )
  );
}

export function CandlestickChart({
  data,
  height = 420,
  showVolume = true,
  overlays = [],
  oscillators = [],
}: {
  data: ChartPoint[];
  height?: number;
  showVolume?: boolean;
  overlays?: IndicatorLine[];
  oscillators?: IndicatorLine[];
}) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    let disposed = false;
    let chart: IChartApi | null = null;

    (async () => {
      const lc = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;

      const isDark = resolvedTheme === "dark";
      const textColor = isDark ? "#e5e5e5" : "#333333";
      const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
      const borderColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";

      chart = lc.createChart(containerRef.current, {
        layout: { background: { type: lc.ColorType.Solid, color: "transparent" }, textColor },
        grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
        width: containerRef.current.clientWidth,
        height,
        timeScale: { borderColor },
        rightPriceScale: { borderColor },
      });

      if (disposed) {
        try { chart.remove(); } catch { /* noop */ }
        return;
      }

      const candles = chart.addSeries(lc.CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#f43f5e",
        borderUpColor: "#10b981",
        borderDownColor: "#f43f5e",
        wickUpColor: "#10b981",
        wickDownColor: "#f43f5e",
      });
      candles.setData(
        data.map((d): CandlestickData<string> => ({
          time: d.time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        })),
      );

      if (showVolume) {
        const volume = chart.addSeries(lc.HistogramSeries, {
          color: "#3b82f680",
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
        });
        chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        volume.setData(
          data.map((d): HistogramData<string> => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? "#10b98140" : "#f43f5e40",
          })),
        );
      }

      const toLine = (line: IndicatorLine): LineData<string>[] =>
        line.data
          .map((value, i) => ({ time: data[i].time, value }))
          .filter((p): p is { time: string; value: number } => p.value !== null && Number.isFinite(p.value));

      for (const line of overlays) {
        const s = chart.addSeries(lc.LineSeries, {
          color: line.color,
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(toLine(line));
      }

      if (oscillators.length > 0) {
        chart.priceScale("osc").applyOptions({ scaleMargins: { top: 0.72, bottom: 0 } });
        for (const line of oscillators) {
          const s = chart.addSeries(lc.LineSeries, {
            color: line.color,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: "osc",
            autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
          });
          s.setData(toLine(line));
        }
      }

      chart.timeScale().fitContent();
      chartRef.current = chart;
    })();

    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        try { chartRef.current.applyOptions({ width: containerRef.current.clientWidth }); } catch { /* noop */ }
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch { /* noop */ }
        chartRef.current = null;
      }
      if (chart && chart !== chartRef.current) {
        try { chart.remove(); } catch { /* noop */ }
      }
    };
  }, [data, resolvedTheme, height, showVolume, overlays, oscillators]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}