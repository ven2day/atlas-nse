"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Radar, Target, CandlestickChart, Award, FlaskConical, Calculator, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { PositionSizeCalculator } from "@/components/PositionSizeCalculator";
import { iconBadge } from "@/lib/status-colors";

const quickLinks = [
  {
    href: "/scanner",
    label: "Scan Market",
    description: "Gap, Volume, Breakout",
    icon: Radar,
    color: iconBadge("orange"),
  },
  {
    href: "/strategies",
    label: "Strategies",
    description: "S/R, Cyclical patterns",
    icon: Target,
    color: iconBadge("purple"),
  },
  {
    href: "/charts",
    label: "Charts",
    description: "Candlestick charts",
    icon: CandlestickChart,
    color: iconBadge("info"),
  },
  {
    href: "/performance",
    label: "Performance",
    description: "Strategy win rates",
    icon: Award,
    color: iconBadge("bullish"),
  },
  {
    href: "/backtest",
    label: "Backtest",
    description: "Historical testing",
    icon: FlaskConical,
    color: iconBadge("indigo"),
  },
];

export function QuickActions() {
  const [calcOpen, setCalcOpen] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Quick Actions</h3>
            <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Hide" : "Show"}
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>

          {open && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2">
              {quickLinks.map((action) => (
                <Link key={action.href} href={action.href}>
                  <div className="p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-accent/30 transition-colors cursor-pointer h-full">
                    <div className={`p-1.5 rounded-lg ${action.color} inline-flex mb-2`}>
                      <action.icon className="h-4 w-4" />
                    </div>
                    <p className="font-medium text-sm">{action.label}</p>
                    <p className="text-xs text-muted-foreground">{action.description}</p>
                  </div>
                </Link>
              ))}
              {/* Position Size Calculator - opens dialog */}
              <button
                onClick={() => setCalcOpen(true)}
                className="p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-accent/30 transition-colors cursor-pointer text-left"
              >
                <div className={`p-1.5 rounded-lg ${iconBadge("teal")} inline-flex mb-2`}>
                  <Calculator className="h-4 w-4" />
                </div>
                <p className="font-medium text-sm">Position Size</p>
                <p className="text-xs text-muted-foreground">Calculate shares to buy</p>
              </button>
            </div>
          )}
        </CardContent>
      </Card>
      <PositionSizeCalculator open={calcOpen} onClose={() => setCalcOpen(false)} />
    </>
  );
}
