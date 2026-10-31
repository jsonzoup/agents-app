"use client";

import Editor, { DiffEditor, loader, type Monaco } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { Loading } from "@/components/shell/page";
import { languageOf } from "@/lib/files";

loader.config({ paths: { vs: "/monaco/vs" } });

/** JSON schemas for the files every app has, so editing them autocompletes and flags mistakes. */
const SCHEMAS = [
  {
    uri: "rsi://schemas/app.json",
    fileMatch: ["**/app.json"],
    schema: {
      type: "object",
      required: ["kind", "name", "title", "task", "agent", "evolve", "evals", "judge"],
      properties: {
        kind: { const: "App" },
        name: { type: "string", pattern: "^[a-z][a-z0-9-]*$", description: "应用标识：小写字母、数字、连字符" },
        title: { type: "string", description: "给人看的名称" },
        version: { type: "string" },
        description: { type: "string" },
        task: {
          type: "object",
          properties: { input: { type: "string", description: "输入的 JSON Schema 文件" }, output: { type: "string", description: "输出的 JSON Schema 文件" }, statuses: { type: "array", items: { type: "string" } } },
        },
        agent: {
          type: "object",
          properties: { instructions: { type: "string" }, skills: { type: "array", items: { type: "string" } }, entry: { type: "string" }, mcp: { type: "string" } },
        },
        scopes: {
          type: "array",
          items: { type: "object", required: ["key", "title", "from"], properties: { key: { type: "string" }, title: { type: "string" }, from: { type: "string", description: "从输入里取值的路径，如 input.customer.code" } } },
        },
        evolve: {
          type: "object",
          description: "哪些文件可以进化：knowledge 知识级，code 代码级；其余都是契约，只有人改",
          properties: { knowledge: { type: "array", items: { type: "string" } }, code: { type: "array", items: { type: "string" } } },
        },
        evals: {
          type: "object",
          properties: { cases: { type: "string" }, holdout: { type: "array", items: { type: "string" }, description: "留出集用例编号" } },
        },
        judge: { type: "object", properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } } } },
        web: { type: "string", description: "应用自己的 web 应用目录（全栈 Next.js 项目，带自己的 .env），如 web" },
        actions: { type: "object" },
      },
    },
  },
  {
    uri: "rsi://schemas/case.json",
    fileMatch: ["**/case.json"],
    schema: {
      type: "object",
      required: ["id", "title", "input", "expected"],
      properties: {
        id: { type: "string", description: "用例编号，和目录名一致" },
        title: { type: "string", description: "一句话说清这个用例在测什么" },
        input: { description: "交给应用的输入，和应用输入契约一致" },
        expected: { description: "期望结果，按裁判要求的格式" },
        split: { enum: ["dev", "holdout"], description: "dev 开发集（提案可以看）；holdout 留出集（只用来把关）" },
        scope: { type: "object", description: "范围值，如 { \"customer\": \"…\" }" },
        source: { type: "string", description: "样本从哪里来" },
      },
    },
  },
];

let configured = false;

/** Language services: TypeScript/JavaScript with React and the app SDK, JSON schemas, Markdown snippets. */
async function configure(monaco: Monaco) {
  if (configured) return;
  configured = true;
  const m = monaco as unknown as Record<string, any>;
  const tsNs = m.typescript ?? m.languages.typescript;
  const jsonNs = m.json ?? m.languages.json;
  const options = {
    target: tsNs.ScriptTarget.ESNext,
    module: tsNs.ModuleKind.ESNext,
    moduleResolution: tsNs.ModuleResolutionKind.NodeJs,
    jsx: tsNs.JsxEmit.ReactJSX,
    allowJs: true,
    allowNonTsExtensions: true,
    esModuleInterop: true,
    strict: true,
  };
  for (const d of [tsNs.typescriptDefaults, tsNs.javascriptDefaults]) {
    d.setCompilerOptions(options);
    // the editor sees one file at a time; cross-file errors would be noise
    d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
    d.setEagerModelSync(true);
  }
  jsonNs.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: false, enableSchemaRequest: false, schemas: SCHEMAS });
  const libs: [string, string][] = [
    ["/monaco/types/sdk.d.ts", "file:///types/sdk.d.ts"],
    ["/monaco/types/kit.d.ts", "file:///types/kit.d.ts"],
    ["/monaco/types/react/index.d.ts", "file:///node_modules/@types/react/index.d.ts"],
    ["/monaco/types/react/global.d.ts", "file:///node_modules/@types/react/global.d.ts"],
    ["/monaco/types/react/jsx-runtime.d.ts", "file:///node_modules/@types/react/jsx-runtime.d.ts"],
    ["/monaco/types/csstype/index.d.ts", "file:///node_modules/csstype/index.d.ts"],
  ];
  await Promise.all(
    libs.map(async ([url, path]) => {
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) return;
      const text = await res.text();
      tsNs.typescriptDefaults.addExtraLib(text, path);
      tsNs.javascriptDefaults.addExtraLib(text, path);
    }),
  );
  monaco.languages.registerCompletionItemProvider("markdown", {
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const snippet = (label: string, insertText: string, documentation: string) => ({
        label,
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        documentation,
        range,
      });
      return {
        suggestions: [
          snippet("frontmatter", "---\nname: ${1:skill-name}\ndescription: ${2:什么时候用这个技能}\n---\n\n$0", "技能文件开头的元数据"),
          snippet("rule", "## ${1:规则名称}\n\n- 什么时候：${2}\n- 怎么做：${3}\n- 例子：${4}\n", "一条业务规则"),
          snippet("table", "| ${1:列} | ${2:列} |\n| --- | --- |\n| ${3} | ${4} |\n", "Markdown 表格"),
          snippet("code", "```${1:json}\n$0\n```", "代码块"),
        ],
      };
    },
  });
}

export interface CodeEditorProps {
  /** Path inside the package; decides the language and which schema applies. */
  path: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  /** Distinguishes editors of the same path (e.g. two versions). */
  scope?: string;
  className?: string;
}

export function CodeEditor({ path, value, onChange, readOnly, scope = "view", className }: CodeEditorProps) {
  const { resolvedTheme } = useTheme();
  return (
    <div className={className ?? "h-full min-h-0"}>
      <Editor
        path={`file:///${scope}/${path}`}
        language={languageOf(path)}
        value={value}
        onChange={(v) => onChange?.(v ?? "")}
        beforeMount={configure}
        theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
        loading={<Loading />}
        options={{
          readOnly,
          domReadOnly: readOnly,
          minimap: { enabled: false },
          fontSize: 12.5,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          wordWrap: path.endsWith(".md") || path.endsWith(".txt") ? "on" : "off",
          automaticLayout: true,
          tabSize: 2,
          renderWhitespace: "selection",
          quickSuggestions: readOnly ? false : { other: true, comments: false, strings: true },
          suggest: { showWords: true },
          padding: { top: 8 },
          fixedOverflowWidgets: true,
        }}
      />
    </div>
  );
}

export function CodeDiff({ path, before, after, className }: { path: string; before: string; after: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className={className ?? "h-full min-h-0"}>
      <DiffEditor
        original={before}
        modified={after}
        language={languageOf(path)}
        beforeMount={configure}
        theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
        loading={<Loading />}
        options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12.5, renderSideBySide: true, automaticLayout: true, scrollBeyondLastLine: false, wordWrap: path.endsWith(".md") ? "on" : "off" }}
      />
    </div>
  );
}
