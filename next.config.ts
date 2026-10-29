import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // static export — the app is 100% client-side (localStorage per device,
  // Web Audio, speech synthesis), so no Node server is needed anywhere.
  // `next build` emits the deployable site into ./out — that folder is what
  // Vercel serves and what `wrangler deploy` uploads to Cloudflare Workers.
  output: "export",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
