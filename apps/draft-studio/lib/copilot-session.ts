import type { CopilotTarget, Draft } from "./types";

export type CopilotSession = {
  target: CopilotTarget;
  input: string;
  mentions: string[];
  mentionOpen: boolean;
  open: boolean;
  submitting: boolean;
};

export function blankCopilotSession(): CopilotSession {
  return { target: "auto", input: "", mentions: [], mentionOpen: false, open: false, submitting: false };
}

export function updateCopilotSession<K extends keyof CopilotSession>(
  sessions: Record<string, CopilotSession>,
  draftId: string,
  field: K,
  value: CopilotSession[K] | ((current: CopilotSession[K]) => CopilotSession[K]),
): Record<string, CopilotSession> {
  if (!draftId) return sessions;
  const session = sessions[draftId] ?? blankCopilotSession();
  return {
    ...sessions,
    [draftId]: { ...session, [field]: typeof value === "function" ? value(session[field]) : value },
  };
}

// A late response belongs to its article, never to the article opened meanwhile.
export function applyCopilotResponse<T extends { id: string }>(current: T | null, response: T): T | null {
  return current?.id === response.id ? response : current;
}

/**
 * Compare persisted Copilot messages and tool events across workspace polls.
 * @param left - Current transcript.
 * @param right - Transcript returned by the latest workspace poll.
 * @returns True when both serialized transcripts match.
 */
export function sameCopilotMessages<T>(left: readonly T[], right: readonly T[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Merge one article's live Copilot transcript without replacing local draft edits.
 * @param current - Draft currently open in the editor.
 * @param response - Article identity and transcript returned by polling.
 * @returns Updated draft, or the original value when the article or transcript did not change.
 */
export function applyCopilotMessages<T extends { id: string; copilotMessages: unknown[] }>(
  current: T | null,
  response: Pick<T, "id" | "copilotMessages">,
): T | null {
  if (current?.id !== response.id) return current;
  if (sameCopilotMessages(current.copilotMessages, response.copilotMessages)) return current;
  return { ...current, copilotMessages: response.copilotMessages };
}

export async function submitCopilotRequest(
  draft: Draft,
  saveFirst: boolean,
  request: { message: string; target: CopilotTarget; mentions: string[] },
  call: (path: string, method: string, body: object) => Promise<{ draft: Draft }>,
  receive: (draft: Draft) => void,
): Promise<void> {
  if (saveFirst) {
    const saved = await call(`/drafts/${draft.id}`, "PUT", draft);
    receive(saved.draft);
  }
  const result = await call(`/drafts/${draft.id}/copilot`, "POST", request);
  receive(result.draft);
}
