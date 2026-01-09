import EmbedClient from "./EmbedClient";

// Required for static export with dynamic routes
export function generateStaticParams() {
  return [];
}

export default function EmbedPage() {
  return <EmbedClient />;
}
