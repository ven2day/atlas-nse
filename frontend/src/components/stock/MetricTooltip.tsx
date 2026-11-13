"use client";

import { Info } from "lucide-react";

/** Plain-language hover tooltip for a metric. Pure CSS, no extra dependency. */
export function MetricTooltip({ text }: { text: string }) {
  return (
    <span className="group/tt relative inline-flex align-middle">
      <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border border-border bg-popover p-3 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-md group-hover/tt:block">
        {text}
      </span>
    </span>
  );
}