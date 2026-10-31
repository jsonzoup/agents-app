"use client";

import {
  Eye,
  EyeOff,
  Focus,
  Layers3,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KnowledgeEntityHit,
  KnowledgeRelationHit,
  KnowledgeSourceHit,
} from "@/lib/types";

type LayoutMode = "network" | "clusters";
type PointedNode = KnowledgeEntityHit & {
  x: number;
  y: number;
  radius: number;
  color: string;
  labelWidth: number;
};
type EdgeGeometry = {
  relation: KnowledgeRelationHit;
  from: PointedNode;
  to: PointedNode;
  path: string;
  labelX: number;
  labelY: number;
};
type GraphCluster = {
  type: string;
  color: string;
  x: number;
  y: number;
  radius: number;
  count: number;
};

const WIDTH = 960;
const HEIGHT = 620;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const TYPE_COLORS: Record<string, string> = {
  公司: "#7dd3a7",
  产品: "#f4b860",
  模型: "#75c7e8",
  技术: "#8da5ff",
  人物: "#ff9d86",
  机构: "#c3a4ff",
  论文: "#d7c08a",
  事件: "#e38fa8",
  基准: "#8fd5c8",
  数据集: "#9fc6e8",
  政策: "#d3a46f",
  资本: "#e1bd6f",
  地点: "#a9d1b7",
  项目: "#9fbe73",
  会议: "#d0a4cc",
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function colorForType(type: string): string {
  return TYPE_COLORS[type] ?? "#a8d5b6";
}

function labelWidth(name: string): number {
  const units = [...name].reduce(
    (total, character) =>
      total + (/[\u0000-\u00ff]/.test(character) ? 0.58 : 1),
    0,
  );
  return Math.min(190, Math.max(62, Math.round(units * 10 + 20)));
}

function nodeRadius(entity: KnowledgeEntityHit): number {
  return Math.max(
    21,
    Math.min(38, 22 + entity.sourceCount * 2.2 + entity.degree * 0.7),
  );
}

function clusterCenters(types: string[]): Map<string, { x: number; y: number }> {
  const centers = new Map<string, { x: number; y: number }>();
  if (types.length === 1) {
    centers.set(types[0], { x: CENTER_X, y: CENTER_Y });
    return centers;
  }
  types.forEach((type, index) => {
    const angle = -Math.PI / 2 + (index / types.length) * Math.PI * 2;
    const orbit = types.length <= 4 ? 190 : 235;
    centers.set(type, {
      x: CENTER_X + Math.cos(angle) * orbit,
      y: CENTER_Y + Math.sin(angle) * orbit * 0.72,
    });
  });
  return centers;
}

function simulateNetwork(
  entities: KnowledgeEntityHit[],
  relations: KnowledgeRelationHit[],
): Map<string, { x: number; y: number }> {
  const types = [...new Set(entities.map((entity) => entity.type))];
  const centers = clusterCenters(types);
  const nodes = entities.map((entity) => {
    const center = centers.get(entity.type) ?? {
      x: CENTER_X,
      y: CENTER_Y,
    };
    const seed = stableHash(entity.id);
    const angle = (seed % 6283) / 1000;
    const radius = 32 + (seed % 74);
    return {
      id: entity.id,
      type: entity.type,
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius * 0.72,
      vx: 0,
      vy: 0,
      radius: nodeRadius(entity),
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = relations.flatMap((relation) => {
    const from = byId.get(relation.fromId);
    const to = byId.get(relation.toId);
    return from && to ? [{ from, to }] : [];
  });

  for (let iteration = 0; iteration < 190; iteration += 1) {
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left];
        const b = nodes[right];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(20, Math.hypot(dx, dy));
        const force = Math.min(
          16,
          (1800 + a.radius * b.radius * 1.4) / (distance * distance),
        );
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    for (const edge of edges) {
      const dx = edge.to.x - edge.from.x;
      const dy = edge.to.y - edge.from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = 145 + (edge.from.radius + edge.to.radius) * 0.7;
      const force = (distance - desired) * 0.012;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      edge.from.vx += fx;
      edge.from.vy += fy;
      edge.to.vx -= fx;
      edge.to.vy -= fy;
    }
    for (const node of nodes) {
      const cluster = centers.get(node.type) ?? {
        x: CENTER_X,
        y: CENTER_Y,
      };
      node.vx += (cluster.x - node.x) * 0.0012;
      node.vy += (cluster.y - node.y) * 0.0012;
      node.vx += (CENTER_X - node.x) * 0.00035;
      node.vy += (CENTER_Y - node.y) * 0.00035;
      node.vx *= 0.84;
      node.vy *= 0.84;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scaleX = maxX - minX > 1 ? 730 / (maxX - minX) : 1;
  const scaleY = maxY - minY > 1 ? 390 / (maxY - minY) : 1;
  return new Map(
    nodes.map((node) => [
      node.id,
      {
        x: 115 + (node.x - minX) * Math.min(scaleX, 1.8),
        y: 115 + (node.y - minY) * Math.min(scaleY, 1.8),
      },
    ]),
  );
}

function clusterLayout(
  entities: KnowledgeEntityHit[],
): Map<string, { x: number; y: number }> {
  const groups = new Map<string, KnowledgeEntityHit[]>();
  for (const entity of entities) {
    const group = groups.get(entity.type) ?? [];
    group.push(entity);
    groups.set(entity.type, group);
  }
  const typeNames = [...groups.keys()];
  const columns = Math.min(3, typeNames.length);
  const rows = Math.max(1, Math.ceil(typeNames.length / columns));
  const cellWidth = 820 / columns;
  const cellHeight = 430 / rows;
  const centers = new Map(
    typeNames.map((type, index) => [
      type,
      {
        x: 70 + cellWidth * ((index % columns) + 0.5),
        y: 96 + cellHeight * (Math.floor(index / columns) + 0.5),
      },
    ]),
  );
  const positions = new Map<string, { x: number; y: number }>();
  for (const [type, group] of groups) {
    const center = centers.get(type) ?? { x: CENTER_X, y: CENTER_Y };
    group
      .sort(
        (left, right) =>
          right.sourceCount - left.sourceCount ||
          left.name.localeCompare(right.name),
      )
      .forEach((entity, index) => {
        if (group.length === 1) {
          positions.set(entity.id, center);
          return;
        }
        const ringCapacity =
          group.length <= 3 ? group.length : Math.min(7, group.length);
        const ring = Math.floor(index / ringCapacity);
        const withinRing = index % ringCapacity;
        const radius = Math.max(
          52,
          Math.min(96, 28 + ringCapacity * 9 + ring * 28),
        );
        positions.set(entity.id, {
          x:
            center.x +
            Math.cos(
              -Math.PI / 2 +
                (withinRing / ringCapacity) * Math.PI * 2,
            ) *
              radius,
          y:
            center.y +
            Math.sin(
              -Math.PI / 2 +
                (withinRing / ringCapacity) * Math.PI * 2,
            ) *
              radius *
              0.76,
        });
      });
  }
  return positions;
}

function buildPointedNodes(
  entities: KnowledgeEntityHit[],
  relations: KnowledgeRelationHit[],
  mode: LayoutMode,
): PointedNode[] {
  const positions =
    mode === "network"
      ? simulateNetwork(entities, relations)
      : clusterLayout(entities);
  return entities.map((entity) => {
    const position = positions.get(entity.id) ?? {
      x: CENTER_X,
      y: CENTER_Y,
    };
    return {
      ...entity,
      x: Math.max(82, Math.min(WIDTH - 82, position.x)),
      y: Math.max(78, Math.min(HEIGHT - 86, position.y)),
      radius: nodeRadius(entity),
      color: colorForType(entity.type),
      labelWidth: labelWidth(entity.name),
    };
  });
}

function curvedEdge(from: PointedNode, to: PointedNode, index: number): {
  path: string;
  labelX: number;
  labelY: number;
} {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const bend = ((stableHash(`${from.id}:${to.id}`) % 2 ? 1 : -1) *
    Math.min(46, 18 + distance * 0.055));
  const controlX = (from.x + to.x) / 2 - (dy / distance) * bend;
  const controlY = (from.y + to.y) / 2 + (dx / distance) * bend;
  const labelX = 0.25 * from.x + 0.5 * controlX + 0.25 * to.x;
  const labelY = 0.25 * from.y + 0.5 * controlY + 0.25 * to.y;
  return {
    path: `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`,
    labelX,
    labelY: labelY + (index % 2 ? 4 : -4),
  };
}

export default function KnowledgeGraphExplorer({
  entities,
  relations,
  query,
  selectedId,
  onSelect,
  onOpenSource,
}: {
  entities: KnowledgeEntityHit[];
  relations: KnowledgeRelationHit[];
  query: string;
  selectedId: string;
  onSelect: (entityId: string) => void;
  onOpenSource: (source: KnowledgeSourceHit) => void;
}) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("network");
  const [nodes, setNodes] = useState<PointedNode[]>(() =>
    buildPointedNodes(entities, relations, "network"),
  );
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeType, setActiveType] = useState("");
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [hoveredId, setHoveredId] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    nodeX: number;
    nodeY: number;
  } | null>(null);
  const panRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  useEffect(() => {
    const next = buildPointedNodes(entities, relations, layoutMode);
    setNodes(next);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [entities, relations, layoutMode]);

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const selected = nodeById.get(selectedId);
  const hovered = nodeById.get(hoveredId);
  const neighbors = useMemo(() => {
    if (!selected) return new Set<string>();
    const ids = new Set<string>();
    for (const relation of relations) {
      if (relation.fromId === selected.id) ids.add(relation.toId);
      if (relation.toId === selected.id) ids.add(relation.fromId);
    }
    return ids;
  }, [relations, selected]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const edges = useMemo(
    () =>
      relations.flatMap((relation, index): EdgeGeometry[] => {
        const from = nodeById.get(relation.fromId);
        const to = nodeById.get(relation.toId);
        if (!from || !to) return [];
        return [{ relation, from, to, ...curvedEdge(from, to, index) }];
      }),
    [nodeById, relations],
  );
  const clusters = useMemo((): GraphCluster[] => {
    const groups = new Map<string, PointedNode[]>();
    for (const node of nodes) {
      const group = groups.get(node.type) ?? [];
      group.push(node);
      groups.set(node.type, group);
    }
    return [...groups.entries()].map(([type, group]) => {
      const x =
        group.reduce((total, node) => total + node.x, 0) / group.length;
      const y =
        group.reduce((total, node) => total + node.y, 0) / group.length;
      const radius = Math.max(
        64,
        ...group.map((node) =>
          Math.hypot(node.x - x, node.y - y) + node.radius + 20,
        ),
      );
      return {
        type,
        color: colorForType(type),
        x,
        y,
        radius,
        count: group.length,
      };
    });
  }, [nodes]);
  const types = useMemo(
    () =>
      [...new Set(entities.map((entity) => entity.type))]
        .map((type) => ({
          type,
          color: colorForType(type),
          count: entities.filter((entity) => entity.type === type).length,
        }))
        .sort((left, right) => right.count - left.count),
    [entities],
  );
  const selectedRelations = selected
    ? relations.filter(
        (relation) =>
          relation.fromId === selected.id || relation.toId === selected.id,
      )
    : [];

  function svgPoint(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: CENTER_X, y: CENTER_Y };
    return {
      x: ((clientX - rect.left) / rect.width) * WIDTH,
      y: ((clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function zoomAt(nextZoom: number, clientX?: number, clientY?: number) {
    const clamped = Math.max(0.62, Math.min(2.8, nextZoom));
    if (clientX === undefined || clientY === undefined) {
      const graphX = (CENTER_X - pan.x) / zoom;
      const graphY = (CENTER_Y - pan.y) / zoom;
      setPan({
        x: CENTER_X - graphX * clamped,
        y: CENTER_Y - graphY * clamped,
      });
    } else {
      const point = svgPoint(clientX, clientY);
      const graphX = (point.x - pan.x) / zoom;
      const graphY = (point.y - pan.y) / zoom;
      setPan({
        x: point.x - graphX * clamped,
        y: point.y - graphY * clamped,
      });
    }
    setZoom(clamped);
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (dragRef.current) {
      const drag = dragRef.current;
      const dx = ((event.clientX - drag.startX) / rect.width) * WIDTH;
      const dy = ((event.clientY - drag.startY) / rect.height) * HEIGHT;
      setNodes((current) =>
        current.map((node) =>
          node.id === drag.id
            ? {
                ...node,
                x: Math.max(
                  70,
                  Math.min(WIDTH - 70, drag.nodeX + dx / zoom),
                ),
                y: Math.max(
                  70,
                  Math.min(HEIGHT - 70, drag.nodeY + dy / zoom),
                ),
              }
            : node,
        ),
      );
    } else if (panRef.current) {
      const dx = ((event.clientX - panRef.current.startX) / rect.width) * WIDTH;
      const dy = ((event.clientY - panRef.current.startY) / rect.height) * HEIGHT;
      setPan({
        x: panRef.current.panX + dx,
        y: panRef.current.panY + dy,
      });
    }
  }

  function endPointer() {
    dragRef.current = null;
    panRef.current = null;
  }

  if (!entities.length)
    return (
      <section className="knowledge-graph-stage knowledge-graph-empty">
        <span className="knowledge-graph-orbit" />
        <Layers3 size={26} />
        <b>图谱还没有形成连接</b>
        <p>完成资料阅读和结构化归档后，实体、关系与证据会在这里自动展开。</p>
      </section>
    );

  return (
    <section className={`knowledge-graph-stage ${layoutMode}`}>
      <header className="knowledge-graph-stage-head">
        <div>
          <span>KNOWLEDGE TERRAIN</span>
          <h3>证据关系图</h3>
          <p>拖拽节点整理结构，滚轮缩放，点击节点聚焦一跳证据邻域。</p>
        </div>
        <div className="knowledge-graph-kpis">
          <span>
            <b>{entities.length}</b> 实体
          </span>
          <span>
            <b>{relations.length}</b> 关系
          </span>
          <span>
            <b>{types.length}</b> 类型
          </span>
        </div>
      </header>
      <div className="knowledge-graph-controlbar">
        <div className="knowledge-graph-layouts" role="group" aria-label="图谱布局">
          <button
            type="button"
            className={layoutMode === "network" ? "active" : ""}
            onClick={() => setLayoutMode("network")}
          >
            关系网络
          </button>
          <button
            type="button"
            className={layoutMode === "clusters" ? "active" : ""}
            onClick={() => setLayoutMode("clusters")}
          >
            类型聚类
          </button>
        </div>
        <div className="knowledge-graph-legend">
          {types.slice(0, 8).map((type) => (
            <button
              type="button"
              key={type.type}
              className={activeType === type.type ? "active" : ""}
              onClick={() =>
                setActiveType((current) =>
                  current === type.type ? "" : type.type,
                )
              }
            >
              <i style={{ background: type.color }} />
              {type.type}
              <small>{type.count}</small>
            </button>
          ))}
        </div>
        <div className="knowledge-graph-tools">
          <button
            type="button"
            aria-label={showEdgeLabels ? "隐藏关系标签" : "显示关系标签"}
            onClick={() => setShowEdgeLabels((current) => !current)}
          >
            {showEdgeLabels ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            aria-label="缩小图谱"
            onClick={() => zoomAt(zoom - 0.16)}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="放大图谱"
            onClick={() => zoomAt(zoom + 0.16)}
          >
            <Plus size={14} />
          </button>
          <button type="button" aria-label="适应画布" onClick={resetView}>
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div className="knowledge-graph-workbench">
        <div className="knowledge-graph-viewport">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-labelledby="knowledge-graph-title knowledge-graph-desc"
            onPointerDown={(event) => {
              if (event.target !== event.currentTarget) return;
              panRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                panX: pan.x,
                panY: pan.y,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onWheel={(event) => {
              event.preventDefault();
              zoomAt(
                zoom * Math.exp(-event.deltaY * 0.0012),
                event.clientX,
                event.clientY,
              );
            }}
          >
            <title id="knowledge-graph-title">Kuzu 知识实体关系图</title>
            <desc id="knowledge-graph-desc">
              展示 {entities.length} 个实体和 {relations.length} 条关系，可拖拽、缩放并选择节点查看证据。
            </desc>
            <defs>
              <radialGradient id="knowledge-space" cx="50%" cy="42%" r="72%">
                <stop offset="0%" stopColor="#18392b" />
                <stop offset="58%" stopColor="#0e241a" />
                <stop offset="100%" stopColor="#07120d" />
              </radialGradient>
              <pattern
                id="knowledge-grid"
                width="28"
                height="28"
                patternUnits="userSpaceOnUse"
              >
                <circle cx="1.2" cy="1.2" r="1.1" fill="#b4d8bd" opacity=".13" />
              </pattern>
              <filter id="node-glow" x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur stdDeviation="10" />
              </filter>
              <marker
                id="edge-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#c4dac8" opacity=".5" />
              </marker>
            </defs>
            <rect
              width={WIDTH}
              height={HEIGHT}
              fill="url(#knowledge-space)"
              onPointerDown={(event) => {
                panRef.current = {
                  startX: event.clientX,
                  startY: event.clientY,
                  panX: pan.x,
                  panY: pan.y,
                };
                svgRef.current?.setPointerCapture(event.pointerId);
              }}
            />
            <rect width={WIDTH} height={HEIGHT} fill="url(#knowledge-grid)" />
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              {layoutMode === "clusters" &&
                clusters.map((cluster) => (
                  <g className="knowledge-cluster" key={cluster.type}>
                    <circle
                      cx={cluster.x}
                      cy={cluster.y}
                      r={cluster.radius}
                      fill={cluster.color}
                      fillOpacity=".035"
                      stroke={cluster.color}
                      strokeOpacity=".18"
                      strokeDasharray="4 8"
                    />
                    <text
                      x={cluster.x}
                      y={cluster.y - cluster.radius - 8}
                      fill={cluster.color}
                    >
                      {cluster.type} · {cluster.count}
                    </text>
                  </g>
                ))}
              <g className="knowledge-edges">
                {edges.map(({ relation, from, to, path, labelX, labelY }) => {
                  const connected =
                    !selected ||
                    relation.fromId === selected.id ||
                    relation.toId === selected.id;
                  const typeActive =
                    !activeType ||
                    from.type === activeType ||
                    to.type === activeType;
                  const labelVisible =
                    showEdgeLabels ||
                    (selected &&
                      (relation.fromId === selected.id ||
                        relation.toId === selected.id));
                  return (
                    <g
                      key={`${relation.fromId}-${relation.toId}-${relation.predicate}`}
                      className={`knowledge-edge ${connected ? "connected" : "muted"} ${typeActive ? "" : "filtered"}`}
                    >
                      <path d={path} markerEnd="url(#edge-arrow)" />
                      {labelVisible && (
                        <g className="knowledge-edge-label">
                          <rect
                            x={labelX - Math.max(22, relation.predicate.length * 5)}
                            y={labelY - 9}
                            width={Math.max(44, relation.predicate.length * 10)}
                            height="18"
                            rx="9"
                          />
                          <text x={labelX} y={labelY + 3}>
                            {relation.predicate}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
              <g className="knowledge-nodes">
                {nodes.map((node) => {
                  const isSelected = selected?.id === node.id;
                  const isNeighbor = neighbors.has(node.id);
                  const matchesQuery =
                    normalizedQuery &&
                    `${node.name} ${node.type} ${node.summary}`
                      .toLocaleLowerCase()
                      .includes(normalizedQuery);
                  const dimmed =
                    (selected && !isSelected && !isNeighbor) ||
                    (activeType && node.type !== activeType);
                  const showLabel =
                    layoutMode === "network" ||
                    isSelected ||
                    matchesQuery ||
                    hoveredId === node.id ||
                    node.sourceCount >= 8;
                  return (
                    <g
                      key={node.id}
                      data-graph-node={node.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${node.name}，${node.type}，${node.sourceCount} 份来源，${node.degree} 条关系`}
                      className={`knowledge-node ${isSelected ? "selected" : ""} ${isNeighbor ? "neighbor" : ""} ${matchesQuery ? "query-match" : ""} ${dimmed ? "dimmed" : ""}`}
                      transform={`translate(${node.x} ${node.y})`}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        dragRef.current = {
                          id: node.id,
                          startX: event.clientX,
                          startY: event.clientY,
                          nodeX: node.x,
                          nodeY: node.y,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerUp={endPointer}
                      onPointerMove={handlePointerMove}
                      onPointerEnter={() => setHoveredId(node.id)}
                      onPointerLeave={() => setHoveredId("")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(isSelected ? "" : node.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(isSelected ? "" : node.id);
                        }
                      }}
                    >
                      <circle
                        className="knowledge-node-glow"
                        r={node.radius + 14}
                        fill={node.color}
                        filter="url(#node-glow)"
                      />
                      <circle
                        className="knowledge-node-ring"
                        r={node.radius + 6}
                        stroke={node.color}
                      />
                      <circle
                        className="knowledge-node-core"
                        r={node.radius}
                        fill={node.color}
                      />
                      <text
                        className="knowledge-node-type"
                        y="4"
                        textAnchor="middle"
                      >
                        {node.type.slice(0, 1)}
                      </text>
                      {showLabel && (
                        <>
                          <rect
                            className="knowledge-node-label-bg"
                            x={-node.labelWidth / 2}
                            y={node.radius + 8}
                            width={node.labelWidth}
                            height="24"
                            rx="12"
                          />
                          <text
                            className="knowledge-node-name"
                            y={node.radius + 24}
                            textAnchor="middle"
                          >
                            {node.name.length > 16
                              ? `${node.name.slice(0, 15)}…`
                              : node.name}
                          </text>
                        </>
                      )}
                      {isSelected && (
                        <circle
                          className="knowledge-node-focus"
                          r={node.radius + 12}
                          stroke={node.color}
                        />
                      )}
                      <title>
                        {node.name} · {node.type} · {node.sourceCount} 份来源 ·{" "}
                        {node.degree} 条关系
                      </title>
                    </g>
                  );
                })}
              </g>
              {hovered && !selected && (
                <g
                  className="knowledge-node-hovercard"
                  transform={`translate(${Math.min(WIDTH - 190, hovered.x + hovered.radius + 14)} ${Math.max(30, hovered.y - 64)})`}
                >
                  <rect width="178" height="74" rx="10" />
                  <text x="12" y="21" className="hovercard-type">
                    {hovered.type}
                  </text>
                  <text x="12" y="42" className="hovercard-name">
                    {hovered.name.slice(0, 20)}
                  </text>
                  <text x="12" y="61" className="hovercard-meta">
                    {hovered.sourceCount} 份来源 · {hovered.degree} 条关系
                  </text>
                </g>
              )}
            </g>
          </svg>
          <div className="knowledge-graph-minimap" aria-hidden="true">
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
              <rect width={WIDTH} height={HEIGHT} />
              {edges.map(({ relation, from, to }) => (
                <line
                  key={`mini-${relation.fromId}-${relation.toId}-${relation.predicate}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                />
              ))}
              {nodes.map((node) => (
                <circle
                  key={`mini-${node.id}`}
                  cx={node.x}
                  cy={node.y}
                  r={node.radius / 2}
                  fill={node.color}
                />
              ))}
            </svg>
          </div>
          <div className="knowledge-graph-hint">
            <Focus size={13} />
            滚轮缩放 · 空白处拖拽 · 节点可移动
          </div>
        </div>
        <aside className="knowledge-graph-inspector">
          {selected ? (
            <>
              <div className="graph-inspector-eyebrow">
                <span style={{ background: selected.color }} />
                {selected.type}
              </div>
              <h4>{selected.name}</h4>
              <p>{selected.summary || "暂无实体摘要。"}</p>
              <div className="graph-inspector-metrics">
                <div>
                  <b>{selected.sourceCount}</b>
                  <span>证据来源</span>
                </div>
                <div>
                  <b>{selected.degree}</b>
                  <span>邻域关系</span>
                </div>
              </div>
              <div className="graph-inspector-section">
                <div className="graph-inspector-section-head">
                  <b>证据来源</b>
                  <small>{selected.sources.length}</small>
                </div>
                {selected.sources.slice(0, 5).map((source) => (
                  <button
                    type="button"
                    key={source.id}
                    onClick={() => onOpenSource(source)}
                  >
                    <span>{source.category}</span>
                    <b>{source.title}</b>
                  </button>
                ))}
                {!selected.sources.length && <small>暂无关联来源。</small>}
              </div>
              <div className="graph-inspector-section">
                <div className="graph-inspector-section-head">
                  <b>一跳关系</b>
                  <small>{selectedRelations.length}</small>
                </div>
                {selectedRelations.slice(0, 6).map((relation) => {
                  const nextId =
                    relation.fromId === selected.id
                      ? relation.toId
                      : relation.fromId;
                  return (
                    <button
                      type="button"
                      key={`${relation.fromId}-${relation.toId}-${relation.predicate}`}
                      onClick={() => onSelect(nextId)}
                    >
                      <span>{relation.predicate}</span>
                      <b>
                        {relation.fromId === selected.id
                          ? relation.toName
                          : relation.fromName}
                      </b>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="graph-inspector-clear"
                onClick={() => onSelect("")}
              >
                <RotateCcw size={13} />
                退出聚焦
              </button>
            </>
          ) : (
            <>
              <div className="graph-inspector-eyebrow">
                <span />
                KNOWLEDGE INDEX
              </div>
              <h4>从中心节点开始探索</h4>
              <p>按证据覆盖度排序。点击节点可聚焦相邻实体，并查看原始资料。</p>
              <div className="graph-rank-list">
                {[...nodes]
                  .sort(
                    (left, right) =>
                      right.sourceCount - left.sourceCount ||
                      right.degree - left.degree,
                  )
                  .slice(0, 6)
                  .map((node, index) => (
                    <button
                      type="button"
                      key={node.id}
                      onClick={() => onSelect(node.id)}
                    >
                      <i style={{ background: node.color }} />
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <b>{node.name}</b>
                      <small>{node.sourceCount} 源</small>
                    </button>
                  ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
