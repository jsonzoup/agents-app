import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(appRoot, "../..");

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
  distDir: process.env.DRAFT_STUDIO_DIST_DIR || ".next",
  serverExternalPackages: ["kuzu-wasm"],
  outputFileTracingRoot: workspaceRoot,
  turbopack: {
    resolveAlias: {
      react: path.join(appRoot, "node_modules/react/index.js"),
      "react/jsx-runtime": path.join(
        appRoot,
        "node_modules/react/jsx-runtime.js",
      ),
      "react/jsx-dev-runtime": path.join(
        appRoot,
        "node_modules/react/jsx-dev-runtime.js",
      ),
      "@deepseek-ai/dsh-client-ui-primitives/markdown/MarkdownText": path.join(
        workspaceRoot,
        "apps/adapters/dsh-ui/src/markdown/MarkdownText.tsx",
      ),
    },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@deepseek-ai/dsh-client-ui-primitives/markdown/MarkdownText$": path.join(
        workspaceRoot,
        "apps/adapters/dsh-ui/src/markdown/MarkdownText.tsx",
      ),
      "react$": path.join(appRoot, "node_modules/react"),
      "react/jsx-runtime$": path.join(appRoot, "node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime$": path.join(appRoot, "node_modules/react/jsx-dev-runtime.js"),
    };
    return config;
  },
};

export default nextConfig;
