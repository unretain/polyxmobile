import type { Metadata, Viewport } from "next";
import { Inter, DM_Mono, Fragment_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import { DemoInterceptor } from "@/components/DemoInterceptor";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const dmMono = DM_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-dm-mono"
});
const fragmentMono = Fragment_Mono({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-fragment-mono"
});

export const metadata: Metadata = {
  title: "[polyx] - 3D Solana Memecoin Charts",
  description: "View Solana memecoins with immersive 3D price charts",
};

/**
 * MUST be its own export. Next 14+ ignores `viewport` nested inside `metadata`, so the
 * meta tag was never emitted and mobile fell back to browser defaults — which is why
 * the app pinch-zoomed and then would not zoom back out.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* iOS Safari ignores user-scalable=no, so pinch-zoom has to be blocked
            directly. Without this the app could be pinched in and then would not
            zoom back out, leaving it stuck. Passive:false is required — a passive
            listener cannot preventDefault. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stop = function(e) { e.preventDefault(); };
                  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function(evt) {
                    document.addEventListener(evt, stop, { passive: false });
                  });
                  // Two-finger pinch on touchmove (Android/Chrome fallback).
                  document.addEventListener('touchmove', function(e) {
                    if (e.touches && e.touches.length > 1) e.preventDefault();
                  }, { passive: false });
                  // Double-tap zoom, which touch-action alone misses on older iOS.
                  var lastTouch = 0;
                  document.addEventListener('touchend', function(e) {
                    var now = Date.now();
                    if (now - lastTouch <= 300) e.preventDefault();
                    lastTouch = now;
                  }, { passive: false });
                } catch (err) {}
              })();
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('polyx-theme');
                  if (theme) {
                    var parsed = JSON.parse(theme);
                    if (parsed.state && parsed.state.isDark !== false) {
                      document.documentElement.classList.add('dark');
                    }
                  } else {
                    // Default to dark if no preference
                    document.documentElement.classList.add('dark');
                  }
                } catch (e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className={`${inter.variable} ${dmMono.variable} ${fragmentMono.variable} font-sans`}>
        <DemoInterceptor />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
