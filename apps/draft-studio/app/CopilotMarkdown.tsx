"use client";

import { MarkdownText } from "@deepseek-ai/dsh-client-ui-primitives/markdown/MarkdownText";

const labels = {
  code: { copyLabel: "复制代码", copiedLabel: "已复制" },
  footnotes: "脚注",
};

/** Render Copilot replies through the same Markdown pipeline as dsh chat. */
export default function CopilotMarkdown({
  text,
  streaming = false,
  variant = "body",
}: {
  text: string;
  streaming?: boolean;
  variant?: "body" | "compact";
}) {
  return (
    <div className="copilot-markdown-dsh">
      <MarkdownText
        text={text}
        streaming={streaming}
        labels={labels}
        variant={variant}
      />
    </div>
  );
}
