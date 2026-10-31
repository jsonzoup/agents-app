import { auditGenerated } from "./quality-review";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, lstat, realpath, readlink, readdir, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import JSZip from "jszip";
import { directVideo, videoContextDigest, manimSkillRevision, type VideoDirectorOptions } from "./video-director";
import type { Draft, DraftVideo } from "../lib/types";
import { voiceDelivery } from "./video-delivery";
import { videoSourceText } from "../lib/video";

const activeChildren = new Set<ReturnType<typeof spawn>>();
process.once("exit", () => {
  for (const child of activeChildren) {
    try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch (error) { /* Process already exited. */ }
  }
});
const appRoot = [process.cwd(), path.resolve(process.cwd(), "apps/draft-studio")].find(root => existsSync(path.join(root, "references/manimgl-video/SKILL.md"))) || process.cwd();
/** Repository-owned writing and rendering instructions included in video prompts. */
export const videoSkillPath = path.join(appRoot, "references/manimgl-video/SKILL.md");

/** Run a fixed executable without shell interpolation or provider credentials.
 * @param command - Trusted local executable.
 * @param args - Separate command arguments.
 * @param cwd - Private rendering directory.
 * @param timeoutMs - Maximum process lifetime.
 * @returns Completion after process exit, rejecting on failure or timeout.
 */
export function runVideoCommand(command: string, args: string[], cwd: string, timeoutMs = 20 * 60_000): Promise<void> {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|^PYTHON|^NODE_OPTIONS$/i.test(key))) };
  Object.assign(env, { XDG_CACHE_HOME: path.join(cwd, ".cache"), MPLCONFIGDIR: path.join(cwd, ".cache/matplotlib"), TMPDIR: cwd, PYTHONPYCACHEPREFIX: path.join(cwd, ".cache/pycache") });
  return new Promise((resolve, reject) => {
    let errorText = "";
    let timedOut = false;
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32" });
    activeChildren.add(child);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) child.kill("SIGKILL"); }
      } else child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr?.on("data", chunk => { errorText = (errorText + chunk.toString()).slice(-1800); });
    child.on("error", () => { activeChildren.delete(child); clearTimeout(timer); reject(new Error("无法启动视频工具，请配置 MANIMGL_BIN 并安装 FFmpeg、中文字体和 OpenGL 运行环境。")); });
    child.on("close", code => {
      activeChildren.delete(child);
      clearTimeout(timer);
      if (timedOut) reject(new Error("视频渲染超时，已停止渲染进程，请缩短口播稿后重试。"));
      else if (code !== 0) reject(new Error(`视频渲染失败（${code}）：${errorText}`));
      else resolve();
    });
  });
}

/** Render DSH-generated code with article and research context, saving outputs after successful encoding.
 * @param draft - Saved video narration and copy.
 * @param mediaRoot - Destination for completed artifacts.
 * @param runtimeRoot - Private work directory and managed ManimGL environment.
 * @returns Completed movie and sidecar metadata.
 */
export async function renderDraftVideo(draft: Draft, mediaRoot: string, runtimeRoot: string, options: VideoDirectorOptions = {}): Promise<DraftVideo> {
  let feedback = "";
  let coverFile = options.coverFile;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try { return await renderVideoAttempt(draft, mediaRoot, runtimeRoot, { ...options, coverFile, qualityFeedback: feedback }); }
    catch (error) {
      if (!(error instanceof DeliveryReviewError) || attempt === 2) throw error;
      feedback = error.message;
      if (options.repairCover) coverFile = await options.repairCover(feedback);
      await options.onPhase?.("repair", attempt + 1);
      await options.onStage?.(`DSH正在根据成片审校反馈重新制作（${attempt + 1}/2）`);
    }
  }
  throw new Error("成片审校未完成。");
}

class DeliveryReviewError extends Error {}

