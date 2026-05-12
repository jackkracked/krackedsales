import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Explicitly set root to avoid confusion with the stray package-lock.json in home dir
    root: __dirname,
  },
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
