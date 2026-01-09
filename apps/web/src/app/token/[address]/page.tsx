import TokenClient from "./TokenClient";

// Required for static export with dynamic routes
export function generateStaticParams() {
  return [];
}

export default function TokenPage() {
  return <TokenClient />;
}
