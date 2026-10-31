"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Code2, Download, Eye, FileQuestion } from "lucide-react";
import { Loading } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fileKind, formatBytes, languageOf, PREVIEWABLE, type FileKind } from "@/lib/files";

const CodeEditor = dynamic(() => import("./code-editor").then((m) => m.CodeEditor), { ssr: false, loading: () => <Loading /> });
const SheetPreview = dynamic(() => import("./office").then((m) => m.SheetPreview), { ssr: false, loading: () => <Loading /> });
const DocxPreview = dynamic(() => import("./office").then((m) => m.DocxPreview), { ssr: false, loading: () => <Loading /> });
const PptxPreview = dynamic(() => import("./office").then((m) => m.PptxPreview), { ssr: false, loading: () => <Loading /> });

/** Kinds with both a rendered view and the source. */
const DUAL: FileKind[] = ["markdown", "csv"];
const DUAL_HTML = (path: string) => /\.html?$/i.test(path);

export interface FileViewerProps {
  path: string;
  /** Where the raw bytes are (previews, downloads). */
  url: string;
  /** The file as text, null for binary; when omitted the viewer reads it from `url` if it needs text. */
  text?: string | null;
  size?: number | null;
  /** Edit the source; the viewer switches to the editor. */
  editing?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  /** Extra controls in the viewer's toolbar. */
  toolbar?: ReactNode;
  /** Keeps editor models of different versions apart. */
  scope?: string;
}

function splitFrontmatter(text: string): { meta: [string, string][]; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: [], body: text };
  const meta = m[1].split("\n").flatMap((line) => {
    const i = line.indexOf(":");
    return i > 0 ? [[line.slice(0, i).trim(), line.slice(i + 1).trim()] as [string, string]] : [];
  });
  return { meta, body: text.slice(m[0].length) };
}

export function MarkdownView({ text }: { text: string }) {
  const { meta, body } = splitFrontmatter(text);
  return (
    <div className="md-preview mx-auto max-w-4xl px-6 py-5">
      {meta.length > 0 && (
        <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-xs leading-6 text-muted-foreground">{k}</dt>
              <dd className="leading-6">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
    </div>
  );
}

const MAX_FETCHED_TEXT = 5 * 1024 * 1024;

/** The file as text when the caller only has its URL; null when it is not text. */
function useFetchedText(url: string, wanted: boolean): string | null | undefined {
  const [state, setState] = useState<{ url: string; text: string | null } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_FETCHED_TEXT) return null;
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
          return null;
        }
      })
      .catch(() => null)
      .then((t) => live && setState({ url, text: t }));
    return () => {
      live = false;
    };
  }, [url, wanted]);
  return state?.url === url ? state.text : undefined;
}

export function FileViewer({ path, url, text: given, size, editing, value, onChange, toolbar, scope }: FileViewerProps) {
  const guess = fileKind(path);
  const fetched = useFetchedText(url, given === undefined && !PREVIEWABLE.includes(guess));
  const text = given !== undefined ? given : fetched;
  const kind = fileKind(path, text === undefined ? undefined : text !== null);
  const dual = DUAL.includes(kind) || (kind === "code" && DUAL_HTML(path));
  const [mode, setMode] = useState<"preview" | "source">("preview");
  useEffect(() => setMode("preview"), [path]);
  const showSource = editing || !dual || mode === "source";
  const download = `${url}${url.includes("?") ? "&" : "?"}download=1`;

  let body: ReactNode;
  if (editing) {
    body = <CodeEditor path={path} value={value ?? ""} onChange={onChange} scope={`edit-${scope ?? ""}`} />;
  } else if (kind === "image") {
    body = (
      <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={path} className="max-h-full max-w-full object-contain shadow-sm" />
      </div>
    );
  } else if (kind === "video") {
    body = (
      <div className="flex h-full items-center justify-center bg-black/90 p-4">
        <video src={url} controls className="max-h-full max-w-full" />
      </div>
    );
  } else if (kind === "audio") {
    body = (
      <div className="flex h-full items-center justify-center p-6">
        <audio src={url} controls className="w-full max-w-xl" />
      </div>
    );
  } else if (kind === "pdf") {
    body = <iframe src={url} title={path} className="h-full w-full border-0" />;
  } else if (kind === "sheet" || (kind === "csv" && !showSource)) {
    body = <SheetPreview url={url} />;
  } else if (kind === "docx") {
    body = <DocxPreview url={url} />;
  } else if (kind === "pptx") {
    body = <PptxPreview url={url} />;
  } else if (text === undefined) {
    body = <Loading />;
  } else if (text === null) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
        <FileQuestion className="size-10 opacity-40" />
        <p>这种文件不能在浏览器里预览{size ? `（${formatBytes(size)}）` : ""}。</p>
        <Button asChild size="sm" variant="outline">
          <a href={download}>
            <Download /> 下载
          </a>
        </Button>
      </div>
    );
  } else if (kind === "markdown" && !showSource) {
    body = (
      <div className="h-full overflow-auto">
        <MarkdownView text={text} />
      </div>
    );
  } else if (DUAL_HTML(path) && !showSource) {
    body = <iframe sandbox="" srcDoc={text} title={path} className="h-full w-full border-0 bg-white" />;
  } else {
    body = <CodeEditor path={path} value={text} readOnly scope={scope} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-2 py-1">
        {dual && !editing && (
          <ToggleGroup type="single" size="sm" value={mode} onValueChange={(v) => v && setMode(v as "preview" | "source")} className="h-7">
            <ToggleGroupItem value="preview" className="h-7 gap-1 px-2 text-xs">
              <Eye className="size-3.5" /> {kind === "csv" ? "表格" : "预览"}
            </ToggleGroupItem>
            <ToggleGroupItem value="source" className="h-7 gap-1 px-2 text-xs">
              <Code2 className="size-3.5" /> 源码
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <span className="text-xs text-muted-foreground">{kind === "code" ? LANGUAGE_LABEL[languageOf(path)] ?? "文本" : KIND_LABEL[kind]}{size ? ` · ${formatBytes(size)}` : ""}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {toolbar}
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <a href={download} title="下载">
              <Download className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}

const LANGUAGE_LABEL: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  json: "JSON",
  python: "Python",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  html: "HTML",
  xml: "XML",
  yaml: "YAML",
  shell: "Shell",
  sql: "SQL",
  dockerfile: "Dockerfile",
  ini: "配置",
  plaintext: "文本",
};

const KIND_LABEL: Record<FileKind, string> = {
  markdown: "Markdown",
  code: "文本 / 代码",
  csv: "CSV 表格",
  sheet: "电子表格",
  docx: "Word 文档",
  pptx: "演示文稿",
  pdf: "PDF",
  image: "图片",
  video: "视频",
  audio: "音频",
  binary: "二进制文件",
};
