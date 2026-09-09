/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Next 16 writes AGENTS.md and CLAUDE.md into the project root on every dev
  // run. Nothing here reads them, so keep the tree free of generated files.
  agentRules: false,
  async headers() {
    return [
      {
        // Legacy HTML pages must always revalidate so the cache-busting
        // ?v= query string they generate at runtime stays fresh.
        source: "/legacy/:path*.html",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        // CSS/JS bundles are already fingerprinted by the ?v= query string
        // emitted from legacy/index.html, so the browser can cache them.
        source: "/legacy/:dir(css|js)/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
