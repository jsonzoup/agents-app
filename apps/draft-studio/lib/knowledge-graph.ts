import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { home } from "./store";
import {
  buildKnowledgeProjection,
  type KnowledgeProjection,
} from "./knowledge-model";
import type {
  KnowledgeGraphResult,
  KnowledgeRelationHit,
  KnowledgeSourceHit,
  Source,
  Workspace,
} from "./types";

const GRAPH_SCHEMA_VERSION = 2;
const KUZU_VERSION = "0.11.3";
const graphDir = path.join(home, "graph");
const databasePath = path.join(graphDir, "knowledge.kuzu");
const metadataPath = path.join(graphDir, "metadata.json");

type KuzuQueryResult = {
  getAllObjects(): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
};

type KuzuConnection = {
  init(): Promise<void>;
  query(statement: string): Promise<KuzuQueryResult>;
  close(): Promise<void>;
};

type KuzuDatabase = {
  init(): Promise<void>;
  close(): Promise<void>;
};

type KuzuModule = {
  Database: new (databasePath: string) => KuzuDatabase;
  Connection: new (database: KuzuDatabase) => KuzuConnection;
  close(): Promise<void>;
};

type GraphRuntime = {
  connection: KuzuConnection;
};

type GraphMetadata = {
  schemaVersion: number;
  fingerprint: string;
  indexedAt: string;
  counts: KnowledgeGraphResult["counts"];
  normalization: KnowledgeGraphResult["normalization"];
};

const require = createRequire(import.meta.url);
let runtimePromise: Promise<GraphRuntime> | undefined;
let writeChain: Promise<unknown> = Promise.resolve();

function cypherString(value: string | undefined): string {
  return `'${(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r?\n/g, " ")}'`;
}

function idList(ids: string[]): string {
  return `[${[...new Set(ids)].map((value) => cypherString(value)).join(", ")}]`;
}

async function rows(
  connection: KuzuConnection,
  statement: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await connection.query(statement);
  try {
    return await result.getAllObjects();
  } finally {
    await result.close();
  }
}

async function ensureRuntime(): Promise<GraphRuntime> {
  runtimePromise ??= (async () => {
    await mkdir(graphDir, { recursive: true });
    const kuzu = require("kuzu-wasm/nodejs") as KuzuModule;
    const database = new kuzu.Database(databasePath);
    await database.init();
    const connection = new kuzu.Connection(database);
    await connection.init();
    for (const statement of [
      "CREATE NODE TABLE IF NOT EXISTS Source(id STRING, title STRING, url STRING, publisher STRING, publishedAt STRING, direction STRING, category STRING, summary STRING, facts STRING, unknowns STRING, verification STRING, structured BOOLEAN, PRIMARY KEY(id))",
      "CREATE NODE TABLE IF NOT EXISTS Entity(id STRING, name STRING, normalizedName STRING, type STRING, summary STRING, sourceCount INT64, degree INT64, aliases STRING, PRIMARY KEY(id))",
      "CREATE NODE TABLE IF NOT EXISTS Topic(id STRING, title STRING, direction STRING, thesis STRING, readerValue STRING, PRIMARY KEY(id))",
      "CREATE REL TABLE IF NOT EXISTS MENTIONS(FROM Source TO Entity, evidence STRING)",
      "CREATE REL TABLE IF NOT EXISTS RELATES(FROM Entity TO Entity, predicate STRING, explanation STRING)",
      "CREATE REL TABLE IF NOT EXISTS COVERS(FROM Source TO Topic)",
    ])
      await connection.query(statement);
    return { connection };
  })();
  return runtimePromise;
}

function fingerprint(projection: KnowledgeProjection): string {
  return createHash("sha256")
    .update(JSON.stringify({ schema: GRAPH_SCHEMA_VERSION, projection }))
    .digest("hex");
}

async function readMetadata(): Promise<GraphMetadata | undefined> {
  try {
    return JSON.parse(await readFile(metadataPath, "utf8")) as GraphMetadata;
  } catch {
    return undefined;
  }
}

