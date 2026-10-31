"use client";

import { createContext, useContext } from "react";
import type { HostApp } from "@/sdk";

export type AppLevel = "use" | "manage";
export type SystemPermission = "system.users" | "system.roles" | "app.create" | "app.all";

export interface Me {
  user: { id: string; name: string; title: string; roles: string[] };
  /** System permissions from the user's roles. */
  system: SystemPermission[];
  /** Names of the user's system roles. */
  roles: string[];
  apps: { name: string; level: AppLevel; label: string }[];
  platform: {
    model: { configured: boolean; name: string | null; note: string };
    executor: { available: boolean; note: string };
    harness: { available: boolean; note: string };
    storage: { driver: "local" | "minio"; location: string; note: string; blobs: string };
  };
  levels: Record<AppLevel, { label: string; note: string }>;
}

export interface AppSummary extends HostApp {
  version: string;
  releases: number;
  /** The app has its own web application (`web/`). */
  hasWeb: boolean;
  evalset: string | null;
  level: AppLevel;
  sources: string[];
  counts: { tasks: number; issues: number; openProposals: number; users: number };
}

export const SessionContext = createContext<{ me: Me; apps: AppSummary[]; refresh: () => void } | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("SessionContext missing");
  return ctx;
}

export const AppContext = createContext<{ app: AppSummary; refresh: () => void } | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext missing");
  return ctx;
}

export const hasSystem = (me: Me, p: SystemPermission) => me.system.includes(p);
export const manages = (app: { level: AppLevel }) => app.level === "manage";
