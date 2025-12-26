"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Only these emails can access this page
const ALLOWED_EMAILS = ["owenzhang0317@gmail.com"];

export default function LogoPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    // Redirect if not logged in or not allowed
    if (!session?.user?.email || !ALLOWED_EMAILS.includes(session.user.email)) {
      router.push("/");
    }
  }, [session, status, router]);

  // Show nothing while checking auth
  if (status === "loading" || !session?.user?.email || !ALLOWED_EMAILS.includes(session.user.email)) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-[20vw] font-bold font-inter tracking-tight leading-none select-none">
          <span className="text-white">[poly</span>
          <span className="text-[#FF6B4A]">x</span>
          <span className="text-white">]</span>
        </h1>
      </div>
    </div>
  );
}
