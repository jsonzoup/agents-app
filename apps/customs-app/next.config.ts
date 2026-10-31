import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../deepseek-harness/packages");

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "@modelcontextprotocol/server", "@modelcontextprotocol/client"],
  turbopack: {
    resolveAlias: {
      "@deepseek-ai/dsh-client-ui-primitives": path.join(packages, "client/ui-primitives/src/index.ts"),
      "@deepseek-ai/dsh-util-workspace-path": path.join(packages, "util/workspace-path/src/index.ts"),
      "@deepseek-ai/dsh-spill-policy/notice": path.join(packages, "spill/spill-policy/src/notice.ts"),
      "@deepseek-ai/dsh-output-retention": path.join(packages, "util/output-retention/src/index.ts"),
      "@deepseek-ai/dsh-client-store": path.join(packages, "client/store/src/index.ts"),
    },
  },
};

export default nextConfig;
