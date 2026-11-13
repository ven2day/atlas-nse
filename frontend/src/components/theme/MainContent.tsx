"use client";

import { memo } from "react";

/** Memoized shell so theme toggles don't re-render the full page tree. */
export const MainContent = memo(function MainContent({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex-1 bg-background lg:ml-64">{children}</main>
  );
});