async function databaseExists(): Promise<boolean> {
  try {
    await access(databasePath);
    return true;
  } catch {
    return false;
  }
}

async function count(
  connection: KuzuConnection,
  statement: string,
  alias = "n",
): Promise<number> {
  const [row] = await rows(connection, statement);
  return Number(row?.[alias] ?? 0);
}

async function graphCounts(
  connection: KuzuConnection,
  projection: KnowledgeProjection,
): Promise<KnowledgeGraphResult["counts"]> {
  return {
    sources: await count(connection, "MATCH (s:Source) RETURN count(*) AS n"),
    structuredSources: projection.sources.filter((source) => source.structured)
      .length,
    entities: await count(
      connection,
      "MATCH (e:Entity) RETURN count(*) AS n",
    ),
    relations: await count(
      connection,
      "MATCH ()-[r:RELATES]->() RETURN count(*) AS n",
    ),
    topics: await count(connection, "MATCH (t:Topic) RETURN count(*) AS n"),
    mentions: await count(
      connection,
      "MATCH ()-[m:MENTIONS]->() RETURN count(*) AS n",
    ),
  };
}

async function rebuildGraph(
  connection: KuzuConnection,
  projection: KnowledgeProjection,
  hash: string,
): Promise<GraphMetadata> {
  await connection.query("BEGIN TRANSACTION");
  try {
    await connection.query("MATCH (n) DETACH DELETE n");
    for (const source of projection.sources) {
      await connection.query(
        `CREATE (:Source {id:${cypherString(source.id)}, title:${cypherString(source.title)}, url:${cypherString(source.url)}, publisher:${cypherString(source.publisher)}, publishedAt:${cypherString(source.publishedAt)}, direction:${cypherString(source.direction)}, category:${cypherString(source.category)}, summary:${cypherString(source.summary)}, facts:${cypherString(source.facts)}, unknowns:${cypherString(source.unknowns)}, verification:${cypherString(source.verification)}, structured:${source.structured}})` ,
      );
    }
    for (const entity of projection.entities) {
      await connection.query(
        `CREATE (:Entity {id:${cypherString(entity.id)}, name:${cypherString(entity.name)}, normalizedName:${cypherString(entity.normalizedName)}, type:${cypherString(entity.type)}, summary:${cypherString(entity.summary)}, sourceCount:${entity.sourceCount}, degree:${entity.degree}, aliases:${cypherString(entity.aliases.join(" | "))}})`,
      );
    }
    for (const topic of projection.topics)
      await connection.query(
        `CREATE (:Topic {id:${cypherString(topic.id)}, title:${cypherString(topic.title)}, direction:${cypherString(topic.direction)}, thesis:${cypherString(topic.thesis)}, readerValue:${cypherString(topic.readerValue)}})`,
      );
    for (const source of projection.sources) {
      for (const entity of projection.entities) {
        if (!entity.sourceIds.includes(source.id)) continue;
        await connection.query(
          `MATCH (s:Source {id:${cypherString(source.id)}}), (e:Entity {id:${cypherString(entity.id)}}) CREATE (s)-[:MENTIONS {evidence:${cypherString(source.summary)}}]->(e)`,
        );
      }
    }
    for (const relation of projection.relations) {
      await connection.query(
        `MATCH (a:Entity {id:${cypherString(relation.fromId)}}), (b:Entity {id:${cypherString(relation.toId)}}) CREATE (a)-[:RELATES {predicate:${cypherString(relation.predicate)}, explanation:${cypherString(relation.explanation)}}]->(b)`,
      );
    }
    for (const link of projection.topicLinks) {
      await connection.query(
        `MATCH (s:Source {id:${cypherString(link.sourceId)}}), (t:Topic {id:${cypherString(link.topicId)}}) CREATE (s)-[:COVERS]->(t)`,
      );
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  const counts = await graphCounts(connection, projection);
  const sourceCategoryCounts = projection.sources.reduce<
    Record<string, number>
  >((counts, source) => {
    counts[source.category] = (counts[source.category] ?? 0) + 1;
    return counts;
  }, {});
  const metadata: GraphMetadata = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    fingerprint: hash,
    indexedAt: new Date().toISOString(),
    counts,
    normalization: {
      rawEntities: projection.stats.rawEntities,
      canonicalEntities: projection.stats.canonicalEntities,
      rawRelations: projection.stats.rawRelations,
      canonicalRelations: projection.stats.canonicalRelations,
      entityTypes: Object.entries(projection.stats.typeCounts)
        .map(([type, count]) => ({ type, count }))
        .sort((left, right) => right.count - left.count),
      sourceCategories: Object.entries(sourceCategoryCounts)
        .map(([category, count]) => ({ category, count }))
        .sort((left, right) => right.count - left.count),
    },
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });
  return metadata;
}

