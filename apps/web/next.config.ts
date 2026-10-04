import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The control center reads the Project World from disk on each request, so it always
  // shows the current state of the repository without a cache to invalidate.
  experimental: {},
};

export default nextConfig;
