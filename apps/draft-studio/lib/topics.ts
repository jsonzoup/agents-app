import type { Direction, TopicMix } from "./types";

export const directions = [
  "商业化",
  "科研",
  "AI 产品",
  "AI 新趋势",
  "AI 边界",
  "AI 人文视角",
  "学术前沿",
] as const satisfies ReadonlyArray<Direction>;

export const defaultTopicMix: TopicMix = {
  商业化: 25,
  科研: 15,
  "AI 产品": 10,
  "AI 新趋势": 15,
  "AI 边界": 10,
  "AI 人文视角": 15,
  学术前沿: 10,
};

export function normalizeTopicMix(value: unknown): TopicMix | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const clamped = Object.fromEntries(
    directions.map((direction) => {
      const weight = Number(record[direction]);
      return [
        direction,
        Number.isFinite(weight)
          ? Math.max(0, Math.min(100, Math.round(weight)))
          : 0,
      ];
    }),
  ) as TopicMix;
  const total = topicMixTotal(clamped);
  if (!total) return undefined;
  const exact = directions.map((direction) => ({
    direction,
    value: (clamped[direction] / total) * 100,
  }));
  const normalized = new Map(
    exact.map(({ direction, value }) => [direction, Math.floor(value)]),
  );
  let remaining =
    100 - [...normalized.values()].reduce((sum, value) => sum + value, 0);
  for (const { direction } of [...exact].sort(
    (left, right) =>
      right.value - Math.floor(right.value) -
        (left.value - Math.floor(left.value)) ||
      directions.indexOf(left.direction) -
        directions.indexOf(right.direction),
  )) {
    if (remaining <= 0) break;
    normalized.set(direction, (normalized.get(direction) ?? 0) + 1);
    remaining -= 1;
  }
  return Object.fromEntries(normalized) as TopicMix;
}

export function topicMixTotal(mix: TopicMix): number {
  return directions.reduce((total, direction) => total + mix[direction], 0);
}

export function allocateTopicSlots(
  count: number,
  mix: TopicMix,
): Array<{ direction: Direction; count: number }> {
  const targetCount = Math.max(0, Math.floor(count));
  const total = topicMixTotal(mix);
  if (!targetCount || !total) return [];

  const exact = directions.map((direction) => ({
    direction,
    value: (targetCount * mix[direction]) / total,
  }));
  const allocation = new Map(
    exact.map(({ direction, value }) => [direction, Math.floor(value)]),
  );
  let remaining =
    targetCount -
    [...allocation.values()].reduce((sum, value) => sum + value, 0);
  const byRemainder = [...exact].sort(
    (left, right) =>
      right.value - Math.floor(right.value) -
        (left.value - Math.floor(left.value)) ||
      directions.indexOf(left.direction) -
        directions.indexOf(right.direction),
  );
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    const direction = byRemainder[index % byRemainder.length].direction;
    allocation.set(direction, (allocation.get(direction) ?? 0) + 1);
  }

  return directions
    .map((direction) => ({
      direction,
      count: allocation.get(direction) ?? 0,
    }))
    .filter((entry) => entry.count > 0);
}
