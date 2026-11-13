"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { logout } from "@/lib/api";
import { toast } from "sonner";
import {
  Home,
  Sparkles,
  Radar,
  Target,
  Search,
  CandlestickChart,
  Award,
  FlaskConical,
  History,
  Settings,
  TrendingUp,
  Newspaper,
  Brain,
  PieChart,
  LineChart,
  Zap,
  LogOut,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
};

const primaryNav: NavItem[] = [
  { href: "/", label: "Home", icon: Home, hint: "Pick swing or intraday" },
  { href: "/swing", label: "Swing", icon: LineChart, hint: "Research & fundamentals" },
  { href: "/intraday", label: "Intraday", icon: Zap, hint: "Live chart & paper trading" },
];

const toolsNav: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: Sparkles, hint: "Your daily workflow" },
  { href: "/recommendations", label: "Top Picks", icon: Sparkles, hint: "AI-free recommendations" },
  { href: "/scanner", label: "Market Scan", icon: Radar, hint: "Gap / Volume / Breakout" },
  { href: "/news", label: "News Feed", icon: Newspaper, hint: "RSS + customizable" },
];

const reviewNav: NavItem[] = [
  { href: "/analysis", label: "Deep Analysis", icon: Search, hint: "AI-powered (paid)" },
  { href: "/equity-portfolio-analysis", label: "Equity portfolio analysis", icon: PieChart, hint: "Dhan holdings review" },
  { href: "/charts", label: "Charts", icon: CandlestickChart, hint: "Candlestick charts" },
  { href: "/strategies", label: "Strategies", icon: Target, hint: "S/R, Cyclical patterns" },
  { href: "/performance", label: "Performance", icon: Award, hint: "Strategy win rates" },
  { href: "/simulation", label: "Simulation", icon: FlaskConical, hint: "Paper trade + backtest" },
  { href: "/insights", label: "Learning Insights", icon: Brain, hint: "What works for YOU" },
  { href: "/signals", label: "Signal Performance", icon: TrendingUp, hint: "Auto-tune recommender weights" },
  { href: "/verdict-calibration", label: "Verdict Calibration", icon: Target, hint: "Is the daily verdict accurate?" },
  { href: "/confidence-calibration", label: "Confidence Calibration", icon: Award, hint: "Brier score: are probabilities honest?" },
  { href: "/shadow-trades", label: "Shadow Trades", icon: Search, hint: "Counterfactual: trades you skipped" },
  { href: "/memory-admin", label: "Memory Admin", icon: Brain, hint: "Inspect + prune agent BM25 memories" },
  { href: "/backtest", label: "AI Backtest", icon: FlaskConical, hint: "AI on past dates (paid)" },
  { href: "/history", label: "My Trades", icon: History, hint: "Real trades & P&L" },
];

const settingsNav: NavItem[] = [
  { href: "/settings", label: "Settings", icon: Settings },
];

function isItemActive(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm group ${
        active
          ? "bg-accent text-accent-foreground font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
      }`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div>{item.label}</div>
        {item.hint && !active && (
          <div className="text-[10px] text-muted-foreground/70 group-hover:text-muted-foreground truncate">
            {item.hint}
          </div>
        )}
      </div>
    </Link>
  );
}

function NavItems({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="space-y-0.5">
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={isItemActive(item, pathname)}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function ReviewLearnSection({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Open automatically when the active route lives inside this group.
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (reviewNav.some((item) => isItemActive(item, pathname))) {
      setOpen(true);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="review-learn-nav"
        className="flex w-full items-center justify-between px-3 py-2 rounded-lg text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span>Review &amp; Learn</span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div id="review-learn-nav">
        {open && (
          <div className="mt-1">
            <NavItems items={reviewNav} onNavigate={onNavigate} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Shared navigation body used by both the desktop sidebar and mobile drawer. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();

  const signOut = async () => {
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Unable to sign out. Please try again.");
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-green-500" />
          <div>
            <h1 className="font-bold text-lg">Trading Agent</h1>
            <p className="text-xs text-muted-foreground">NSE/BSE - Indian Market</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1.5">
            Workspace
          </p>
          <NavItems items={primaryNav} onNavigate={onNavigate} />
        </div>

        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1.5">
            Tools
          </p>
          <NavItems items={toolsNav} onNavigate={onNavigate} />
        </div>

        <ReviewLearnSection onNavigate={onNavigate} />

        <div>
          <NavItems items={settingsNav} onNavigate={onNavigate} />
        </div>
      </nav>

      <div className="p-4 border-t border-border space-y-3">
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5">Appearance</p>
          <ThemeToggle />
        </div>
        <button
          type="button"
          onClick={signOut}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
        <div className="text-[10px] text-muted-foreground">
          <p>Powered by Claude + LangGraph</p>
          <p className="mt-0.5">Data: DhanHQ API (NSE)</p>
        </div>
      </div>
    </div>
  );
}

/** Desktop-only permanent sidebar. Hidden below `lg` in favour of the mobile drawer. */
export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 hidden h-full w-64 flex-col bg-card border-r border-border z-50 lg:flex">
      <SidebarNav />
    </aside>
  );
}