async function renderVideoAttempt(draft: Draft, mediaRoot: string, runtimeRoot: string, options: VideoDirectorOptions): Promise<DraftVideo> {
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  await mkdir(mediaRoot, { recursive: true });
  const work = await realpath(await mkdtemp(path.join(runtimeRoot, "video-")));
  const stem = `video_${randomUUID()}`;
  const output = { fileName: `${stem}.mp4`, subtitleFile: `${stem}.srt`, planFile: `${stem}.json`, projectFile: `${stem}.zip` };
  const managedBin = path.join(runtimeRoot, "manimgl", process.platform === "win32" ? "Scripts/manimgl.exe" : "bin/manimgl");
  const configuredBin = process.env.MANIMGL_BIN || (existsSync(managedBin) ? managedBin : "manimgl");
  const binary = path.isAbsolute(configuredBin) ? configuredBin : (process.env.PATH || "").split(path.delimiter).map(directory => path.join(directory, configuredBin)).find(candidate => existsSync(candidate)) || configuredBin;
  const python = path.join(path.dirname(binary), process.platform === "win32" ? "python.exe" : "python");
  const stage = options.onStage ?? (async () => {});
  try {
    await options.onPhase?.("create");
    await stage("DSH正在加载ManimGL技能、阅读文章与研究资料，设计解释性分镜");
    let directed = await directVideo(draft, work, appRoot, options);
    // Trusted adapter records real scene boundaries inside the existing render sandbox.
    await writeFile(path.join(work, "render_scene.py"), `import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from scene import DraftVideoScene
def mark_scene(self, scene_id):
    with open("boundaries.jsonl", "a", encoding="utf-8") as stream:
        stream.write(json.dumps({"id": scene_id, "time": self.time}) + "\\n")
DraftVideoScene.mark_scene = mark_scene
SCENES_IN_ORDER = [DraftVideoScene]
`);
    const config = `camera:\n  background_color: "#101D2C"\n  fps: 30\nfile_writer:\n  video_codec: "libx264"\n  pixel_format: "yuv420p"\ndirectories:\n  cache: ${JSON.stringify(path.join(work, ".cache/manim"))}\n`;
    await writeFile(path.join(work, "custom_config.yml"), config);
    let previewReviewed = false;
    let actualDuration = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await writeFile(path.join(work, "scene.py"), directed.sceneCode, { mode: 0o600 });
        await runVideoCommand(python, [path.join(appRoot, "scripts/check_video_code.py"), path.join(work, "scene.py")], work, 15_000);
        const preview = !previewReviewed;
        await options.onPhase?.(preview ? "render" : "recheck");
        await stage(preview ? "正在试渲染DSH生成的动画代码" : "正在渲染DSH编写的正式视频");
        const rendered = path.join(work, preview ? "preview.mp4" : "result.mp4");
        await rm(rendered, { force: true });
        await rm(path.join(work, "boundaries.jsonl"), { force: true });
        await constrainedRender(binary, [path.join(work, "render_scene.py"), "DraftVideoScene", "-w", "--resolution", preview ? "360x640" : "1080x1920", "--video_dir", work, "--file_name", preview ? "preview" : "result"], work);
        const infoFile = path.join(work, "probe.json");
        await captureVideoProbe(rendered, infoFile, work);
        const info = JSON.parse(await readFile(infoFile, "utf8"));
        actualDuration = Number(info.format.duration);
        const expected = directed.scenes.reduce((total, scene) => total + scene.duration, 0);
        if (!Number.isFinite(actualDuration) || Math.abs(expected - actualDuration) > 0.15) throw new Error(`实际时长${actualDuration}秒与分镜${expected}秒不一致，请让每幕动画时长严格匹配。`);
        const boundaries = (await readFile(path.join(work, "boundaries.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
        let boundaryTime = 0;
        if (boundaries.length !== directed.scenes.length + 1) throw new Error("每幕必须依序调用self.mark_scene(id)，结束调用self.mark_scene('__end__')。");
        for (let i = 0; i < directed.scenes.length; i++) {
          if (!Number.isFinite(boundaries[i].time) || boundaries[i].id !== directed.scenes[i].id || Math.abs(boundaries[i].time - boundaryTime) > 0.15) throw new Error("实际分幕边界与分镜时间不匹配，请修复mark_scene位置及动画时长。");
          boundaryTime += directed.scenes[i].duration;
        }
        if (!Number.isFinite(boundaries.at(-1).time) || boundaries.at(-1).id !== "__end__" || Math.abs(boundaries.at(-1).time - expected) > 0.15) throw new Error("缺少正确的分幕结束标记。");
        const stream = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
        if (!stream || stream.width !== (preview ? 360 : 1080) || stream.height !== (preview ? 640 : 1920) || stream.r_frame_rate !== "30/1" || stream.codec_name !== "h264" || stream.pix_fmt !== "yuv420p") throw new Error("输出必须为竖屏H.264/yuv420p、30FPS及指定分辨率，请检查编码配置。");
        const audioStream = info.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
        if (audioStream && audioStream.codec_name !== "aac") throw new Error("音轨编码必须为AAC。");
        if (preview) {
          const frames = [0.15, 0.5, 0.85].map((ratio, index) => ({ time: actualDuration * ratio, file: path.join(work, `preview-${index}.png`) }));
          for (const frame of frames) await runVideoCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(frame.time), "-i", rendered, "-frames:v", "1", frame.file], work, 30_000);
          await options.onPhase?.("review");
          await stage("DSH正在加载双技能审校预览关键帧与分镜");
          const audit = await auditGenerated({ appRoot, runtimeRoot, context: { draft, research: options.input }, candidate: directed, images: frames.map(frame => frame.file) });
          if (!audit.passed) throw new Error(`预览审校未通过：${audit.issues.join("；")}`);
          const reviewed = await directVideo(draft, work, appRoot, options, { result: directed, previewFrames: frames.map(frame => frame.file) });
          previewReviewed = reviewed.sceneCode === directed.sceneCode && JSON.stringify(reviewed.scenes) === JSON.stringify(directed.scenes);
          directed = reviewed;
          continue;
        }
        break;
      } catch (error) {
        if (attempt === 5) throw error;
        await options.onPhase?.("repair", attempt + 1);
        await stage(`DSH正在根据真实渲染报错修复动画（${attempt + 1}/5）`);
        directed = await directVideo(draft, work, appRoot, options, { result: directed, error: error instanceof Error ? error.message : String(error) });
        previewReviewed = false;
      }
    }
    const rendered = path.join(work, "result.mp4");
    if (!(await lstat(rendered)).isFile() || (await lstat(rendered)).isSymbolicLink()) throw new Error("视频输出必须为任务目录中的常规文件。");
    await options.onPhase?.("voice");
    await stage("正在合成配音、嵌入封面首帧并对齐字幕");
    const coverFile = options.coverFile || (draft.wechatCover ? path.join(mediaRoot, draft.wechatCover.fileName) : undefined);
    if (!coverFile) throw new Error("请先生成视频封面，再合成首帧。");
    const delivery = await voiceDelivery({ movie: rendered, cover: coverFile, scenes: directed.scenes, work, command: runVideoCommand, probe: captureVideoProbe, onStage: stage });
    await options.onPhase?.("delivery");
    await stage("DSH正在审校成片关键帧、字幕和配音时序");
    const finalFrames = [path.join(work, "final-cover.png"), path.join(work, "final-middle.png")];
    for (const [index, file] of finalFrames.entries()) await runVideoCommand("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(index ? delivery.duration * 0.5 : 0), "-i", delivery.movie, "-frames:v", "1", file], work, 30_000);
    const finalAudit = await auditGenerated({ appRoot, runtimeRoot, context: { draft, research: options.input }, candidate: { scenes: directed.scenes, subtitle: delivery.subtitle, timings: delivery.timings, duration: delivery.duration }, images: finalFrames });
    if (!finalAudit.passed) throw new DeliveryReviewError(`成片审校未通过，必须修复：${finalAudit.issues.join("；")}`);
    actualDuration = delivery.duration;
    const plan = { engine: "dsh-manim", skillRevision: manimSkillRevision, style: directed.style, thesis: directed.thesis, scenes: directed.scenes, sourceBoundaries: directed.scenes.map(scene => ({ id: scene.id, duration: scene.duration })), coverDuration: delivery.coverDuration, speech: delivery.timings, synchronization: "scene-level; word-timestamp subtitles; internal animation cues are not word-aligned", review: directed.review, qualityReview: finalAudit, duration: actualDuration, delivery: { platforms: ["微信视频号", "小红书"], aspectRatio: "9:16", width: 1080, height: 1920, container: "mp4", videoCodec: "h264", pixelFormat: "yuv420p", fps: 30, audioCodec: "aac", recommendedAudioCodec: "aac" }, audio: true };
    const srt = delivery.subtitle;
    const project = new JSZip();
    project.file("scene.py", directed.sceneCode); project.file("render_scene.py", await readFile(path.join(work, "render_scene.py")));
    project.file("cover.png", await readFile(coverFile));
    project.file("silent-source.mp4", await readFile(rendered));
    for (let index = 0; index < directed.scenes.length; index++) project.file(`voice-${index}.wav`, await readFile(path.join(work, `voice-${index}.wav`)));
    project.file("delivery-commands.json", JSON.stringify(delivery.commands, null, 2));
    project.file("render_delivery.py", "import json, os, subprocess\nfrom pathlib import Path\nos.chdir(Path(__file__).resolve().parent)\ncommands = json.loads(Path(\"delivery-commands.json\").read_text())\nclips = [\"cover-intro.mp4\"] + [f\"delivery-{i}.mp4\" for i in range(len(commands) - 2)]\nPath(\"delivery-clips.txt\").write_text(\"\\n\".join(f\"file '{clip}'\" for clip in clips))\nfor command in commands:\n    subprocess.run(command, check=True)\n");
    project.file("同步说明.txt", "scene.py是原始动画时长，使用render_scene.py渲染。silent-source.mp4为原始无声动画。plan.json的speech记录每幕原时间、最终起点及语音时长和字时间戳；配音保持自然语速，动画按幕重定时。封面首段1秒静音。安装FFmpeg后在解压目录执行python3 render_delivery.py，可使用已导出的原始视频与语音重新合成delivery.mp4，无需再次调用TTS。最终成片为配音视频，幕内关键词动作未逐词对齐；末幕配音完整播放后留至少1.2秒安静收尾。\n"); project.file("plan.json", JSON.stringify(plan, null, 2)); project.file("custom_config.yml", config.replace(JSON.stringify(path.join(work, ".cache/manim")), JSON.stringify(".cache/manim"))); project.file("subtitles.srt", srt);
    project.file("article.json", await readFile(path.join(work, "article.json"))); project.file("brand-direction.md", await readFile(path.join(work, "brand-direction.md")));
    await addSkillFiles(project, path.join(work, "skills/manimgl-best-practices"), "skills/manimgl-best-practices");
    await addSkillFiles(project, path.join(work, "editorial-skill"), "editorial-skill");
    project.file("ATTRIBUTION.txt", `ManimGL skill: adithya-s-k/manim_skill @ ${manimSkillRevision}\n3Blue1Brown / Grant Sanderson; Adithya S Kolavi\nCC BY-NC-SA 4.0; see skills/manimgl-best-practices/LICENSE.txt\nManimGL engine: MIT.\n`);
    await copyFile(delivery.movie, path.join(mediaRoot, output.fileName));
    await writeFile(path.join(mediaRoot, output.subtitleFile), srt);
    await writeFile(path.join(mediaRoot, output.planFile), JSON.stringify(plan, null, 2));
    await writeFile(path.join(mediaRoot, output.projectFile), await project.generateAsync({ type: "nodebuffer" }));
    return { ...output, audio: true, engine: "dsh-manim", style: directed.style, contextDigest: options.input ? videoContextDigest(options.input) : undefined, sourceText: videoSourceText(draft), duration: actualDuration, createdAt: new Date().toISOString() };
  } catch (error) {
    await Promise.all(Object.values(output).map(name => rm(path.join(mediaRoot, name), { force: true })));
    throw error;
  } finally { await rm(work, { recursive: true, force: true }); }
}

