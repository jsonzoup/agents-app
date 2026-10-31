/** DSH 模型选择：`provider/model`，和 Harness 模型目录同一写法。默认走已配置密钥的 Azure。 */
export const DEFAULT_MODEL = "azure-openai-responses/gpt-6.1-sol";

const LEGACY_FLASH = new Set([
  "deepseek-v4-flash",
  "deepseek-official/deepseek-v4-flash",
]);

export function modelSelection(model?: string): string {
  const raw = model?.trim();
  if (!raw || LEGACY_FLASH.has(raw)) return DEFAULT_MODEL;
  if (raw.includes("/")) return raw;
  if (raw.startsWith("deepseek-")) return `deepseek-official/${raw}`;
  if (/^(gpt-|o\d)/.test(raw)) return `azure-openai-responses/${raw}`;
  return raw;
}

export function parseModelSelection(model?: string): { provider: string; model: string } {
  const selection = modelSelection(model);
  const slash = selection.indexOf("/");
  if (slash <= 0) return { provider: "deepseek-official", model: selection };
  return { provider: selection.slice(0, slash), model: selection.slice(slash + 1) };
}
