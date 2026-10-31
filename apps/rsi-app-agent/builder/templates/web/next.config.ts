import type { NextConfig } from "next";

/**
 * The platform serves this app under /apps/<app>/v/<version>/ (a workspace under /apps/<app>/w/<session>/)
 * and sets RSI_BASE_PATH when it builds it; without it (npm run dev) the app is at /.
 */
const basePath = process.env.RSI_BASE_PATH || "";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  turbopack: { root: __dirname },
};

export default nextConfig;
