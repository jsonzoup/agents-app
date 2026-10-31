import "server-only";
import { Client } from "minio";

/**
 * This app's object storage (MinIO): uploaded files, generated documents, anything too big for
 * the database. The platform passes `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`,
 * `S3_SECRET_KEY`; the app's user can only reach its own bucket.
 */
const holder = globalThis as unknown as { __appS3?: Client };

export function storage(): Client {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY) throw new Error("没有 S3_ENDPOINT 等变量：平台没有为这个应用开通对象存储，或在本机开发时没有在 .env 里设置");
  const url = new URL(endpoint);
  holder.__appS3 ??= new Client({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    useSSL: url.protocol === "https:",
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    region: process.env.S3_REGION ?? "us-east-1",
  });
  return holder.__appS3;
}

export function bucket(): string {
  if (!process.env.S3_BUCKET) throw new Error("没有 S3_BUCKET");
  return process.env.S3_BUCKET;
}

export async function putFile(key: string, body: Buffer | Uint8Array, type = "application/octet-stream"): Promise<void> {
  await storage().putObject(bucket(), key, Buffer.from(body), body.length, { "Content-Type": type });
}

export async function getFile(key: string): Promise<Buffer> {
  const stream = await storage().getObject(bucket(), key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** A link the browser can download from for `seconds`, without going through this app. */
export function fileUrl(key: string, seconds = 600): Promise<string> {
  return storage().presignedGetObject(bucket(), key, seconds);
}
