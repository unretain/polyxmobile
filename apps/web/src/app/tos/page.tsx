"use client";

import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { useThemeStore } from "@/stores/themeStore";

export default function TermsOfServicePage() {
  const { isDark } = useThemeStore();

  return (
    <div className={`min-h-screen ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-[#f5f5f5] text-black'}`}>
      {/* Header */}
      <Header />

      <main className="max-w-4xl mx-auto px-6 py-12 pt-32">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className={`text-sm mb-8 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Last updated: December 14, 2025</p>

        <div className="prose prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">1. Acceptance of Terms</h2>
            <p className="text-white/70 leading-relaxed">
              By accessing or using Polyx (&quot;the Service&quot;), you agree to be bound by these Terms of Service.
              If you do not agree to these terms, please do not use the Service. We reserve the right to
              modify these terms at any time, and your continued use of the Service constitutes acceptance
              of any modifications.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">2. Description of Service</h2>
            <p className="text-white/70 leading-relaxed">
              Polyx provides cryptocurrency charting, analytics, and trading tools for Solana-based tokens.
              The Service includes real-time price data, historical charts, portfolio tracking, and
              embeddable chart widgets. We do not provide financial advice, and all trading decisions
              are made at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">3. User Accounts</h2>
            <p className="text-white/70 leading-relaxed mb-4">
              To access certain features, you may need to create an account. You are responsible for:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>All activities that occur under your account</li>
              <li>Notifying us immediately of any unauthorized use</li>
              <li>Ensuring your account information is accurate and up-to-date</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">4. Wallet and Trading</h2>
            <p className="text-white/70 leading-relaxed mb-4">
              The Service allows you to connect or create Solana wallets for trading purposes. You acknowledge that:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li>You are solely responsible for securing your wallet private keys</li>
              <li>Cryptocurrency transactions are irreversible</li>
              <li>We are not liable for any losses resulting from trading activities</li>
              <li>Market data may be delayed or inaccurate</li>
              <li>Trading cryptocurrencies involves significant risk of loss</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">5. Subscription and Payments</h2>
            <p className="text-white/70 leading-relaxed">
              Certain features require a paid subscription. Payments are processed through Stripe.
              Subscriptions automatically renew unless cancelled. Refunds are handled on a case-by-case
              basis and are not guaranteed. We reserve the right to change pricing with 30 days notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">6. Prohibited Uses</h2>
            <p className="text-white/70 leading-relaxed mb-4">
              You agree not to:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to our systems</li>
              <li>Interfere with or disrupt the Service</li>
              <li>Scrape or collect data without permission</li>
              <li>Use bots or automated systems without authorization</li>
              <li>Impersonate others or provide false information</li>
              <li>Engage in market manipulation or fraudulent activities</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">7. Intellectual Property</h2>
            <p className="text-white/70 leading-relaxed">
              All content, features, and functionality of the Service are owned by Polyx and are
              protected by copyright, trademark, and other intellectual property laws. You may not
              copy, modify, distribute, or create derivative works without our express permission.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">8. Disclaimer of Warranties</h2>
            <p className="text-white/70 leading-relaxed">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND,
              EXPRESS OR IMPLIED. WE DO NOT GUARANTEE THE ACCURACY, COMPLETENESS, OR RELIABILITY OF
              ANY INFORMATION PROVIDED. CRYPTOCURRENCY MARKETS ARE VOLATILE AND UNPREDICTABLE.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">9. Limitation of Liability</h2>
            <p className="text-white/70 leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, POLYX SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO
              LOSS OF PROFITS, DATA, OR OTHER INTANGIBLE LOSSES, RESULTING FROM YOUR USE OF THE SERVICE.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">10. Indemnification</h2>
            <p className="text-white/70 leading-relaxed">
              You agree to indemnify and hold harmless Polyx, its officers, directors, employees, and
              agents from any claims, damages, losses, or expenses arising from your use of the Service
              or violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">11. Termination</h2>
            <p className="text-white/70 leading-relaxed">
              We may terminate or suspend your account and access to the Service at our sole discretion,
              without prior notice, for conduct that we believe violates these Terms or is harmful to
              other users, us, or third parties, or for any other reason.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">12. Governing Law</h2>
            <p className="text-white/70 leading-relaxed">
              These Terms shall be governed by and construed in accordance with the laws of the United States,
              without regard to its conflict of law provisions. Any disputes shall be resolved in the courts
              of competent jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">13. Contact Information</h2>
            <p className="text-white/70 leading-relaxed">
              If you have any questions about these Terms of Service, please contact us at{" "}
              <a href="mailto:support@polyx.xyz" className="text-[#FF6B4A] hover:underline">
                support@polyx.xyz
              </a>
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-16">
        <div className="max-w-4xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="text-sm text-white/40">
            © 2024 Polyx. All rights reserved.
          </div>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-sm text-white/40 hover:text-white transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
