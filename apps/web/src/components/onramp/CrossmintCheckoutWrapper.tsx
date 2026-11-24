"use client";

import { useEffect, useRef } from "react";
import {
  CrossmintProvider,
  CrossmintCheckoutProvider,
  CrossmintEmbeddedCheckout,
  useCrossmintCheckout,
} from "@crossmint/client-sdk-react-ui";

/**
 * Embedded Crossmint checkout + live order tracking.
 *
 * Crossmint launch checklist coverage:
 *  - "Show the specific error message for each failed payment" → failureReason
 *    codes are mapped to actionable copy in paymentErrorMessage().
 *  - "Show the order status, and a confirmation when the order completes" →
 *    phase changes are reported up via onPhase/onCompleted; the modal renders
 *    the status line and the confirmation screen.
 */

interface Props {
  apiKey: string;
  orderId: string;
  clientSecret: string;
  receiptEmail: string;
  isDark: boolean;
  /** Fires on every phase change: "payment" | "delivery" | "completed". */
  onPhase: (phase: string) => void;
  /** Fires with user-facing copy whenever a payment attempt fails. */
  onPaymentError: (message: string) => void;
}

/** Map Crossmint payment failure codes to specific, actionable copy. */
export function paymentErrorMessage(code: string | null, message?: string | null): string {
  const c = (code || "").toLowerCase();
  if (c.includes("insufficient")) return "Your card has insufficient funds. Try a smaller amount or a different card.";
  if (c.includes("declined")) return "Your card was declined by your bank. Try a different card, or contact your bank.";
  if (c.includes("expired") && c.includes("card")) return "That card is expired. Use a different card.";
  if (c.includes("cvc") || c.includes("cvv")) return "The security code (CVC) didn't match. Check the 3 digits on the back of your card.";
  if (c.includes("3ds") || c.includes("authentication")) return "Card verification failed. Try again and complete your bank's verification step.";
  if (c.includes("kyc") || c.includes("identity")) return "Identity verification couldn't be completed. Double-check your details and try again.";
  if (c.includes("quote") || c.includes("expired")) return "Your quote expired. Close and reopen checkout to get a fresh price.";
  if (c.includes("fraud") || c.includes("risk") || c.includes("rejected")) return "This payment was blocked by the card processor's risk checks. Try a different card.";
  if (c.includes("limit")) return "This amount is over your card's limit. Try a smaller amount.";
  if (message) return message;
  return "Payment failed. Try again, or use a different card.";
}

function CheckoutWithStatus({ apiKey: _apiKey, orderId, clientSecret, receiptEmail, isDark, onPhase, onPaymentError }: Props) {
  const { order } = useCrossmintCheckout();
  const lastPhase = useRef<string>("");
  const lastFailure = useRef<string>("");

  useEffect(() => {
    if (!order) return;
    if (order.phase && order.phase !== lastPhase.current) {
      lastPhase.current = order.phase;
      onPhase(order.phase);
    }
    const failure = (order as any)?.payment?.failureReason;
    if (failure) {
      const key = `${failure.code}:${failure.message}`;
      if (key !== lastFailure.current) {
        lastFailure.current = key;
        onPaymentError(paymentErrorMessage(failure.code, failure.message));
      }
    }
  }, [order, onPhase, onPaymentError]);

  return (
    <CrossmintEmbeddedCheckout
      orderId={orderId}
      clientSecret={clientSecret}
      payment={{
        receiptEmail,
        crypto: { enabled: false },
        fiat: {
          enabled: true,
          allowedMethods: { card: true, applePay: true, googlePay: true },
        },
        defaultMethod: "fiat",
      }}
      appearance={{
        variables: {
          borderRadius: "12px",
          colors: isDark
            ? {
                backgroundPrimary: "#111111",
                borderPrimary: "rgba(255,255,255,0.12)",
                textPrimary: "#ffffff",
                textSecondary: "rgba(255,255,255,0.55)",
                accent: "#FF6B4A",
                danger: "#f87171",
              }
            : {
                backgroundPrimary: "#ffffff",
                borderPrimary: "rgba(0,0,0,0.12)",
                textPrimary: "#111111",
                textSecondary: "rgba(0,0,0,0.55)",
                accent: "#FF6B4A",
                danger: "#dc2626",
              },
        },
      }}
    />
  );
}

export default function CrossmintCheckoutWrapper(props: Props) {
  return (
    <CrossmintProvider apiKey={props.apiKey}>
      <CrossmintCheckoutProvider>
        <CheckoutWithStatus {...props} />
      </CrossmintCheckoutProvider>
    </CrossmintProvider>
  );
}
