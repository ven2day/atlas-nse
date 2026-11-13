"use client";

import { useState } from "react";
import { Menu, TrendingUp } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SidebarNav } from "./Sidebar";

/** Top bar shown below `lg` with a drawer that reuses the full sidebar nav. */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-3 lg:hidden">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-green-500" />
        <span className="font-bold">Trading Agent</span>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Open navigation menu" />
          }
        >
          <Menu className="h-5 w-5" />
        </SheetTrigger>
        <SheetContent side="left" className="data-[side=left]:w-64">
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
