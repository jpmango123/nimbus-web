import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent @sparticuz/chromium binary files from being tree-shaken by the bundler.
  // Without this, the brotli-compressed Chromium binaries are excluded from the
  // deployment, causing "input directory does not exist" errors on Vercel.
  serverExternalPackages: ["@sparticuz/chromium"],
};

export default nextConfig;
