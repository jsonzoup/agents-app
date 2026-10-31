"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { BenchFiles } from "@/components/bench/files";
import { BenchRules } from "@/components/bench/rules";
import { Cases } from "@/components/bench/cases";
import { Results } from "@/components/bench/results";
import { PageHeader } from "@/components/shell/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApp } from "@/lib/session";

const TABS = [
  { key: "results", label: "结果" },
  { key: "cases", label: "用例" },
  { key: "files", label: "文件" },
  { key: "rules", label: "规则说明" },
];

export default function EvalsPage() {
  const { app } = useApp();
  const router = useRouter();
  const search = useSearchParams();
  const tab = TABS.some((t) => t.key === search.get("tab")) ? search.get("tab")! : "results";
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader description="评测集是应用的考题：真实业务样本和人确认的期望结果。任何版本（含未发布的候选版本）都可以拿来评测，分数只由裁判计算。" />
      <Tabs value={tab} onValueChange={(v) => router.replace(`?tab=${v}`)}>
        <TabsList className="mb-4">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="results">
          <Results app={app} initialVersion={search.get("version")} />
        </TabsContent>
        <TabsContent value="cases">
          <Cases app={app} focus={search.get("case")} />
        </TabsContent>
        <TabsContent value="files">
          <BenchFiles app={app} />
        </TabsContent>
        <TabsContent value="rules">
          <BenchRules app={app} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
