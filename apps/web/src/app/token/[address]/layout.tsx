import { Header } from "@/components/layout/Header";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function TokenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="flex h-screen flex-col bg-[#0a0a0a]">
        {/* Star grid background */}
        <div className="fixed inset-0 star-grid opacity-20 pointer-events-none" />

        <Header />
        <main className="relative z-10 flex-1 overflow-auto pt-24 px-6 pb-6">{children}</main>
      </div>
    </AuthGuard>
  );
}
