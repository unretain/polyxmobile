"use client";

import { CrossmintProvider, CrossmintEmbeddedCheckout } from "@crossmint/client-sdk-react-ui";

interface Props {
  apiKey: string;
  orderId: string;
  clientSecret: string;
  receiptEmail: string;
}

export default function CrossmintCheckoutWrapper({ apiKey, orderId, clientSecret, receiptEmail }: Props) {
  return (
    <CrossmintProvider apiKey={apiKey}>
      <CrossmintEmbeddedCheckout
        orderId={orderId}
        clientSecret={clientSecret}
        payment={{
          receiptEmail,
          crypto: { enabled: false },
          fiat: { enabled: true },
          defaultMethod: "fiat",
        }}
      />
    </CrossmintProvider>
  );
}
