import { Header } from "@/components/layout/Header";

export default function MarketsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col bg-[#0a0a0a]">
      {/* Star grid background */}
      <div className="fixed inset-0 star-grid opacity-20 pointer-events-none" />

      <Header />
      <main className="relative z-10 flex-1 overflow-auto pt-24 px-6 pb-6">{children}</main>
    </div>
  );
}
