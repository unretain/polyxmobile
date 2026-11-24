"use client";

import { AppShell } from "@/components/layout/AppShell";

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
