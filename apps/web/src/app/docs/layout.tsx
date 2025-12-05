import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation | Polyx - 3D Chart Embed API",
  description: "Complete documentation for embedding Polyx 3D Solana token charts on your website. API reference, examples, and integration guides.",
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
