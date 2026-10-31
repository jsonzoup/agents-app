import { writeFile } from "node:fs/promises";
import path from "node:path";

export type VoiceWord = { text: string; begin_time: number; end_time: number; begin_index?: number; end_index?: number };
export type VoiceResult = { file: string; words: VoiceWord[]; requestId?: string; model: string; voice: string; rate: number };
type VoiceEvent = { code?: string; request_id?: string; output?: { finish_reason?: string; audio?: { url?: string }; sentence?: { index?: number; words?: VoiceWord[] } } };

/** Parse SSE multiline data fields; timestamp events may repeat the same sentence. */
export function parseVoiceEvents(text: string): { url: string; words: VoiceWord[]; requestId?: string } {
  const words = new Map<string, VoiceWord>();
  let url = "", finished = false, requestId: string | undefined;
  for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    const event = JSON.parse(data) as VoiceEvent;
    if (event.code) throw new Error(`语音服务返回错误（${event.code}）。`);
    requestId = event.request_id || requestId;
    const output = event.output;
    if (output?.finish_reason === "stop") finished = true;
    if (output?.audio?.url) url = output.audio.url;
    for (const word of output?.sentence?.words ?? []) {
      if (!word.text || !Number.isFinite(word.begin_time) || !Number.isFinite(word.end_time) || word.begin_time < 0 || word.end_time <= word.begin_time) throw new Error("语音字时间戳无效。");
      words.set(`${output?.sentence?.index ?? 0}:${word.begin_index ?? word.begin_time}:${word.end_index ?? word.end_time}`, word);
    }
  }
  if (!finished || !url || !words.size) throw new Error("语音流不完整，缺少完成标记、完整音频或字时间戳。");
  const result = [...words.values()].sort((a, b) => a.begin_time - b.begin_time);
  // Provider timestamps must be request-global; sentence-local resets are ambiguous.
  const ordered = [...words.values()];
  if (ordered.some((word, index) => index > 0 && word.begin_time < ordered[index - 1].begin_time)) throw new Error("语音时间戳跨句回退，不能可靠同步。");
  return { url, words: result, requestId };
}

async function limitedBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new Error("语音服务返回空响应。");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("语音响应超过大小限制。");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(chunks);
}

export function voiceSettings() {
  const workspace = process.env.QWEN_TTS_WORKSPACE || "llm-qmorzghvt3s1kusf";
  if (!/^llm-[a-z0-9]+$/.test(workspace)) throw new Error("语音业务空间配置无效。");
  const rate = Number(process.env.QWEN_TTS_RATE || 1);
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error("语音语速必须在0.5至2之间。");
  return { workspace, model: process.env.QWEN_TTS_MODEL || "qwen-audio-3.1-tts-flash", voice: process.env.QWEN_TTS_VOICE || "longxiaoxia_v3.1", rate };
}

/** Only narration is sent to the configured Bailian workspace; credentials never enter artifacts. */
export async function synthesizeVoice(text: string, directory: string, index: number): Promise<VoiceResult> {
  const apiKey = process.env.QWEN_TTS_API_KEY;
  if (!apiKey) throw new Error("请配置服务端 QWEN_TTS_API_KEY 后生成配音视频。");
  const settings = voiceSettings();
  if (!text.trim() || [...text].length > 3000) throw new Error("单幕口播为空或过长。");
  const response = await fetch(`https://${settings.workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-DashScope-SSE": "enable" },
    body: JSON.stringify({ model: settings.model, input: { text, voice: settings.voice, format: "wav", sample_rate: 24000, rate: settings.rate, language_hints: ["zh"], word_timestamp_enabled: true } }),
    signal: AbortSignal.timeout(120_000), redirect: "error",
  });
  if (!response.ok) throw new Error(`语音合成失败（HTTP ${response.status}），请检查业务空间、模型与音色权限。`);
  const parsed = parseVoiceEvents((await limitedBody(response, 32 * 1024 * 1024)).toString("utf8"));
  const url = new URL(parsed.url);
  if (!/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) throw new Error("语音下载地址不属于可信阿里云结果存储。");
  // The API may return HTTP signed OSS URLs; always download over TLS with no auth header.
  url.protocol = "https:";
  const audio = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!audio.ok) throw new Error(`下载语音失败（HTTP ${audio.status}）。`);
  const bytes = await limitedBody(audio, 40 * 1024 * 1024);
  if (bytes.subarray(0, 4).toString() !== "RIFF" || bytes.subarray(8, 12).toString() !== "WAVE") throw new Error("语音服务未返回有效WAV音频。");
  const file = path.join(directory, `voice-${index}.wav`);
  await writeFile(file, bytes, { mode: 0o600 });
  return { file, words: parsed.words, requestId: parsed.requestId, model: settings.model, voice: settings.voice, rate: settings.rate };
}

/** Short readable cues following actual word timestamps, including cover and scene offsets. */
export function voiceCues(words: VoiceWord[], offset: number): Array<{ text: string; start: number; end: number }> {
  const cues: Array<{ text: string; start: number; end: number }> = [];
  let text = "", start = 0, end = 0;
  const flush = () => {
    if (text) cues.push({ text, start: offset + start, end: offset + end });
    text = "";
  };
  for (const word of words) {
    // Qwen can attach the previous sentence's punctuation to the next spoken word.
    const leading = word.text.match(/^[，。！？；：、,.!?;:]+/)?.[0] || "";
    const spoken = word.text.slice(leading.length);
    if (leading && text) {
      text += leading;
      if (/[。！？；.!?;]/.test(leading) || [...text].length >= 14) flush();
    } else if (leading && cues.length) cues[cues.length - 1].text += leading;
    if (!spoken) continue;
    if (text && ([...text].length + [...spoken].length > 28 || end - start >= 5)) flush();
    if (!text) start = word.begin_time / 1000;
    text += spoken; end = word.end_time / 1000;
    if (/[。！？；.!?;]$/.test(spoken) || (/[，、,:：]$/.test(spoken) && [...text].length >= 14)) flush();
  }
  flush();
  return cues;
}

export function voiceSrt(cues: Array<{ text: string; start: number; end: number }>): string {
  const stamp = (seconds: number) => new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23).replace(".", ",");
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join("\n");
}
