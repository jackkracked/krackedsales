/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    // Explicitly set root to prevent Vercel's monorepo detector from walking up
    // to /Users/jackpointer/package.json and treating the home dir as the root.
    root: __dirname,
  },
  serverExternalPackages: ["@react-pdf/renderer"],
  experimental: {
    // Reuse the client-side router cache so clicking back to a page you just visited
    // paints instantly instead of re-requesting its server shell every time. The shell
    // holds no live data (that flows through React Query), so 30s staleness is safe and
    // kills the "dead click" beat on back-navigation app-wide.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

module.exports = nextConfig;
