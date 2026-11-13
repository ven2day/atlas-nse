"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Wallet, RotateCcw } from "lucide-react";

type Position = { ticker: string; qty: number; entry: number };

const LS_KEY = "paper-trading-ledger";
const START_BALANCE = 100000;

export function PaperTrading({ ticker, price }: { ticker: string; price: number | null }) {
  const [balance, setBalance] = useState(START_BALANCE);
  const [positions, setPositions] = useState<Position[]>([]);
  const [realized, setRealized] = useState(0);
  const [qty, setQty] = useState("1");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed.balance === "number") setBalance(parsed.balance);
        if (Array.isArray(parsed.positions)) setPositions(parsed.positions);
        if (typeof parsed.realized === "number") setRealized(parsed.realized);
      }
    } catch {
      // ignore corrupted storage
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ balance, positions, realized }));
    } catch {
      // ignore storage errors
    }
  }, [balance, positions, realized]);

  const livePrice = price ?? 0;
  const currentQty = Number(qty) || 0;
  const position = positions.find((p) => p.ticker === ticker);

  const unrealized = positions.reduce((sum, p) => {
    const cur = p.ticker === ticker && livePrice ? livePrice : p.entry;
    return sum + (cur - p.entry) * p.qty;
  }, 0);

  function buy() {
    if (!ticker || !livePrice || currentQty <= 0) {
      toast.error("Enter a valid quantity");
      return;
    }
    const cost = livePrice * currentQty;
    if (cost > balance) {
      toast.error("Insufficient virtual balance");
      return;
    }
    setBalance((b) => b - cost);
    setPositions((prev) => {
      const idx = prev.findIndex((p) => p.ticker === ticker);
      if (idx >= 0) {
        const next = [...prev];
        const p = next[idx];
        const totalQty = p.qty + currentQty;
        next[idx] = { ticker, qty: totalQty, entry: (p.entry * p.qty + livePrice * currentQty) / totalQty };
        return next;
      }
      return [...prev, { ticker, qty: currentQty, entry: livePrice }];
    });
    toast.success(`Bought ${currentQty} × ${ticker} @ ₹${livePrice.toFixed(2)}`);
  }

  function sell() {
    if (!position) {
      toast.error("No position to sell");
      return;
    }
    const sellQty = currentQty > 0 && currentQty < position.qty ? currentQty : position.qty;
    const exit = livePrice || position.entry;
    setBalance((b) => b + exit * sellQty);
    setRealized((r) => r + (exit - position.entry) * sellQty);
    setPositions((prev) => {
      const idx = prev.findIndex((p) => p.ticker === ticker);
      if (idx < 0) return prev;
      const next = [...prev];
      const p = next[idx];
      if (sellQty >= p.qty) next.splice(idx, 1);
      else next[idx] = { ...p, qty: p.qty - sellQty };
      return next;
    });
    toast.success(`Sold ${sellQty} × ${ticker} @ ₹${exit.toFixed(2)}`);
  }

  function reset() {
    setBalance(START_BALANCE);
    setPositions([]);
    setRealized(0);
  }

  const totalValue = balance + positions.reduce((s, p) => s + p.entry * p.qty, 0);

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Practice trading</h3>
            <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300">
              Simulated
            </Badge>
          </div>
          <button type="button" onClick={reset} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Virtual cash" value={`₹${balance.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
          <Stat label="Unrealised P&L" value={unrealized >= 0 ? `+₹${unrealized.toFixed(2)}` : `-₹${Math.abs(unrealized).toFixed(2)}`} tone={unrealized >= 0 ? "pos" : "neg"} />
          <Stat label="Realised P&L" value={realized >= 0 ? `+₹${realized.toFixed(2)}` : `-₹${Math.abs(realized).toFixed(2)}`} tone={realized >= 0 ? "pos" : "neg"} />
          <Stat label="Total value" value={`₹${totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
        </div>

        {ticker && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="1"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="font-sans w-24"
              />
              <span className="text-xs text-muted-foreground">qty of {ticker || "—"} @ ₹{livePrice ? livePrice.toFixed(2) : "—"}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={buy} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                Buy
              </Button>
              <Button size="sm" onClick={sell} variant="outline" className="flex-1">
                Sell
              </Button>
            </div>
          </div>
        )}

        {positions.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Open positions</p>
            <div className="rounded-lg border border-border divide-y divide-border">
              {positions.map((p) => (
                <div key={p.ticker} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-medium">{p.ticker}</span>
                  <span className="text-muted-foreground text-xs">{p.qty} @ ₹{p.entry.toFixed(2)}</span>
                  <Badge variant="outline" className="text-xs">open</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Virtual ₹1,00,000. No real money, no real orders — a sandbox to practise entries and exits at live prices.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${tone === "pos" ? "text-emerald-600" : tone === "neg" ? "text-red-600" : ""}`}>
        {value}
      </p>
    </div>
  );
}