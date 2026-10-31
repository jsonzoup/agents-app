"use client";

import { useState } from "react";
import { Brain, Check, CircleAlert, Copy, LoaderCircle, RotateCcw, Wrench } from "lucide-react";
import { DisclosureRow } from "../../adapters/dsh-ui/src/DisclosureRow.tsx";
import { TextShimmer } from "../../adapters/dsh-ui/src/TextShimmer.tsx";
import type { CopilotMessage, CopilotToolEvent } from "@/lib/types";
import CopilotMarkdown from "./CopilotMarkdown";

const toolTitles: Record<CopilotToolEvent["action"], string> = {
  get_context: "读取文章上下文",
  research_article: "检索与研究文章论据",
  replace_title: "修改文章标题",
  replace_body: "修改文章正文",
  regenerate_visuals: "重新生成配图",
};

/** A settled message cannot leave its tool indicators animating indefinitely. */
export function copilotToolState(messageStatus: CopilotMessage["status"], toolStatus: CopilotToolEvent["status"]): CopilotToolEvent["status"] {
  return toolStatus === "运行中" && messageStatus !== "运行中" ? "失败" : toolStatus;
}

function ToolEventView({ event, messageStatus }: { event: CopilotToolEvent; messageStatus: CopilotMessage["status"] }) {
  const [open, setOpen] = useState(false);
  const status = copilotToolState(messageStatus, event.status);
  const running = status === "运行中";
  const detail = event.detail || (status === "失败" ? "这次工具执行没有完成，请查看下方回复。" : running ? "工具正在执行，结果将自动更新。" : "工具已完成。");
  return (
    <div className="copilot-dsh-tool" data-state={status}>
      <DisclosureRow
        icon={running ? <LoaderCircle className="spin" size={14} /> : status === "失败" ? <CircleAlert size={14} /> : <Check size={14} />}
        title={toolTitles[event.action]}
        open={open}
        expandable
        expandOnRowClick
        running={running}
        onToggle={() => setOpen(!open)}
        collapsedContent={<><span className="copilot-dsh-separator">·</span><span className="copilot-dsh-summary">{detail}</span><span className="copilot-dsh-status">{status}</span></>}
      >
        <div className="copilot-dsh-tool-detail">
          <dl><dt>工具</dt><dd>{event.action}</dd><dt>状态</dt><dd>{status}</dd></dl>
          <p>{detail}</p>
        </div>
      </DisclosureRow>
    </div>
  );
}

/** One article's retained conversation message, using dsh flow rows and Markdown. */
export default function CopilotMessageView({ message, onResend }: { message: CopilotMessage; onResend?: () => void }) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const assistant = message.role === "assistant";
  const running = assistant && message.status === "运行中";
  const reasoning = (message as CopilotMessage & { reasoning?: string }).reasoning || "";
  const hasTools = Boolean(message.toolEvents?.length);
  const hasText = Boolean(message.text.trim()) && message.text !== "正在理解当前草稿并准备这次修改…";
  const targetLabel = { auto: "自动", title: "标题", body: "正文", image: "图片" }[message.target];
  const copy = async () => {
    await navigator.clipboard.writeText(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <article className={`copilot-message ${message.role} ${message.status} copilot-dsh-message`} aria-label={`${assistant ? "Copilot" : "你"}的${targetLabel}修改消息`} data-message-status={message.status}>
      <header><b>{assistant ? "Copilot" : "你"}</b><span>{targetLabel}</span>{assistant && message.status === "失败" && <i>未完成</i>}</header>
      {message.mentions.length > 0 && <div className="copilot-message-mentions">{message.mentions.map(mention => <span key={mention.id}>@{mention.label}</span>)}</div>}
      {assistant && reasoning && (
        <div className="copilot-dsh-reasoning">
          <DisclosureRow icon={<Brain size={14} />} title={running && !hasTools && !hasText ? "正在思考" : "思考过程"} open={reasoningOpen} expandable expandOnRowClick running={running && !hasTools && !hasText} onToggle={() => setReasoningOpen(!reasoningOpen)} collapsedContent={<><span className="copilot-dsh-separator">·</span><span className="copilot-dsh-summary">{reasoning.split("\n").filter(Boolean).at(-1)?.replaceAll("**", "")}</span></>}>
            <div className="copilot-dsh-reasoning-body"><CopilotMarkdown text={reasoning} streaming={running} variant="compact" /></div>
          </DisclosureRow>
        </div>
      )}
      {assistant && hasTools && <div className="copilot-dsh-tools" aria-label="工具调用过程">{message.toolEvents?.map(event => <ToolEventView key={event.id} event={event} messageStatus={message.status} />)}</div>}
      {running && !hasTools && !reasoning && !hasText && <div className="copilot-dsh-waiting" role="status"><Brain size={14} /><TextShimmer active>正在分析文章与修改要求</TextShimmer></div>}
      {hasText && (assistant ? <CopilotMarkdown text={message.text} streaming={running} /> : <div className="copilot-user-text">{message.text}</div>)}
      {running && hasTools && !hasText && message.toolEvents?.every(event => event.status !== "运行中") && <div className="copilot-dsh-waiting" role="status"><Wrench size={14} /><TextShimmer active>正在继续处理</TextShimmer></div>}
      {!running && <footer className="copilot-message-actions"><button type="button" className="copilot-icon-action" title={copied ? "已复制" : "复制消息"} aria-label={copied ? "已复制" : "复制消息"} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>{onResend && <button type="button" className="copilot-icon-action" title="重新发送" aria-label="重新发送" onClick={onResend}><RotateCcw size={14} /></button>}</footer>}
    </article>
  );
}
