/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    // Explicitly set root to prevent Vercel's monorepo detector from walking up
    // to /Users/jackpointer/package.json and treating the home dir as the root.
    root: __dirname,
  },
  serverExternalPackages: ["@react-pdf/renderer"],
};

module.exports = nextConfig;
