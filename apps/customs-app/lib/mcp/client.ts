import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

/** 业务进程自己调用 /api/mcp 时也走 MCP 2.0 客户端，和 Harness 的 dsh-mcp-client 同一协议。 */
export async function withBusinessMcp<T>(origin: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(
    { name: "customs-harness", version: "1.0.0" },
    { capabilities: {}, versionNegotiation: { mode: "auto" } },
  );
  const transport = new StreamableHTTPClientTransport(new URL("/api/mcp", origin));
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function callTool<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find((item) => item && typeof item === "object" && "text" in item) as { text?: string } | undefined;
  if (result.isError) throw new Error(text?.text || `MCP 工具 ${name} 调用失败`);
  if (!text?.text) return undefined as T;
  return JSON.parse(text.text) as T;
}
