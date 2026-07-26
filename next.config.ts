import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // The dev server only trusts `localhost` by default; browsing via
  // 127.0.0.1 gets its HMR websocket silently blocked otherwise.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
