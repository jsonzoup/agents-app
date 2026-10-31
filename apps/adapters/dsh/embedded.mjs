/**
 * 进程内对象级 DSH 运行时：单 runtime 多会话，不启子进程。
 * createRuntime() 装配 cordis 插件树；createConversation() 复用 ctx.agents 创建独立 agent。
 */
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = path.resolve(process.env.DSH_RUNTIME_ROOT || path.resolve(here, "../../../deepseek-harness"));
const requireCli = createRequire(path.join(checkout, "apps/cli/package.json"));
const requireServer = createRequire(path.join(checkout, "packages/sdk/server/package.json"));
const { loadLayeredEnv } = await import(pathToFileURL(requireCli.resolve("@deepseek-ai/dsh-app-boot")).href);
const { runProfile } = await import(pathToFileURL(path.join(checkout, "apps/cli/lib/profile-boot.js")).href);
const { createUserMessage } = await import(pathToFileURL(requireServer.resolve("@deepseek-ai/dsh-llm")).href);

async function overlay(persona, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "dsh-embedded-"));
  const file = path.join(dir, "embedded.yml");
  const lines = ["- id: sdk-jsonrpc-server", "  disabled: true"];
  if (persona) {
    lines.push("- id: system-prompt", "  config:", `    personaPrefix: ${JSON.stringify(persona)}`);
  }
  if (options.dshHome || options.skillDirs?.length) {
    lines.push("- id: skill-filesystem", "  config:");
    if (options.dshHome) lines.push(`    dshHome: ${JSON.stringify(options.dshHome)}`);
    if (options.skillDirs?.length) {
      lines.push("    customSkillDirs:");
      for (const skillDir of options.skillDirs) lines.push(`      - ${JSON.stringify(skillDir)}`);
    }
  }
  if (options.mcpServers?.length) {
    lines.push("- insert:");
    for (const [index, server] of options.mcpServers.entries()) {
      lines.push(`    - id: mcp-embedded-${index}`, "      name: '@deepseek-ai/dsh-mcp-client'", "      config:");
      lines.push(`        serverName: ${JSON.stringify(server.serverName)}`);
      lines.push("        transport: streamable-http");
      lines.push(`        url: ${JSON.stringify(server.url)}`);
    }
  }
  await writeFile(file, `${lines.join("\n")}\n`);
  return file;
}

export async function createRuntime(options = {}) {
  const provider = options.provider || "deepseek-official";
  const model = options.model || "deepseek-flash";
  const patchFiles = [await overlay(options.persona, options), ...(options.patchFiles || [])];
  const { ctx, shutdown } = await runProfile({
    environment: loadLayeredEnv("dsh"),
    profile: options.profile || "sdk",
    patchFiles,
    args: [],
  });
  const llm = ctx.get("llm");
  if (!llm.listProviders().some((entry) => entry.id === provider)) {
    await ctx.plugin(await import(pathToFileURL(requireServer.resolve("@deepseek-ai/dsh-llm-deepseek")).href));
  }
  await llm.resolveCallConfig({ provider, model });
  const wireConversation = (sessionId, handle, listeners, id, route) => {
    const offEvent = ctx.on("session/event", (session, event) => {
      if (String(session.id) !== String(sessionId)) return;
      for (const listener of listeners) listener({ type: "event", event });
    });
    const offStatus = ctx.on("agent/status", ({ agent, status }) => {
      if (String(agent.session.id) !== String(sessionId)) return;
      for (const listener of listeners) listener({ type: "status", status });
    });
    const conversation = {
      id: id || sessionId,
      sessionId,
      provider: route.provider,
      model: route.model,
      on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async prompt(text) {
        handle.agent.followup(createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } }));
      },
      async abort() {
        offEvent(); offStatus();
        runtime.conversations.delete(conversation.id);
        await handle.dispose();
      },
      async close() {
        offEvent(); offStatus();
        runtime.conversations.delete(conversation.id);
        await handle.dispose();
      },
    };
    runtime.conversations.set(conversation.id, conversation);
    return conversation;
  };

  const runtime = {
    ctx,
    provider,
    model,
    conversations: new Map(),
    async resumeConversation(opts = {}) {
      const sessionId = opts.sessionId;
      if (!sessionId) throw new Error("resumeConversation needs sessionId");
      const nextProvider = opts.provider || provider;
      const nextModel = opts.model || model;
      for (const existing of [...runtime.conversations.values()]) {
        if (existing.sessionId !== String(sessionId)) continue;
        if (existing.provider === nextProvider && existing.model === nextModel) return existing;
        await existing.close().catch(() => undefined);
      }
      const listeners = new Set();
      const handle = await ctx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions: { provider: nextProvider, model: nextModel },
      });
      return wireConversation(String(sessionId), handle, listeners, undefined, { provider: nextProvider, model: nextModel });
    },
    async createConversation(opts = {}) {
      const sessionId = opts.sessionId || `session-${opts.id || Date.now()}`;
      const nextProvider = opts.provider || provider;
      const nextModel = opts.model || model;
      const listeners = new Set();
      const handle = await ctx.agents.create({
        sessionId,
        meta: { cwd: opts.cwd || options.cwd || process.cwd() },
        agentOptions: { provider: nextProvider, model: nextModel },
      });
      const conversation = wireConversation(String(sessionId), handle, listeners, opts.id, { provider: nextProvider, model: nextModel });
      runtime.conversations.set(conversation.id, conversation);
      return conversation;
    },
    async close() {
      for (const conversation of runtime.conversations.values()) await conversation.close().catch(() => undefined);
      runtime.conversations.clear();
      await ctx.root.fiber.dispose();
    },
  };
  return runtime;
}
