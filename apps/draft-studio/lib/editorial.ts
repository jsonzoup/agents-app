import type { CreativeBrief } from "./types";

export const blankCreativeBrief = (): CreativeBrief => ({
  commonBelief: "",
  counterAngle: "",
  emotionalArc: "",
  readerMirror: "",
  sceneAnchor: "",
  voiceAnchor: "",
  opening: "",
  development: "",
  turn: "",
  landing: "",
  shareLine: "",
});

export const craftGroups = [
  {
    id: "resonance",
    label: "共鸣判断",
    keys: ["commonBelief", "counterAngle", "emotionalArc", "readerMirror"],
    optional: false,
  },
  {
    id: "story",
    label: "文章结构",
    keys: ["sceneAnchor", "opening", "development", "turn", "landing"],
    optional: false,
  },
  { id: "voice", label: "个人态度", keys: ["voiceAnchor"], optional: true },
  { id: "share", label: "传播落点", keys: ["shareLine"], optional: false },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  keys: ReadonlyArray<keyof CreativeBrief>;
  optional?: boolean;
}>;
