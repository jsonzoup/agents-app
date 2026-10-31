import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runtimeRoot = path.resolve(process.env.DSH_RUNTIME_ROOT || path.join(workspaceRoot, "deepseek-harness"));
const { defineTool } = await import(pathToFileURL(path.join(runtimeRoot, "packages/core/tools/lib/index.js")).href);

export const name = "draft-studio-copilot-tools";
export const inject = ["tools"];

const endpoint = process.env.DRAFT_STUDIO_COPILOT_TOOL_ENDPOINT?.trim() ?? "";
const draftId = process.env.DRAFT_STUDIO_COPILOT_DRAFT_ID?.trim() ?? "";
const sessionToken = process.env.DRAFT_STUDIO_COPILOT_SESSION_TOKEN?.trim() ?? "";
const toolSecret = process.env.DRAFT_STUDIO_COPILOT_TOOL_SECRET?.trim() ?? "";

async function invokeTool(action, argumentsValue, signal) {
  if (!endpoint || !draftId || !sessionToken || !toolSecret)
    throw new Error("Draft Studio Copilot tool bridge is not configured.");
  const url = new URL(endpoint);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Origin: url.origin,
      "Content-Type": "application/json",
      "X-Draft-Studio-Token": sessionToken,
      "X-Draft-Studio-Copilot-Tool": toolSecret,
    },
    body: JSON.stringify({ draftId, action, arguments: argumentsValue }),
    signal,
    redirect: "error",
  });
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Draft Studio Copilot tool returned invalid JSON (HTTP ${response.status}).`,
    );
  }
  if (!response.ok)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : `Draft Studio Copilot tool failed (HTTP ${response.status}).`,
    );
  return JSON.stringify(result, null, 2);
}

const output = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

export function apply(ctx) {
  // The headless JSON projection only emits committed assistant messages. Copilot
  // also receives transient assistant-stream frames so its UI can render thinking
  // and answer text while the model is still running.
  if (process.env.DRAFT_STUDIO_COPILOT_STREAM === "1") {
    ctx.on("agent/assistant-stream", ({ frame }) => {
      if (frame.type === "start") {
        process.stdout.write(`${JSON.stringify({ type: "stream", kind: "start" })}\n`);
        return;
      }
      if (frame.type === "end") {
        process.stdout.write(`${JSON.stringify({ type: "stream", kind: "end", status: frame.outcome.kind })}\n`);
        return;
      }
      const chunk = frame.chunk;
      if (chunk.type === "reasoning-delta" || chunk.type === "text-delta") {
        if (chunk.text)
          process.stdout.write(`${JSON.stringify({ type: "stream", kind: chunk.type === "text-delta" ? "text" : "reasoning", text: chunk.text })}\n`);
      }
    });
  }
  if (process.env.DRAFT_STUDIO_COPILOT_DEBUG === "1")
    console.error(
      "[draft-studio-copilot-tools] registering tools",
      Boolean(endpoint),
      Boolean(draftId),
    );
  ctx.tools.register(
    defineTool({
      name: "draft_studio_get_draft_context",
      description:
        "Return the complete current article draft context, including both channel variants, sources, creative brief, generated images, prompts, and placements.",
      parameters: {},
      output,
      execute: (_args, execution) =>
        invokeTool("get_context", {}, execution.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: "draft_studio_research_article",
      description: "Research the current article using knowledge retrieval, web search and fetched original documents. Required before adding facts, developing new analysis or substantially rewriting the body. Read the returned evidence and assess source dependencies before writing; stop if research fails.",
      parameters: {
        question: { type: "string", required: true, description: "Specific questions, disputed claims, mechanisms and counterevidence to investigate for this edit." },
      },
      output,
      execute: (args, execution) => invokeTool("research_article", args, execution.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: "draft_studio_replace_title",
      description:
        "Replace the current article title and, when requested, its cover title. This changes the article immediately.",
      parameters: {
        title: {
          type: "string",
          required: true,
          description: "Complete replacement article title.",
        },
        coverTitle: {
          type: "string",
          description: "Optional replacement cover title.",
        },
      },
      output,
      execute: (args, execution) =>
        invokeTool("replace_title", args, execution.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: "draft_studio_replace_body",
      description:
        "Replace the current article body with the complete edited body. Facts and citations must be preserved.",
      parameters: {
        body: {
          type: "string",
          required: true,
          description: "Complete replacement article body.",
        },
      },
      output,
      execute: (args, execution) =>
        invokeTool("replace_body", args, execution.signal),
    }),
  );
  ctx.tools.register(
    defineTool({
      name: "draft_studio_regenerate_visuals",
      description:
        "Update the article visual brief and regenerate all body images and the WeChat cover using referenced generated assets.",
      parameters: {
        visualBrief: {
          type: "string",
          required: true,
          description:
            "Complete visual brief describing what to preserve, what to change, and the referenced asset ids.",
        },
        referencedAssetIds: {
          type: "array",
          items: { type: "string" },
          description: "Generated image or WeChat cover ids to use as references.",
        },
      },
      output,
      execute: (args, execution) =>
        invokeTool("regenerate_visuals", args, execution.signal),
    }),
  );
}
