"use client";

import { AppShell } from "@/components/layout/AppShell";

export default function TokenLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
