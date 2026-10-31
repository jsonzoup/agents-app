import { app } from "@/server/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const maximumBodyBytes = 12 * 1024 * 1024;
const maximumBufferedBodies = 4;
let bufferedBodies = 0;

async function handler(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maximumBodyBytes)
    return new Response(JSON.stringify({ error: "请求不能超过 12MB。" }), {
      status: 413,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  if (!request.body) return app.fetch(request);
  if (bufferedBodies >= maximumBufferedBodies)
    return new Response(
      JSON.stringify({ error: "本机同时处理的上传较多，请稍后重试。" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  bufferedBodies += 1;
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBodyBytes) {
        await reader.cancel();
        return new Response(JSON.stringify({ error: "请求不能超过 12MB。" }), {
          status: 413,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      chunks.push(result.value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return await app.fetch(
      new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
        signal: request.signal,
      }),
    );
  } finally {
    bufferedBodies -= 1;
  }
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
