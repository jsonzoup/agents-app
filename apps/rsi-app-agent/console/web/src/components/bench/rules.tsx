"use client";

import type { ReactNode } from "react";
import { Failure, Loading, Section } from "@/components/shell/page";
import { useApi } from "@/lib/api";
import type { AppSummary } from "@/lib/session";
import { JsonBlock } from "./common";

interface Rules {
  cases: number;
  dev: number;
  holdout: string[];
  casesDir: string;
  trials: number;
  capabilities: Record<string, string>;
  oracles: number;
  judge: string;
  tests: boolean;
  expect: boolean;
  evalset: string | null;
  executor: { available: boolean; note: string };
  example: { id: string; expected: unknown } | null;
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">{n}</span>
      <div className="min-w-0 space-y-1">
        <div className="font-medium">{title}</div>
        <div className="text-[13px] leading-6 text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

export function BenchRules({ app }: { app: AppSummary }) {
  const { data, error } = useApi<Rules>(`/api/apps/${app.name}/bench/rules`);
  if (error) return <Failure error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Section title="评测集怎么建">
          <div className="space-y-4 p-4">
            <Step n={1} title="一个用例一个文件夹：真实输入 + 人确认过的期望 + 验证规则">
              按规范 <code>rsi-eval/1</code>，用例是 <code>evals/{data.casesDir}/&lt;编号&gt;/</code> 文件夹：<code>case.json</code> 写 <code>id</code>、<code>title</code>、<code>input</code>、<code>expected</code>、<code>rules</code>、
              <code>validator</code>，可选 <code>tags</code>、<code>split</code>、<code>scope</code>、<code>source</code>；输入材料（单据、表格、扫描件）放在 <code>input/</code>，期望也可以写成 <code>expected/</code> 里的文件。
              <code>rules</code> 是不用写程序的声明式检查（等于、数值误差、取值之一、包含、正则、条数、非空）；规则做不到的比对交给验证程序，<code>evals/eval.json</code> 声明除默认裁判之外的验证程序和标签的含义。
            </Step>
            <Step n={2} title="参考答案：先证明考题本身没错">
              用例可以带一份参考答案（<code>oracle</code>，通常是 <code>expected/oracle.json</code>）：一次完整、正确的运行结果，由人写或人确认。评测前先用这个用例自己的规则和裁判给参考答案打分，<b>必须满分</b>；不满分说明期望值写错了或裁判有毛病，这个用例判为“无效”，不执行、不计分，并挡住发布，直到人修好。从已确认的单据生成用例、在 AI
              编码里确认运行结果时，平台会自动存参考答案（现在 {data.oracles}/{data.cases} 个用例有）。
            </Step>
            <Step n={3} title="难度和能力：看得出考到了什么">
              <code>difficulty</code>（easy、medium、hard）和 <code>why</code> 写这个用例难在哪里；<code>capabilities</code> 写它考哪些能力，词表在 <code>eval.json</code> 的 <code>capabilities</code> 里（现在 {Object.keys(data.capabilities).length} 项）。“用例”页的<b>用例体检</b>列出每项能力有哪些用例、稳定版通过几个，没有用例的能力一眼可见。
            </Step>
            <Step n={4} title="从哪里来">
              最省事的是在“用例”里点<b>从真实单据生成</b>：选一张业务员确认过的单据，输入原样带过来，确认后的结果作为期望值{data.expect ? "（经 evals/expect.ts 转成裁判需要的格式）" : ""}，材料自动复制进评测集。也可以手工新增，或在“文件”里直接上传、编辑。
            </Step>
            <Step n={5} title="开发集和留出集">
              开发集（{data.dev} 个）给改进过程看：AI 起草修改时可以参考失败的开发集用例。留出集（{data.holdout.length} 个：{data.holdout.join("、") || "无"}）只用来把关，起草时看不到，防止“对着考题改”。写在 app.json
              留出名单里的用例属于契约，只能人改契约后调整。
            </Step>
            <Step n={6} title="谁能改">
              只有应用的管理者能改评测集；进化回路永远不能改期望值、验证程序和契约。AI 编码助手可以起草用例，由发布的人确认后才保存，快照上记着“AI 起草、某人确认”。每次保存都生成一个快照（当前 <b className="font-mono text-foreground">{data.evalset ?? "—"}</b>），改坏了（比如 JSON 写错）会自动撤销。
            </Step>
          </div>
        </Section>

        <Section title="评测时怎么用这些数据">
          <div className="space-y-4 p-4">
            <Step n={1} title="选一个版本">
              任何版本都能评：已发布的版本，或提案的候选版本（稳定版加上提案的改动，还没发布）。开发完一个新版本，就在“结果”里选它的候选版本点开始评测；提案验证时也会自动评测。
            </Step>
            <Step n={2} title="选全部，或勾选用例">
              “结果”里按开发集、留出集评测整套，这是发布的依据；“用例”里可以按标签筛选、勾选多个用例只跑它们，结果标为“所选”，只用来看问题，不作为发布依据。
            </Step>
            <Step n={3} title="逐个用例运行">
              用这个版本的知识、技能和代码，按用例的输入跑一遍应用（{data.executor.note}）。界面文件不影响输出，所以只改界面的版本会直接复用之前的运行结果。
            </Step>
            <Step n={4} title="规则和验证程序打分">
              每条规则是一个检查项；验证程序（默认裁判 <code>{data.judge}</code>）逐项比对输出和期望结果，也是检查项。得分 = 通过的项数 / 检查的项数；另外检查每次运行都必须遵守的硬规则（不变量），违反即不通过。分数只由规则和验证程序算，人和 AI 都不能改分。
            </Step>
            <Step n={5} title="执行出错不算答错">
              执行器不可用、进程或模型服务挂了，智能体根本没机会作答，这个用例记为“出错”：不计分、不缓存、不算退步，重新运行即可。智能体超时、用完轮次、交出不合契约的结果，才算它答错。提案验证里只要有出错或无效的用例，“评测完整”这道闸门就不放行。
            </Step>
            <Step n={6} title="多跑几次看稳定性">
              模型每次的输出可能不同。评测时可以选每个用例跑 2–5 次：检查项过半次数通过算通过，报告标出“时过时不过”的检查项；比较版本时只认稳定的变化——基线每次都过、候选过半失败才算退步。提案验证跑几次由 <code>eval.json</code> 的 <code>trials</code> 决定（现在 {data.trials} 次），次数越多越稳，成本也成倍增加。
            </Step>
            <Step n={7} title="消融：知识和技能到底贡献了多少">
              选“去掉知识”（保留根说明和各技能的 SKILL.md，拿掉参考资料和客户等范围知识）或“去掉技能”（整个技能目录都拿掉）再跑同一版本，报告和同一评测集上的完整运行逐个用例对比。去掉后分数不降，说明那部分知识在这些用例上没起作用，或者用例没考到它。消融结果不代表版本成绩，不进版本得分表。
            </Step>
            <Step n={8} title="复用、重评与报告">
              同一版本的执行内容、同一用例、同一裁判的结果会复用。改了用例只影响那个用例；改了验证程序，所有用例都会重算。评测结果上标着用的是哪个评测集快照，快照变了会提示“评测集已更新”。每次评测都能导出标准报告（JSON 格式 rsi-eval-report/1，或 Markdown）。
            </Step>
          </div>
        </Section>

        <Section title="结果怎么看">
          <div className="space-y-3 p-4 text-[13px] leading-6 text-muted-foreground">
            <p>
              <b className="text-foreground">版本 × 用例矩阵</b>：每行是一个版本最近一次的评测，每格是一个用例的得分；选一个对比基准，比它好的格子有 ↑，变差的有 ↓。绿色全对，黄色 80% 以上，红色更低，⚠ 表示违反了硬规则。
            </p>
            <p>
              <b className="text-foreground">点开一格</b>：看每个字段的期望值和实际值，以及应用的完整输出和输入，判断是应用错了还是期望值该更新。
            </p>
            <p>
              <b className="text-foreground">提案的验证闸门</b>：候选版本和基线逐项对比——不变量不违反、评测完整（没有出错或无效的用例）、开发集不退步、确有改进（只改界面时免）、留出集不退步，代码级改动还要通过应用自测{data.tests ? "（evals/tests）" : "（这个应用还没有自测）"}。全部通过才能批准发布。
            </p>
          </div>
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="这个应用">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 p-4 text-[13px]">
            <dt className="text-muted-foreground">用例</dt>
            <dd>
              {data.cases} 个（开发 {data.dev} · 留出 {data.holdout.length}）
            </dd>
            <dt className="text-muted-foreground">评测集</dt>
            <dd className="font-mono">{data.evalset ?? "—"}</dd>
            <dt className="text-muted-foreground">参考答案</dt>
            <dd>
              {data.oracles}/{data.cases} 个用例有
            </dd>
            <dt className="text-muted-foreground">验证跑几次</dt>
            <dd>每个用例 {data.trials} 次</dd>
            <dt className="text-muted-foreground">能力词表</dt>
            <dd>{Object.keys(data.capabilities).length ? Object.keys(data.capabilities).join("、") : "未定义"}</dd>
            <dt className="text-muted-foreground">裁判</dt>
            <dd className="break-all font-mono text-xs">{data.judge}</dd>
            <dt className="text-muted-foreground">自测</dt>
            <dd>{data.tests ? "有" : "无"}</dd>
            <dt className="text-muted-foreground">期望生成</dt>
            <dd>{data.expect ? "evals/expect.ts" : "无（确认结果直接作为期望值）"}</dd>
            <dt className="text-muted-foreground">执行</dt>
            <dd className="text-xs">{data.executor.note}</dd>
          </dl>
        </Section>
        {data.example && (
          <Section title={`期望结果示例 · ${data.example.id}`}>
            <JsonBlock value={data.example.expected} className="m-3 max-h-96 border-0" />
          </Section>
        )}
      </div>
    </div>
  );
}
