"use client";

import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { useThemeStore } from "@/stores/themeStore";

export default function PrivacyPolicyPage() {
  const { isDark } = useThemeStore();

  return (
    <div className={`min-h-screen ${isDark ? 'bg-[#0a0a0a] text-white' : 'bg-[#f5f5f5] text-black'}`}>
      {/* Header */}
      <Header />

      <main className="max-w-4xl mx-auto px-6 py-12 pt-32">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className={`text-sm mb-8 ${isDark ? 'text-white/40' : 'text-gray-500'}`}>Last updated: December 14, 2024</p>

        <div className="prose prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">1. Introduction</h2>
            <p className="text-white/70 leading-relaxed">
              Polyx (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is committed to protecting your privacy. This Privacy Policy
              explains how we collect, use, disclose, and safeguard your information when you use our
              cryptocurrency charting and analytics service. Please read this policy carefully.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">2. Information We Collect</h2>

            <h3 className="text-lg font-medium mb-3 text-white/90">Personal Information</h3>
            <p className="text-white/70 leading-relaxed mb-4">
              We may collect personal information that you voluntarily provide, including:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4 mb-6">
              <li>Email address (for account registration and communication)</li>
              <li>Name (if provided during registration)</li>
              <li>Payment information (processed securely through Stripe)</li>
              <li>Wallet addresses (public addresses only, for portfolio tracking)</li>
            </ul>

            <h3 className="text-lg font-medium mb-3 text-white/90">Automatically Collected Information</h3>
            <p className="text-white/70 leading-relaxed mb-4">
              When you use our Service, we automatically collect:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li>Device information (browser type, operating system)</li>
              <li>IP address and approximate location</li>
              <li>Usage data (pages visited, features used, time spent)</li>
              <li>Cookies and similar tracking technologies</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">3. How We Use Your Information</h2>
            <p className="text-white/70 leading-relaxed mb-4">
              We use the collected information for the following purposes:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li>To provide and maintain our Service</li>
              <li>To process transactions and send related information</li>
              <li>To send you technical notices and support messages</li>
              <li>To respond to your comments and questions</li>
              <li>To analyze usage patterns and improve our Service</li>
              <li>To detect, prevent, and address technical issues</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">4. Wallet Security</h2>
            <p className="text-white/70 leading-relaxed">
              If you create a wallet through our Service, your private keys are encrypted using
              AES-256-GCM encryption before storage. We never store unencrypted private keys.
              Private keys are only decrypted momentarily during transaction signing and are
              immediately cleared from memory. You are responsible for maintaining the security
              of your account credentials that protect access to your wallet.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">5. Information Sharing</h2>
            <p className="text-white/70 leading-relaxed mb-4">
              We do not sell your personal information. We may share your information with:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li><strong>Service Providers:</strong> Third parties that help us operate our Service</li>
              <li><strong>Analytics Partners:</strong> To help us understand usage patterns</li>
              <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
              <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or sale of assets</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">6. Third-Party Services</h2>
            <p className="text-white/70 leading-relaxed mb-4">
              Our Service integrates with third-party services that have their own privacy policies:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li><strong>Solana Blockchain:</strong> Public blockchain data</li>
              <li><strong>Birdeye/Moralis:</strong> For market data</li>
            </ul>
            <p className="text-white/70 leading-relaxed mt-4">
              We encourage you to review the privacy policies of these third-party services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">7. Cookies and Tracking</h2>
            <p className="text-white/70 leading-relaxed mb-4">
              We use cookies and similar technologies to:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li>Keep you signed in to your account</li>
              <li>Remember your preferences and settings</li>
              <li>Analyze how our Service is used</li>
              <li>Provide personalized content</li>
            </ul>
            <p className="text-white/70 leading-relaxed mt-4">
              You can control cookies through your browser settings, but disabling them may affect
              the functionality of our Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">8. Data Retention</h2>
            <p className="text-white/70 leading-relaxed">
              We retain your personal information for as long as your account is active or as needed
              to provide you services. We may retain certain information as required by law or for
              legitimate business purposes. You may request deletion of your account and associated
              data at any time.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">9. Data Security</h2>
            <p className="text-white/70 leading-relaxed">
              We implement appropriate technical and organizational measures to protect your personal
              information against unauthorized access, alteration, disclosure, or destruction. However,
              no method of transmission over the Internet is 100% secure, and we cannot guarantee
              absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">10. Your Rights</h2>
            <p className="text-white/70 leading-relaxed mb-4">
              Depending on your location, you may have the following rights:
            </p>
            <ul className="list-disc list-inside text-white/70 space-y-2 ml-4">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Correction:</strong> Request correction of inaccurate data</li>
              <li><strong>Deletion:</strong> Request deletion of your personal data</li>
              <li><strong>Portability:</strong> Request transfer of your data</li>
              <li><strong>Objection:</strong> Object to certain processing activities</li>
              <li><strong>Withdrawal:</strong> Withdraw consent at any time</li>
            </ul>
            <p className="text-white/70 leading-relaxed mt-4">
              To exercise these rights, please contact us at the email address below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">11. Children&apos;s Privacy</h2>
            <p className="text-white/70 leading-relaxed">
              Our Service is not intended for individuals under the age of 18. We do not knowingly
              collect personal information from children. If you believe we have collected information
              from a child, please contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">12. International Transfers</h2>
            <p className="text-white/70 leading-relaxed">
              Your information may be transferred to and processed in countries other than your own.
              We ensure appropriate safeguards are in place to protect your information in accordance
              with applicable data protection laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">13. Changes to This Policy</h2>
            <p className="text-white/70 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any changes
              by posting the new Privacy Policy on this page and updating the &quot;Last updated&quot; date.
              Your continued use of the Service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-4 text-white">14. Contact Us</h2>
            <p className="text-white/70 leading-relaxed">
              If you have any questions about this Privacy Policy or our data practices, please contact us at{" "}
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
            <Link href="/tos" className="text-sm text-white/40 hover:text-white transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