export async function syncKnowledgeGraph(
  workspace: Workspace,
  options: { force?: boolean } = {},
): Promise<GraphMetadata> {
  const projection = buildKnowledgeProjection(workspace);
  const hash = fingerprint(projection);
  const cached = await readMetadata();
  if (
    !options.force &&
    cached?.schemaVersion === GRAPH_SCHEMA_VERSION &&
    cached.fingerprint === hash &&
    (await databaseExists())
  )
    return cached;
  const task = writeChain.then(async () => {
    const latest = await readMetadata();
    if (
      !options.force &&
      latest?.schemaVersion === GRAPH_SCHEMA_VERSION &&
      latest.fingerprint === hash &&
      (await databaseExists())
    )
      return latest;
    const { connection } = await ensureRuntime();
    return rebuildGraph(connection, projection, hash);
  });
  writeChain = task.catch(() => undefined);
  return task;
}

async function sourcesForEntities(
  connection: KuzuConnection,
  entityIds: string[],
): Promise<Map<string, KnowledgeSourceHit[]>> {
  const attached = new Map<string, KnowledgeSourceHit[]>();
  if (!entityIds.length) return attached;
  const result = await rows(
    connection,
    `MATCH (s:Source)-[:MENTIONS]->(e:Entity) WHERE e.id IN ${idList(entityIds)} RETURN e.id AS entityId, s.id AS id, s.title AS title, s.url AS url, s.summary AS summary, s.category AS category ORDER BY s.publishedAt DESC LIMIT 80`,
  );
  for (const row of result) {
    const entityId = String(row.entityId ?? "");
    if (!entityId) continue;
    const current = attached.get(entityId) ?? [];
    if (current.length >= 5) continue;
    current.push({
      id: String(row.id ?? ""),
      title: String(row.title ?? ""),
      url: String(row.url ?? ""),
      summary: String(row.summary ?? ""),
      category: String(row.category ?? ""),
    });
    attached.set(entityId, current);
  }
  return attached;
}

async function relationsForEntities(
  connection: KuzuConnection,
  entityIds: string[],
): Promise<KnowledgeRelationHit[]> {
  if (!entityIds.length) return [];
  const ids = idList(entityIds);
  const result = await rows(
    connection,
    `MATCH (a:Entity)-[r:RELATES]->(b:Entity) WHERE a.id IN ${ids} OR b.id IN ${ids} RETURN a.id AS fromId, a.name AS fromName, b.id AS toId, b.name AS toName, r.predicate AS predicate, r.explanation AS explanation ORDER BY a.degree + b.degree DESC LIMIT 40`,
  );
  return result.map((row) => ({
    fromId: String(row.fromId ?? ""),
    fromName: String(row.fromName ?? ""),
    toId: String(row.toId ?? ""),
    toName: String(row.toName ?? ""),
    predicate: String(row.predicate ?? ""),
    explanation: String(row.explanation ?? ""),
  }));
}

