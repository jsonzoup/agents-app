import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { synthesizeVoice, voiceCues, voiceSrt, type VoiceResult } from "./video-voice";

type Command = (command: string, args: string[], cwd: string, timeoutMs?: number) => Promise<void>;
type Scene = { id: string; narration: string; duration: number };

/** Compose a real cover intro, speech-paced scene clips and an AAC soundtrack. */
export async function voiceDelivery(input: {
  movie: string; cover: string; scenes: Scene[]; work: string; command: Command;
  probe: (file: string, output: string, work: string) => Promise<void>;
  onStage: (stage: string) => Promise<void>;
}) {
  const { work, probe } = input;
  const commands: string[][] = [];
  const command: Command = async (binary, args, cwd, timeout) => {
    await input.command(binary, args, cwd, timeout);
    commands.push([binary, ...args.map(arg => arg === input.movie ? "silent-source.mp4" : arg === input.cover ? "cover.png" : arg.startsWith(work + path.sep) ? arg.slice(work.length + 1) : arg)]);
  };
  const clips: string[] = [], timings: Array<Record<string, unknown>> = [];
  const cues: ReturnType<typeof voiceCues> = [];
  const coverDuration = 1;
  const coverClip = path.join(work, "cover-intro.mp4");
  await command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", input.cover, "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", String(coverDuration), "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "24000", "-ac", "1", coverClip], work);
  clips.push(coverClip);
  let sourceStart = 0, finalStart = coverDuration;
  for (let index = 0; index < input.scenes.length; index++) {
    const scene = input.scenes[index];
    await input.onStage(`正在生成龙小夏配音并同步分镜（${index + 1}/${input.scenes.length}）`);
    const voice: VoiceResult = await synthesizeVoice(scene.narration, work, index);
    const probeFile = path.join(work, `voice-${index}-probe.json`);
    await probe(voice.file, probeFile, work);
    const info = JSON.parse(await readFile(probeFile, "utf8"));
    const duration = Number(info.format.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180) throw new Error("语音时长无效或单幕过长。");
    if (voice.words.at(-1)!.end_time / 1000 > duration + 0.15) throw new Error("语音字时间戳超过实际音频长度。");
    // Preserve natural speech; scene videos adapt to voice, with a short reading pause.
    const pause = index === input.scenes.length - 1 ? 1.2 : 0.4;
    const target = Math.ceil((duration + pause) * 30) / 30;
    const clip = path.join(work, `delivery-${index}.mp4`);
    const sourceEnd = sourceStart + scene.duration;
    await command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input.movie, "-i", voice.file,
      "-filter_complex", `[0:v]trim=start=${sourceStart}:end=${sourceEnd},setpts=(PTS-STARTPTS)*${target / scene.duration},fps=30,tpad=stop_mode=clone:stop_duration=1,trim=duration=${target},setpts=PTS-STARTPTS[v];[1:a]apad,atrim=duration=${target},asetpts=PTS-STARTPTS[a]`,
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "24000", "-ac", "1", "-t", String(target), clip], work);
    cues.push(...voiceCues(voice.words, finalStart));
    timings.push({ id: scene.id, sourceStart, sourceDuration: scene.duration, start: finalStart, duration: target, speechDuration: duration, trailingPause: target - duration, model: voice.model, voice: voice.voice, rate: voice.rate, requestId: voice.requestId, audioFile: path.basename(voice.file), words: voice.words });
    clips.push(clip); sourceStart = sourceEnd; finalStart += target;
  }
  const list = path.join(work, "delivery-clips.txt");
  // All filenames are generated locally; use relative names for a portable concat list.
  await writeFile(list, clips.map(file => `file '${path.basename(file)}'`).join("\n"));
  const movie = path.join(work, "delivery.mp4");
  await command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "1", "-i", list, "-c", "copy", "-movflags", "+faststart", movie], work);
  const finalProbe = path.join(work, "delivery-probe.json");
  await probe(movie, finalProbe, work);
  const info = JSON.parse(await readFile(finalProbe, "utf8"));
  const video = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
  const audio = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
  if (!video || !audio || video.codec_name !== "h264" || video.pix_fmt !== "yuv420p" || video.width !== 1080 || video.height !== 1920 || video.r_frame_rate !== "30/1" || audio.codec_name !== "aac") throw new Error("配音成片编码或尺寸不符合交付规格。");
  if (![Number(video.duration), Number(audio.duration)].every(Number.isFinite) || Math.abs(Number(video.duration) - finalStart) > 0.15 || Math.abs(Number(audio.duration) - finalStart) > 0.2) throw new Error("配音成片音视频时长未对齐。");
  return { movie, duration: finalStart, subtitle: voiceSrt(cues), timings, coverDuration, commands };
}
