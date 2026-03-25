import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent @sparticuz/chromium binary files from being tree-shaken
  serverExternalPackages: ["@sparticuz/chromium"],

  // Explicitly include the chromium binary files in the deployment.
  // Without this, the brotli-compressed Chromium binaries (.br files)
  // are excluded from Vercel's output trace, causing screenshot failures.
  outputFileTracingIncludes: {
    "/api/report": ["./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
