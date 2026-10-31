import { useState } from "react";
import { blankCopilotSession, updateCopilotSession, type CopilotSession } from "@/lib/copilot-session";

export function useArticleCopilot(draftId: string) {
  const [sessions, setSessions] = useState<Record<string, CopilotSession>>({});
  const session = sessions[draftId] ?? blankCopilotSession();
  function setter<K extends keyof CopilotSession>(field: K) {
    return (value: CopilotSession[K] | ((current: CopilotSession[K]) => CopilotSession[K])) =>
      setSessions((current) => updateCopilotSession(current, draftId, field, value));
  }
  return {
    copilotTarget: session.target, setCopilotTarget: setter("target"),
    copilotInput: session.input, setCopilotInput: setter("input"),
    copilotMentions: session.mentions, setCopilotMentions: setter("mentions"),
    copilotMentionOpen: session.mentionOpen, setCopilotMentionOpen: setter("mentionOpen"),
    copilotOpen: session.open, setCopilotOpen: setter("open"),
    copilotSubmitting: session.submitting, setCopilotSubmitting: setter("submitting"),
  };
}
