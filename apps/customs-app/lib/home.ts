import { existsSync } from "node:fs";
import path from "node:path";

/** 报关灵的 DSH home。技能在 `<home>/skills`，会话也落在这个目录。可用 CUSTOMS_HOME 覆盖。 */
export function customsHome(): string {
  const configured = process.env.CUSTOMS_HOME?.trim();
  if (configured) return path.resolve(configured);
  const candidate = path.resolve(process.cwd(), "..", "..", "..", "customs-home");
  if (existsSync(candidate)) return candidate;
  return candidate;
}

export function skillsDir(): string {
  return path.join(customsHome(), "skills");
}

export function skillRoot(): string {
  return path.join(skillsDir(), "customs-extraction");
}
