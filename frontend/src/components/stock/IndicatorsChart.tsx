"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import type { CandlestickData, IChartApi, LineData, UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/indicators";
import type { IndicatorLine } from "@/lib/indicator-registry";

export type IndicatorPaneGroup = {
  id: string;
  label: string;
  lines: IndicatorLine[];
};

export function IndicatorsChart({
  candles,
  priceLines,
  panes,
  height = 560,
}: {
  candles: Candle[];
  priceLines: IndicatorLine[];
  panes: IndicatorPaneGroup[];
  height?: number;
}) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

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

      // Main price pane: candles + overlays.
      const candleSeries = chart.addSeries(lc.CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#f43f5e",
        borderUpColor: "#10b981",
        borderDownColor: "#f43f5e",
        wickUpColor: "#10b981",
        wickDownColor: "#f43f5e",
      });
      candleSeries.setData(
        candles.map((c): CandlestickData<UTCTimestamp> => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })),
      );

      for (const line of priceLines) {
        const s = chart.addSeries(lc.LineSeries, {
          color: line.color,
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(line.data as unknown as LineData[]);
      }

      chart.panes()[0].setStretchFactor(3);

      // Each separate-pane indicator gets its own sub-pane.
      for (const group of panes) {
        const pane = chart.addPane();
        pane.setStretchFactor(1);
        for (const line of group.lines) {
          const s = pane.addSeries(lc.LineSeries, {
            color: line.color,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
          });
          s.setData(line.data as unknown as LineData[]);
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
  }, [candles, priceLines, panes, resolvedTheme, height]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}