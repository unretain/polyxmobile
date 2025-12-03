import { Suspense } from "react";
import { LandingPage } from "@/components/landing/LandingPage";

function LoadingFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-[#0a0a0a]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#FF6B4A] border-t-transparent" />
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <LandingPage />
    </Suspense>
  );
}
