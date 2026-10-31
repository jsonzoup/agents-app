import { isIP } from "node:net";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 4;

export type ReadArticleResult = {
  url: string;
  title: string;
  text: string;
  publishedAt: string;
  readerSource: "direct" | "jina";
};

function normalizedHost(raw: string): string {
  return raw.replace(/^www\./, "").replace(/\.$/, "").toLowerCase();
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const octets = host.split(".").map(Number);
    return (
      octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    );
  }
  return (
    ipVersion === 6 &&
    (host === "::1" ||
      host.startsWith("fe80:") ||
      host.startsWith("fc") ||
      host.startsWith("fd"))
  );
}

function allowedRedirect(candidate: URL, initial: URL, sourceHosts: string[]): boolean {
  if (
    !["http:", "https:"].includes(candidate.protocol) ||
    candidate.username ||
    candidate.password ||
    (initial.protocol === "https:" && candidate.protocol === "http:")
  )
    return false;
  if (isLocalHostname(candidate.hostname)) return false;
  const host = normalizedHost(candidate.hostname);
  const initialHost = normalizedHost(initial.hostname);
  return (
    host === initialHost ||
    sourceHosts.some(
      (base) => host === base || host.endsWith(`.${base}`),
    )
  );
}

async function readLimitedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("原文响应没有正文。");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error("原文超过 5MB 本地读取上限。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error("原文超过 5MB 本地读取上限。");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function extractHtml(
  html: string,
  fallbackTitle: string,
): { title: string; text: string; publishedAt: string } {
  const titleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const publishedMatch =
    html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+name=["'](?:date|pubdate|publish-date)["'][^>]+content=["']([^"']+)["']/i);
  const body =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    html;
  const text = decodeEntities(
    body
      .replace(
        /<(script|style|noscript|svg|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi,
        " ",
      )
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    title: decodeEntities(
      titleMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || fallbackTitle,
    ),
    text,
    publishedAt: publishedMatch?.[1]?.trim() || "",
  };
}

function publicArticleUrl(rawUrl: string): URL {
  const initial = new URL(rawUrl);
  if (
    !["http:", "https:"].includes(initial.protocol) ||
    initial.username ||
    initial.password
  )
    throw new Error("原文 URL 无效。");
  if (isLocalHostname(initial.hostname))
    throw new Error("原文 URL 指向本机或私有地址。");
  return initial;
}

async function readArticleDirect(
  rawUrl: string,
  siteUrls: string[],
  signal?: AbortSignal,
): Promise<ReadArticleResult> {
  const initial = publicArticleUrl(rawUrl);
  const sourceHosts = siteUrls.flatMap((value) => {
    try {
      const hostname = new URL(value).hostname;
      return isLocalHostname(hostname) ? [] : [normalizedHost(hostname)];
    } catch {
      return [];
    }
  });
  let current = initial;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!allowedRedirect(current, initial, sourceHosts))
      throw new Error("原文跳转到了未授权的域名。");
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000);
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      },
      signal: requestSignal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("原文重定向缺少目标地址。");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok)
      throw new Error(`原文读取失败（HTTP ${response.status}）。`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const bytes = await readLimitedBody(response);
    if (contentType.includes("application/pdf"))
      throw new Error("该链接是 PDF，当前本地读取器暂不支持 PDF 正文。");
    const raw = new TextDecoder(
      contentType.includes("charset=gb") ? "gb18030" : "utf-8",
    ).decode(bytes);
    const result = contentType.includes("html")
      ? extractHtml(raw, current.hostname)
      : { title: current.hostname, text: raw.trim(), publishedAt: "" };
    if (result.text.length < 200)
      throw new Error("原文正文过短，可能是登录页、验证页或空白页面。");
    return {
      ...result,
      url: current.toString(),
      text: result.text.slice(0, 2_000_000),
      readerSource: "direct",
    };
  }
  throw new Error("原文重定向次数过多。");
}

function jinaReaderBaseUrl(): URL | undefined {
  if (process.env.JINA_READER_ENABLED?.trim() === "false") return undefined;
  try {
    const url = new URL(
      process.env.JINA_READER_BASE_URL?.trim() || "https://r.jina.ai",
    );
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return undefined;
  }
}

function jinaReaderTimeoutMs(): number {
  const configured = Number(process.env.JINA_READER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(5_000, Math.min(120_000, Math.round(configured)))
    : 45_000;
}

function parseJinaReader(
  raw: string,
  url: URL,
): { title: string; text: string; publishedAt: string } {
  const marker = /^Markdown Content:\s*$/im.exec(raw);
  const metadata = marker ? raw.slice(0, marker.index) : raw.slice(0, 3000);
  const body = marker ? raw.slice(marker.index + marker[0].length) : raw;
  const title =
    metadata.match(/^Title:\s*(.+)$/im)?.[1]?.trim() ||
    url.hostname;
  const publishedAt =
    metadata.match(/^Published Time:\s*(.+)$/im)?.[1]?.trim() || "";
  const text = body
    .replace(
      /^(?:URL Source|Description|Warning|Published Time):[^\n]*\n+/gim,
      "",
    )
    .trim();
  return { title, text, publishedAt };
}

async function readArticleThroughJina(
  initial: URL,
  signal?: AbortSignal,
): Promise<ReadArticleResult> {
  const base = jinaReaderBaseUrl();
  if (!base) throw new Error("Jina Reader 未启用。");
  const target = `${base.toString().replace(/\/$/, "")}/${initial.toString()}`;
  const timeout = jinaReaderTimeoutMs();
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  const apiKey = process.env.JINA_API_KEY?.trim();
  const response = await fetch(target, {
    redirect: "follow",
    headers: {
      Accept: "text/plain",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    signal: requestSignal,
  });
  if (!response.ok)
    throw new Error(`Jina Reader 读取失败（HTTP ${response.status}）。`);
  const bytes = await readLimitedBody(response);
  const raw = new TextDecoder("utf-8").decode(bytes);
  const result = parseJinaReader(raw, initial);
  if (result.text.length < 200)
    throw new Error("Jina Reader 返回的正文过短。");
  return {
    url: initial.toString(),
    title: result.title,
    text: result.text.slice(0, 2_000_000),
    publishedAt: result.publishedAt,
    readerSource: "jina",
  };
}

/**
 * Fetches one discovered article with normal HTTP first, then Jina Reader as a
 * fallback for pages blocked by anti-bot, login walls, or incomplete HTML.
 */
export async function readArticle(
  rawUrl: string,
  siteUrls: string[],
  signal?: AbortSignal,
): Promise<ReadArticleResult> {
  const initial = publicArticleUrl(rawUrl);
  let directError: Error | undefined;
  try {
    return await readArticleDirect(initial.toString(), siteUrls, signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError"))
      throw error;
    directError = error instanceof Error ? error : new Error(String(error));
  }
  if (!jinaReaderBaseUrl()) throw directError;
  try {
    return await readArticleThroughJina(initial, signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError"))
      throw error;
    const fallback =
      error instanceof Error ? error.message : "Jina Reader 读取失败。";
    throw new Error(
      `直接读取失败：${directError.message.slice(0, 260)}；Jina 兜底失败：${fallback.slice(0, 260)}`,
    );
  }
}
