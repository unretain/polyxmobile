import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "License Dashboard | Polyx",
  description: "Manage your Polyx embed license keys and domain restrictions.",
};

export default function LicenseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
