import type { ContentChannel } from "./types";

export const channelDownloadPrefix: Record<ContentChannel, string> = {
  xiaohongshu: "xiaohongshu",
  wechat: "wechat",
  toutiao: "toutiao",
  wechat_card: "wechat-card",
  video: "video",
};

export function channelDownloadName(channel: ContentChannel, id: string, extension: "zip" | "md"): string {
  return `${channelDownloadPrefix[channel]}-${id}.${extension}`;
}
