import type { ContentChannel } from "./types";

export const contentChannels: ContentChannel[] = ["xiaohongshu", "wechat", "wechat_card", "toutiao", "video"];

/** Accept legacy single-channel requests; an explicit selection must be nonempty. */
export function requestedChannels(body: unknown): ContentChannel[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const channels = "channels" in body ? body.channels : undefined;
  const channel = "channel" in body ? body.channel : undefined;
  if (channels !== undefined) {
    if (!Array.isArray(channels) || !channels.length ||
        channels.some((channel) => !isContentChannel(channel))) return null;
    return contentChannels.filter((channel) => channels.includes(channel));
  }
  if (channel !== undefined && !isContentChannel(channel)) return null;
  return [isContentChannel(channel) ? channel : "xiaohongshu"];
}

export function toggleChannel(selected: ContentChannel[], channel: ContentChannel): ContentChannel[] {
  if (selected.includes(channel)) return selected.length > 1 ? selected.filter((item) => item !== channel) : selected;
  return contentChannels.filter((item) => item === channel || selected.includes(item));
}

/** Validate scene IDs received over HTTP. */
export function isContentChannel(value: unknown): value is ContentChannel {
  return typeof value === "string" && contentChannels.some((channel) => channel === value);
}