export async function queryKnowledgeGraph(
  workspace: Workspace,
  query = "",
): Promise<KnowledgeGraphResult> {
  const metadata = await syncKnowledgeGraph(workspace);
  const { connection } = await ensureRuntime();
  const trimmed = query.trim().slice(0, 120);
  const filter = trimmed
    ? `WHERE lower(e.name) CONTAINS lower(${cypherString(trimmed)}) OR lower(e.summary) CONTAINS lower(${cypherString(trimmed)}) OR lower(e.type) CONTAINS lower(${cypherString(trimmed)})`
    : "";
  const entityRows = await rows(
    connection,
    `MATCH (e:Entity) ${filter} RETURN e.id AS id, e.name AS name, e.type AS type, e.summary AS summary, e.sourceCount AS sourceCount, e.degree AS degree ORDER BY e.sourceCount DESC, e.degree DESC, e.name LIMIT 24`,
  );
  const entityIds = entityRows.map((row) => String(row.id ?? ""));
  const sourceFilter = trimmed
    ? `WHERE lower(s.title) CONTAINS lower(${cypherString(trimmed)}) OR lower(s.summary) CONTAINS lower(${cypherString(trimmed)}) OR lower(s.category) CONTAINS lower(${cypherString(trimmed)})`
    : "";
  const [attachedSources, relatedRelations, sourceRows] = await Promise.all([
    sourcesForEntities(connection, entityIds),
    relationsForEntities(connection, entityIds),
    rows(
      connection,
      `MATCH (s:Source) ${sourceFilter} RETURN s.id AS id, s.title AS title, s.url AS url, s.summary AS summary, s.category AS category ORDER BY s.publishedAt DESC LIMIT 18`,
    ),
  ]);
  return {
    engine: "Kuzu",
    version: KUZU_VERSION,
    indexedAt: metadata.indexedAt,
    query: trimmed,
    counts: metadata.counts,
    normalization: metadata.normalization,
    sources: sourceRows.map((row) => ({
      id: String(row.id ?? ""),
      title: String(row.title ?? ""),
      url: String(row.url ?? ""),
      summary: String(row.summary ?? ""),
      category: String(row.category ?? ""),
    })),
    entities: entityRows.map((row) => {
      const id = String(row.id ?? "");
      return {
        id,
        name: String(row.name ?? ""),
        type: String(row.type ?? ""),
        summary: String(row.summary ?? ""),
        sourceCount: Number(row.sourceCount ?? 0),
        degree: Number(row.degree ?? 0),
        sources: attachedSources.get(id) ?? [],
      };
    }),
    relations: relatedRelations,
  };
}

export async function buildKnowledgeContext(
  workspace: Workspace,
  topicTitle: string,
  sources: Source[],
): Promise<string> {
  await syncKnowledgeGraph(workspace);
  const { connection } = await ensureRuntime();
  const sourceIds = sources.map((source) => source.id);
  if (!sourceIds.length) return "";
  const relevant = await rows(
    connection,
    `MATCH (s:Source)-[:MENTIONS]->(e:Entity) WHERE s.id IN ${idList(sourceIds)} RETURN e.id AS id, e.name AS name, e.type AS type, e.summary AS summary, e.sourceCount AS sourceCount, count(s) AS matchedSources ORDER BY matchedSources DESC, sourceCount DESC LIMIT 24`,
  );
  const entityIds = relevant.map((row) => String(row.id ?? ""));
  const relations = await relationsForEntities(connection, entityIds);
  const lines = [
    `Kuzu 图谱线索｜选题：${topicTitle}`,
    `关联实体（按本选题证据覆盖数排序，共 ${relevant.length} 个）：`,
    ...relevant.map((row) => {
      const summary = String(row.summary ?? "").slice(0, 260);
      return `- ${String(row.name ?? "")} [${String(row.type ?? "")}]：${summary || "暂无摘要"}（本选题 ${Number(row.matchedSources ?? 0)} 份，知识库 ${Number(row.sourceCount ?? 0)} 份）`;
    }),
  ];
  if (relations.length) {
    lines.push("图谱关系：");
    lines.push(
      ...relations
        .slice(0, 24)
        .map(
          (relation) =>
            `- ${relation.fromName} --${relation.predicate}--> ${relation.toName}${relation.explanation ? `：${relation.explanation.slice(0, 160)}` : ""}`,
        ),
    );
  }
  lines.push(
    "使用原则：跨多份资料重复出现的实体可作为主线索；单来源关系只能作为待核实假设。不得把图谱中的相关关系改写成因果。",
  );
  return lines.join("\n").slice(0, 7000);
}
