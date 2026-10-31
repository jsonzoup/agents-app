/** Shapes returned by `/api/system`. */

import type { AppLevel, SystemPermission } from "./session";

export interface SystemUser {
  id: string;
  name: string;
  title: string;
  roles: string[];
  disabled?: boolean;
  /** Whether the user can sign in with a password yet. */
  passwordSet: boolean;
  groups: string[];
  apps: { app: string; title: string; level: AppLevel }[];
}

export interface SystemGroup {
  id: string;
  name: string;
  description: string;
  members: string[];
  apps: { app: string; title: string; level: AppLevel }[];
}

export interface SystemRole {
  id: string;
  name: string;
  description: string;
  permissions: SystemPermission[];
  builtin?: boolean;
  users: number;
}

export interface SystemView {
  users: SystemUser[];
  groups: SystemGroup[];
  roles: SystemRole[];
  permissions: { id: SystemPermission; label: string; note: string }[];
}

export const LEVEL_TEXT: Record<AppLevel, string> = { use: "使用", manage: "管理" };
