import { createHash } from "node:crypto";
import type { Direction, Workspace } from "./types";
import { visualEntityProjection } from "./visual-entities";

export const knowledgeCategories = [
  "商业与资本",
  "产品与体验",
  "研究与前沿",
  "趋势与叙事",
  "风险与治理",
  "行业事件",
  "基础设施",
  "其他",
] as const;

export type KnowledgeCategory = (typeof knowledgeCategories)[number];

export type ProjectionSource = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  direction: Direction;
  category: KnowledgeCategory;
  summary: string;
  facts: string;
  unknowns: string;
  verification: string;
  structured: boolean;
};

export type ProjectionEntity = {
  id: string;
  name: string;
  normalizedName: string;
  type: string;
  summary: string;
  sourceIds: string[];
  sourceCount: number;
  degree: number;
  aliases: string[];
};

export type ProjectionRelation = {
  id: string;
  fromId: string;
  toId: string;
  predicate: string;
  explanation: string;
  sourceIds: string[];
};

export type KnowledgeProjection = {
  sources: ProjectionSource[];
  entities: ProjectionEntity[];
  relations: ProjectionRelation[];
  topics: Array<{
    id: string;
    title: string;
    direction: Direction;
    thesis: string;
    readerValue: string;
  }>;
  topicLinks: Array<{ sourceId: string; topicId: string }>;
  stats: {
    rawEntities: number;
    canonicalEntities: number;
    rawRelations: number;
    canonicalRelations: number;
    typeCounts: Record<string, number>;
  };
};