async function addSkillFiles(zip: JSZip, directory: string, prefix: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("技能目录不允许符号链接。");
    if (entry.isDirectory()) await addSkillFiles(zip, path.join(directory, entry.name), `${prefix}/${entry.name}`);
    else if (entry.isFile()) zip.file(`${prefix}/${entry.name}`, await readFile(path.join(directory, entry.name)));
  }
}

async function captureVideoProbe(file: string, output: string, work: string): Promise<void> {
  // ffprobe writes no user code; collect its JSON through a fixed helper process.
  await runVideoCommand(process.execPath, ["-e", 'const{execFileSync}=require("node:child_process");require("node:fs").writeFileSync(process.argv[2],execFileSync("ffprobe",["-v","error","-show_streams","-show_format","-of","json",process.argv[1]]));', file, output], work, 30_000);
}

let graphicsQueue: Promise<unknown> = Promise.resolve();
/** Serialize OpenGL work across videos and illustrations, preserving sandbox isolation. */
export function constrainedRender(binary: string, args: string[], work: string): Promise<void> {
  const run = graphicsQueue.then(() => executeConstrainedRender(binary, args, work));
  graphicsQueue = run.catch(() => {});
  return run;
}

async function executeConstrainedRender(binary: string, args: string[], work: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("生成代码渲染目前需要macOS sandbox-exec；不支持的平台停止执行，不回退为无隔离运行。");
  const realBin = await realpath(binary);
  const pythonPath = path.join(path.dirname(binary), "python");
  const python = await realpath(pythonPath);
  const pythonLink = (await lstat(pythonPath)).isSymbolicLink() ? path.resolve(path.dirname(pythonPath), await readlink(pythonPath)) : python;
  const quote = (value: string) => JSON.stringify(value);
  const policy = `(version 1)(allow default)(deny network*)(deny signal)(deny file-write*)(deny file-read* (subpath "/Users") (subpath "/private/var") (subpath "/Volumes"))(allow file-read* (subpath ${quote(work)}) (subpath ${quote(path.resolve(path.dirname(realBin), ".."))}) (subpath ${quote(path.resolve(path.dirname(python), ".."))}) (subpath ${quote(path.resolve(path.dirname(pythonLink), ".."))}) (subpath "/System/Library/Fonts") (subpath "/Library/Fonts"))(allow file-read-metadata)(allow file-write* (subpath ${quote(work)}) (literal "/dev/null"))`;
  const sandboxFile = path.join(work, "render.sb");
  await writeFile(sandboxFile, policy);
  await runVideoCommand("/usr/bin/sandbox-exec", ["-f", sandboxFile, binary, ...args], work);
}

/** Return the exact generated project, rather than a repository template. */
export async function videoBundleFiles(video: DraftVideo, mediaRoot: string) {
  if (!video.projectFile || video.engine !== "dsh-manim") throw new Error("旧字幕视频需要通过DSH重新生成后导出。");
  const [movie, subtitles, plan, project] = await Promise.all([readFile(path.join(mediaRoot, video.fileName)), readFile(path.join(mediaRoot, video.subtitleFile)), readFile(path.join(mediaRoot, video.planFile)), readFile(path.join(mediaRoot, video.projectFile))]);
  return { movie, subtitles, plan, project };
}
