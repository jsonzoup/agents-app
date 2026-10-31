import { randomUUID, createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import type { Draft } from "../lib/types";
import { channelVisuals } from "../lib/channel-visuals";
import { visualPlanSchema } from "../lib/visual-plan";
import { runHarnessResearch } from "../lib/harness";
import { constrainedRender, runVideoCommand } from "./video";
import type { VideoResearchInput } from "./video-director";
import { auditGenerated, type QualityAudit } from "./quality-review";

type Page = z.infer<typeof visualPlanSchema>["images"][number];
const resultSchema = z.object({ sceneCode: z.string().min(100).max(100_000), review: z.string().min(10).max(4000) });
let renderQueue: Promise<unknown> = Promise.resolve();

/** Detect edits made while an image batch is being generated. */
export function visualInputDigest(draft: Draft): string {
  return createHash("sha256").update(JSON.stringify([draft.channel, draft.title, draft.coverTitle, draft.body, draft.sources, draft.knowledgeContext, draft.creativeBrief, draft.visualThemeId, draft.visualStyleGuide, draft.imagePromptTemplateId])).digest("hex");
}

/** One skill-loaded design session per batch; render PNGs serially without an image API.
 * @param input - Article, evidence, grounded pages and private artifact directories.
 * @returns Ordered complete PNGs with their generated source and review for inspection.
 */
export function renderManimIllustrations(input: {
  draft: Draft; pages: Page[]; research: VideoResearchInput; style: string;
  mediaRoot: string; runtimeRoot: string; onStage: (stage: string) => Promise<void>; onPhase?: (phase: string, attempt?: number) => Promise<void>;
}): Promise<Array<{ fileName: string; sceneCode: string; review: string; qualityReview: QualityAudit }>> {
  const run = renderQueue.then(() => renderBatch(input));
  renderQueue = run.catch(() => {});
  return run;
}

async function renderBatch(input: Parameters<typeof renderManimIllustrations>[0]) {
  if (!input.pages.length) return [];
  await mkdir(input.runtimeRoot, { recursive: true, mode: 0o700 });
  await mkdir(input.mediaRoot, { recursive: true });
  const work = await realpath(await mkdtemp(path.join(input.runtimeRoot, "illustration-")));
  const appRoot = [process.cwd(), path.resolve(process.cwd(), "apps/draft-studio")].find(root => existsSync(path.join(root, "references/manimgl-video/SKILL.md"))) || process.cwd();
  const managed = path.join(input.runtimeRoot, "manimgl/bin/manimgl");
  const configured = process.env.MANIMGL_BIN || (existsSync(managed) ? managed : "manimgl");
  const binary = path.isAbsolute(configured) ? configured : (process.env.PATH || "").split(path.delimiter).map(dir => path.join(dir, configured)).find(existsSync) || configured;
  const python = path.join(path.dirname(binary), "python");
  const geometry = channelVisuals[input.draft.channel];
  const generated: string[] = [];
  try {
    await cp(path.join(appRoot, "references/upstream"), path.join(work, "skills"), { recursive: true });
    await cp(path.join(appRoot, "references/creative-method"), path.join(work, "creative-method"), { recursive: true });
    await writeFile(path.join(work, "illustration-guide.md"), await readFile(path.join(appRoot, "references/manimgl-video/references/article-illustrations.md")));
    await writeFile(path.join(work, "article.json"), JSON.stringify({ title: input.draft.title, body: input.draft.body, creativeBrief: input.draft.creativeBrief, ...input.research, pages: input.pages, style: input.style, width: geometry.width, height: geometry.height }, null, 2));
    await writeFile(path.join(work, "skill.patch.json"), JSON.stringify([{ id: "skill-filesystem", config: { customSkillDirs: [path.join(work, "skills")] } }]));
    await writeFile(path.join(work, "custom_config.yml"), `camera:\n  background_color: "#F4F1E9"\n  fps: 30\ndirectories:\n  cache: ${JSON.stringify(path.join(work, ".cache/manim"))}\n`);
    let correction = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      await input.onPhase?.(attempt ? "repair" : "create", attempt);
      await input.onStage(attempt ? `DSH正在修复Manim插画（${attempt}/2）` : "DSH正在加载Manim技能，设计整组解释性插画");
      let loaded = false;
      let methodRead = false;
      const methodCalls = new Set<string>();
      const calls = new Set<string>();
      const response = await runHarnessResearch(`你是文章插画设计师与ManimGL工程师。先调用skill工具加载manimgl-best-practices，再完整read article.json、illustration-guide.md与creative-method/SKILL.md，阅读所需上游规则。生成完整ManimGL 1.7.2 Python：from manimlib import *；每页一个Scene类DraftIllustration0、DraftIllustration1，按pages顺序。所有类最终保留完整构图。camera.frame.set_shape(14, 14*${geometry.height}/${geometry.width})。仅静态插画，不继承视频竖屏、配音、分幕、时长要求。严禁外部文件/网络/系统调用，不自行执行代码；服务端隔离渲染。图中文字必须来自pages中的title/lead/points/source/metrics或evidenceQuotes，所有数字必须来自对应证据；不要添加无依据的数据、刻度或结论。每次Text调用必须直接传字符串字面量，不遍历列表生成标签，不动态拼接或计算图中文字。不要Tex。ManimGL Text构造器color可能不生效，每个Text必须在创建后显式.set_color(颜色)，禁止仅传color参数；浅底用深墨字，深底用浅色字。准确标签、对象层级、语义细节和完整画布表达；不交文字卡缩略贴图或统一方框箭头。不要品牌名Logo水印。只返回JSON {"sceneCode":"完整源码","review":"每页解释机制、依据、丰富元素和排版检查；未目视时如实记录"}。${correction}`, event => {
        if (event.kind === "tool_call" && event.tool === "skill" && event.input?.name === "manimgl-best-practices") calls.add(event.callId);
        if (event.kind === "tool_call" && event.tool === "read" && typeof event.input?.file_path === "string" && path.resolve(work, event.input.file_path) === path.join(work, "creative-method/SKILL.md")) methodCalls.add(event.callId);
        if (event.kind === "tool_result" && methodCalls.has(event.callId) && event.status === "completed") methodRead = true;
        if (event.kind === "tool_result" && calls.has(event.callId) && event.status === "completed") loaded = true;
      }, undefined, { cwd: work, patchFiles: [path.join(appRoot, "harness/video.patch.yml"), path.join(work, "skill.patch.json")], env: { DSH_PERMISSION_MODE: "workspace-write", DSH_TOOLS_MODE: "native" } });
      if (!loaded) throw new Error("DSH未实际加载ManimGL技能，停止插画生成。");
      if (!methodRead) throw new Error("DSH未读取创作方法，停止插画生成。");
      try {
        const result = resultSchema.parse(JSON.parse(response.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")));
        await writeFile(path.join(work, "scene.py"), result.sceneCode);
        await runVideoCommand(python, [path.join(appRoot, "scripts/check_video_code.py"), path.join(work, "scene.py")], work, 15_000);
        await runVideoCommand(python, [path.join(appRoot, "scripts/check_illustration_text.py"), path.join(work, "scene.py"), path.join(work, "article.json")], work, 15_000);
        const pngs: Buffer[] = [];
        for (let index = 0; index < input.pages.length; index++) {
          const name = `page-${index}`;
          await rm(path.join(work, `${name}.png`), { force: true });
          await input.onStage(`正在渲染Manim插画（${index + 1}/${input.pages.length}）`);
          await constrainedRender(binary, [path.join(work, "scene.py"), `DraftIllustration${index}`, "-s", "-w", "--resolution", `${geometry.width}x${geometry.height}`, "--video_dir", work, "--file_name", name], work);
          const files = await readdir(work);
          if (!files.includes(`${name}.png`)) throw new Error("Manim未生成预期的PNG静帧。");
          const bytes = await readFile(path.join(work, `${name}.png`));
          const meta = await sharp(bytes).metadata();
          const stats = await sharp(bytes).stats();
          if (meta.width !== geometry.width || meta.height !== geometry.height || Math.max(...stats.channels.map(channel => channel.stdev)) < 8) throw new Error("插画画幅错误或画面近乎空白，请修复构图。");
          pngs.push(bytes);
        }
        await input.onPhase?.(attempt ? "recheck" : "review", attempt);
        await input.onStage(attempt ? `DSH正在复检修复后的Manim插画（${attempt}/2）` : "DSH正在加载双技能审校最终Manim插画");
        const qualityReview = await auditGenerated({
          appRoot, runtimeRoot: input.runtimeRoot,
          context: { draft: input.draft, research: input.research, pages: input.pages, style: input.style },
          candidate: { sceneCode: result.sceneCode, review: result.review },
          images: input.pages.map((_, index) => path.join(work, `page-${index}.png`)),
        });
        if (!qualityReview.passed) throw new Error(`Manim插画审校未通过：${qualityReview.issues.join("；")}`);
        const output = [];
        for (const bytes of pngs) {
          const fileName = `${input.draft.id}-${randomUUID()}.png`;
          await writeFile(path.join(input.mediaRoot, fileName), bytes, { flag: "wx", mode: 0o600 });
          generated.push(fileName);
          output.push({ fileName, sceneCode: result.sceneCode, review: result.review, qualityReview });
        }
        return output;
      } catch (error) {
        await Promise.all(generated.splice(0).map(name => rm(path.join(input.mediaRoot, name), { force: true })));
        if (attempt === 2) throw error;
        correction = `\n上轮代码：${response}\n真实校验/渲染错误：${error instanceof Error ? error.message : String(error)}。修复后返回完整JSON，重新加载skill。`;
      }
    }
    throw new Error("Manim插画未完成。");
  } catch (error) {
    await Promise.all(generated.map(name => rm(path.join(input.mediaRoot, name), { force: true })));
    throw error;
  } finally { await rm(work, { recursive: true, force: true }); }
}