const stableId = (prefix: string, value: string) => {
  const hash = createHash("sha1").update(value).digest("hex").slice(0, 32);
  return `${prefix}_${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
};

export function canonicalEntityType(raw: string): string {
  const type = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (/人物|person|ceo|founder|author|researcher/.test(type)) return "人物";
  if (/公司|企业|company|startup/.test(type)) return "公司";
  if (/资本|投资|finance|fund/.test(type)) return "资本";
  if (/政策|法规|policy|regulation/.test(type)) return "政策";
  if (/论文|paper|preprint/.test(type)) return "论文";
  if (/基准|benchmark/.test(type)) return "基准";
  if (/数据集|dataset/.test(type)) return "数据集";
  if (/模型|model/.test(type)) return "模型";
  if (/产品|平台|工具|应用|软件|product|platform|app/.test(type))
    return "产品";
  if (/技术|方法|算法|架构|协议|框架|method|framework|algorithm/.test(type))
    return "技术";
  if (/机构|组织|团队|大学|研究院|政府|organization|institute/.test(type))
    return "机构";
  if (/项目|计划|project|program/.test(type)) return "项目";
  if (/指标|指数|metric|index/.test(type)) return "指标";
  if (/地点|国家|地区|location|country/.test(type)) return "地点";
  if (/会议|event|conference/.test(type)) return "会议";
  return "其他";
}

export function canonicalEntityName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function canonicalRelationPredicate(label: string): {
  predicate: string;
  explanation: string;
} {
  const value = label.trim();
  const match = (
    predicate: string,
    pattern: RegExp,
  ): { predicate: string; explanation: string } => ({
    predicate,
    explanation: pattern.source === value ? "" : value,
  });
  if (/投资|融资|领投|参投|注资/.test(value)) return match("投资", /.*/);
  if (/收购|并购|合并/.test(value)) return match("收购", /.*/);
  if (/合作|联合|联盟|协议/.test(value)) return match("合作", /.*/);
  if (/发布|推出|上线|开源/.test(value)) return match("发布", /.*/);
  if (/开发|研发|创建|构建/.test(value)) return match("开发", /.*/);
  if (/竞争|对标|替代/.test(value)) return match("竞争", /.*/);
  if (/任职|担任|领导|创始|CEO|主任|负责人/.test(value))
    return match("任职", /.*/);
  if (/所属|隶属|旗下|拥有|运营/.test(value)) return match("属于", /.*/);
  if (/使用|采用|调用|基于|集成/.test(value)) return match("使用", /.*/);
  if (/评测|基准|对比|准确率|性能/.test(value)) return match("评测", /.*/);
  if (/研究|分析|证明|发现/.test(value)) return match("研究", /.*/);
  if (/诉讼|监管|禁止|政策|调查|处罚/.test(value))
    return match("监管", /.*/);
  if (/位于|举办|地点/.test(value)) return match("位于", /.*/);
  return { predicate: "相关", explanation: value };
}

export function normalizeKnowledgeCategory(
  raw: string | undefined,
  direction: Direction,
  title = "",
): KnowledgeCategory {
  const value = `${raw ?? ""} ${title}`.toLowerCase();
  if (/政策|监管|法规|诉讼|安全|伦理|边界|治理/.test(value))
    return "风险与治理";
  if (/融资|投资|收购|并购|营收|财报|定价|估值|市场/.test(value))
    return "商业与资本";
  if (/发布|上线|产品|应用|功能|体验|平台|工具/.test(value))
    return "产品与体验";
  if (/论文|研究|实验|基准|数据集|模型|算法/.test(value))
    return "研究与前沿";
  if (/芯片|算力|数据中心|云|基础设施|能源/.test(value))
    return "基础设施";
  if (/趋势|叙事|范式|时代|新变化/.test(value)) return "趋势与叙事";
  if (direction === "商业化") return "商业与资本";
  if (direction === "AI 产品") return "产品与体验";
  if (direction === "AI 边界") return "风险与治理";
  if (direction === "AI 新趋势") return "趋势与叙事";
  if (direction === "AI 人文视角") return "趋势与叙事";
  if (direction === "科研" || direction === "学术前沿")
    return "研究与前沿";
  return "其他";
}

export function summarizeKnowledge(input: {
  summary?: string;
  interpretation?: string;
  facts?: string;
  excerpt?: string;
}): string {
  const candidate =
    input.summary?.trim() ||
    input.facts?.trim() ||
    input.interpretation?.trim() ||
    input.excerpt?.trim() ||
    "";
  const compact = candidate.replace(/\s+/g, " ").trim();
  if (compact.length <= 320) return compact;
  const sentenceEnd = compact.slice(0, 320).lastIndexOf("。");
  return `${compact.slice(0, sentenceEnd > 80 ? sentenceEnd + 1 : 320)}…`;
}

export function buildKnowledgeProjection(
  workspace: Workspace,
): KnowledgeProjection {
  const sourceIds = new Set(workspace.sources.map((source) => source.id));
  const sources = workspace.sources.map((source) => ({
    id: source.id,
    title: source.title,
    url: source.url,
    publisher: source.publisher,
    publishedAt: source.publishedAt,
    direction: source.direction,
    category: normalizeKnowledgeCategory(
      source.category,
      source.direction,
      `${source.title} ${source.facts}`,
    ),
    summary: summarizeKnowledge(source),
    facts: source.facts,
    unknowns: source.unknowns,
    verification: source.verification,
    structured:
      source.kind !== "候选链接" &&
      Boolean(source.facts.trim() || source.excerpt.trim()),
  }));

  const entityByKey = new Map<
    string,
    Omit<ProjectionEntity, "id" | "sourceCount" | "degree">
  >();
  const oldEntityToKey = new Map<string, string>();
  for (const entity of workspace.entities) {
    const name = entity.name.trim().replace(/\s+/g, " ");
    const normalizedName = canonicalEntityName(name);
    if (!name || !normalizedName) continue;
    const type = canonicalEntityType(entity.type);
    const key = `${type}:${normalizedName}`;
    oldEntityToKey.set(entity.id, key);
    const prior = entityByKey.get(key);
    if (prior) {
      prior.sourceIds = [
        ...new Set([
          ...prior.sourceIds,
          ...entity.sourceIds.filter((sourceId) => sourceIds.has(sourceId)),
        ]),
      ];
      if (
        entity.summary.trim() &&
        !prior.summary.includes(entity.summary.trim())
      )
        prior.summary = [prior.summary, entity.summary.trim()]
          .filter(Boolean)
          .join("；")
          .slice(0, 2400);
      if (prior.name !== name && !prior.aliases.includes(name))
        prior.aliases.push(name);
    } else {
      entityByKey.set(key, {
        name,
        normalizedName,
        type,
        summary: entity.summary.trim().slice(0, 2400),
        sourceIds: [
          ...new Set(
            entity.sourceIds.filter((sourceId) => sourceIds.has(sourceId)),
          ),
        ],
        aliases: [],
      });
    }
  }
  // Keep the directory in the graph as source-less reference entities. They are
  // visual affordances, never evidence, so no source or relation is fabricated.
  for (const entity of visualEntityProjection()) {
    const name = entity.name.trim();
    const normalizedName = canonicalEntityName(name);
    const type = canonicalEntityType(entity.type);
    const key = `${type}:${normalizedName}`;
    const prior = entityByKey.get(key);
    if (prior) {
      prior.aliases = [...new Set([...prior.aliases, ...entity.aliases])];
      continue;
    }
    entityByKey.set(key, {
      name,
      normalizedName,
      type,
      summary: entity.summary.slice(0, 2400),
      sourceIds: [],
      aliases: entity.aliases,
    });
  }

  const relationByKey = new Map<
    string,
    Omit<ProjectionRelation, "id">
  >();
  for (const relation of workspace.relations) {
    const fromKey = oldEntityToKey.get(relation.fromId);
    const toKey = oldEntityToKey.get(relation.toId);
    if (!fromKey || !toKey || fromKey === toKey) continue;
    const { predicate, explanation } = canonicalRelationPredicate(
      relation.label,
    );
    const key = `${fromKey}|${predicate}|${toKey}`;
    const prior = relationByKey.get(key);
    if (prior) {
      prior.sourceIds = [
        ...new Set([...prior.sourceIds, ...relation.sourceIds]),
      ];
      if (
        explanation &&
        !prior.explanation.includes(explanation)
      )
        prior.explanation = [prior.explanation, explanation]
          .filter(Boolean)
          .join("；")
          .slice(0, 800);
    } else {
      relationByKey.set(key, {
        fromId: stableId("entity", fromKey),
        toId: stableId("entity", toKey),
        predicate,
        explanation,
        sourceIds: relation.sourceIds.filter((sourceId) =>
          sourceIds.has(sourceId),
        ),
      });
    }
  }

  const degree = new Map<string, number>();
  for (const relation of relationByKey.values()) {
    degree.set(relation.fromId, (degree.get(relation.fromId) ?? 0) + 1);
    degree.set(relation.toId, (degree.get(relation.toId) ?? 0) + 1);
  }
  const entities = [...entityByKey.entries()].map(([key, entity]) => {
    const id = stableId("entity", key);
    return {
      id,
      ...entity,
      sourceCount: entity.sourceIds.length,
      degree: degree.get(id) ?? 0,
    };
  });
  const relations = [...relationByKey.entries()].map(([key, relation]) => ({
    id: stableId("edge", key),
    ...relation,
  }));
  const typeCounts = entities.reduce<Record<string, number>>(
    (counts, entity) => {
      counts[entity.type] = (counts[entity.type] ?? 0) + 1;
      return counts;
    },
    {},
  );

  return {
    sources,
    entities,
    relations,
    topics: workspace.topics.map(
      ({ id, title, direction, thesis, readerValue }) => ({
        id,
        title,
        direction,
        thesis,
        readerValue,
      }),
    ),
    topicLinks: workspace.topics.flatMap((topic) =>
      topic.sourceIds
        .filter((sourceId) => sourceIds.has(sourceId))
        .map((sourceId) => ({ sourceId, topicId: topic.id })),
    ),
    stats: {
      rawEntities: workspace.entities.length,
      canonicalEntities: entities.length,
      rawRelations: workspace.relations.length,
      canonicalRelations: relations.length,
      typeCounts,
    },
  };
}
