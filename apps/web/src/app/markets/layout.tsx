"use client";

import { AppShell } from "@/components/layout/AppShell";

export default function MarketsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell guard={false}>{children}</AppShell>;
}
