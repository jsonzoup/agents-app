import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Draft } from "@/lib/types";
import {
  renderWechatArticleHtml,
  sortedWechatBodyImages,
  WECHAT_BODY_HEIGHT,
  WECHAT_BODY_WIDTH,
  WECHAT_COVER_HEIGHT,
  WECHAT_COVER_WIDTH,
} from "@/lib/wechat";
import { home } from "@/lib/store";

const wechatApiBase = "https://api.weixin.qq.com";
const mediaRoot = path.resolve(home, "media");
let tokenCache:
  | { value: string; expiresAt: number; appId: string }
  | undefined;

export function wechatDraftConfigured(): boolean {
  return Boolean(
    process.env.WECHAT_APP_ID?.trim() &&
      process.env.WECHAT_APP_SECRET?.trim(),
  );
}

export async function createOfficialWechatDraft(
  draft: Draft,
): Promise<string> {
  if (draft.channel !== "wechat")
    throw new Error("请先将草稿发布渠道切换为微信公众号。");
  if (!draft.images.length)
    throw new Error("公众号草稿至少需要一张封面图。");
  const token = await accessToken();
  const coverId = draft.wechatCoverImageId || draft.images[0].id;
  const cover =
    draft.images.find((image) => image.id === coverId) || draft.images[0];
  const coverBytes = await normalizedImage(
    cover.fileName,
    WECHAT_COVER_WIDTH,
    WECHAT_COVER_HEIGHT,
    "png",
  );
  const thumbMediaId = await uploadPermanentImage(token, coverBytes);
  const bodyImages = sortedWechatBodyImages(draft);
  const uploaded = [];
  for (const [index, item] of bodyImages.entries()) {
    const bytes = await normalizedImage(
      item.image.fileName,
      WECHAT_BODY_WIDTH,
      WECHAT_BODY_HEIGHT,
      "jpeg",
    );
    const url = await uploadArticleImage(token, bytes);
    uploaded.push({ ...item, src: url, order: index + 1 });
  }
  const content = renderWechatArticleHtml(
    draft,
    uploaded.map(({ image, position, src }) => ({ image, position, src })),
  );
  const response = await wechatJson(
    `/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        articles: [
          {
            title: (draft.title || "未命名文章").slice(0, 64),
            author: draft.wechatAuthor.slice(0, 16),
            digest: draft.wechatSummary.slice(0, 120),
            content,
            thumb_media_id: thumbMediaId,
            need_open_comment: 0,
            only_fans_can_comment: 0,
          },
        ],
      }),
    },
    "创建公众号草稿",
  );
  const mediaId =
    response && typeof response.media_id === "string"
      ? response.media_id
      : "";
  if (!mediaId) throw new Error("公众号接口没有返回草稿 media_id。");
  return mediaId;
}

async function normalizedImage(
  fileName: string,
  width: number,
  height: number,
  format: "png" | "jpeg",
): Promise<Buffer> {
  if (path.basename(fileName) !== fileName)
    throw new Error("草稿图片路径无效。");
  const source = path.resolve(mediaRoot, fileName);
  if (!source.startsWith(`${mediaRoot}${path.sep}`))
    throw new Error("草稿图片路径无效。");
  let bytes: Buffer;
  try {
    bytes = await readFile(source);
  } catch {
    throw new Error("草稿图片文件缺失，请重新生成视觉组。");
  }
  const resized = () =>
    sharp(bytes).resize({
      width,
      height,
      fit: "cover",
      position: "centre",
    });
  if (format === "png")
    return resized().png({ compressionLevel: 9 }).toBuffer();
  for (const quality of [82, 70, 58, 46]) {
    const output = await resized()
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (output.length <= 1_000_000) return output;
  }
  throw new Error("正文图压缩后仍超过公众号图片上传限制。");
}

async function accessToken(): Promise<string> {
  const appId = process.env.WECHAT_APP_ID?.trim() ?? "";
  const secret = process.env.WECHAT_APP_SECRET?.trim() ?? "";
  if (!appId || !secret)
    throw new Error(
      "未配置公众号 AppID 或 AppSecret，暂时不能创建官方草稿。",
    );
  if (
    tokenCache &&
    tokenCache.appId === appId &&
    tokenCache.expiresAt > Date.now() + 60_000
  )
    return tokenCache.value;
  const url = new URL("/cgi-bin/token", wechatApiBase);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", secret);
  const response = await wechatJson(url.pathname + url.search, {}, "获取访问凭证");
  const accessTokenValue =
    response && typeof response.access_token === "string"
      ? response.access_token
      : "";
  const expiresIn =
    response && typeof response.expires_in === "number"
      ? response.expires_in
      : 7200;
  if (!accessTokenValue)
    throw new Error("公众号接口没有返回 access_token。");
  tokenCache = {
    value: accessTokenValue,
    appId,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  };
  return accessTokenValue;
}

async function uploadPermanentImage(
  token: string,
  bytes: Buffer,
): Promise<string> {
  const response = await uploadImage(
    `/cgi-bin/material/add_material?access_token=${encodeURIComponent(token)}&type=image`,
    bytes,
    "wechat-cover.png",
    "image/png",
    "上传公众号封面",
  );
  const mediaId =
    response && typeof response.media_id === "string"
      ? response.media_id
      : "";
  if (!mediaId) throw new Error("公众号接口没有返回封面 media_id。");
  return mediaId;
}

async function uploadArticleImage(
  token: string,
  bytes: Buffer,
): Promise<string> {
  const response = await uploadImage(
    `/cgi-bin/media/uploadimg?access_token=${encodeURIComponent(token)}`,
    bytes,
    "wechat-body.jpg",
    "image/jpeg",
    "上传公众号正文图片",
  );
  if (!response || typeof response.url !== "string" || !response.url)
    throw new Error("公众号接口没有返回正文图片 URL。");
  return response.url;
}

async function uploadImage(
  requestPath: string,
  bytes: Buffer,
  fileName: string,
  contentType: string,
  action: string,
): Promise<Record<string, unknown> | undefined> {
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(bytes)], { type: contentType }),
    fileName,
  );
  return wechatJson(
    requestPath,
    {
      method: "POST",
      body: form,
    },
    action,
  );
}

async function wechatJson(
  requestPath: string,
  init: RequestInit,
  action: string,
): Promise<Record<string, unknown> | undefined> {
  let response: Response;
  try {
    response = await fetch(`${wechatApiBase}${requestPath}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error(`${action}时无法连接微信接口。`);
  }
  if (!response.ok)
    throw new Error(`${action}失败：微信接口返回 HTTP ${response.status}。`);
  const result = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!result) throw new Error(`${action}失败：微信接口返回了无法读取的数据。`);
  const errCode = typeof result.errcode === "number" ? result.errcode : 0;
  if (errCode) {
    const message =
      typeof result.errmsg === "string" ? result.errmsg : "未知错误";
    const hint =
      errCode === 40164
        ? "当前出口 IP 不在公众号后台的 IP 白名单中。"
        : errCode === 40001
          ? "AppSecret 无效，请检查公众号配置。"
          : errCode === 48001
            ? "该公众号没有所需的素材或草稿箱接口权限。"
            : "";
    throw new Error(
      `${action}失败（${errCode}）：${hint || message.slice(0, 300)}`,
    );
  }
  return result;
}
