import { createMcpHandler } from "@modelcontextprotocol/server";
import { createBusinessMcpServer } from "@/lib/mcp/server";
import { ensureDirs } from "@/lib/db";
import { backfillCodeRefs } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let ready: Promise<void> | null = null;
async function boot(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await ensureDirs();
      await backfillCodeRefs();
    })();
  }
  return ready;
}

/** MCP 2.0（协议 2026-07-28）：无会话握手，每个 POST 自带协议版本。旧客户端走无状态回退。 */
const handler = createMcpHandler(() => createBusinessMcpServer(), { legacy: "stateless" });

async function handle(request: Request): Promise<Response> {
  await boot();
  return handler.fetch(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
