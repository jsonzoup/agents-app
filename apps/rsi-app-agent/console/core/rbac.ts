/**
 * Access control for the console. Pure policy, no I/O.
 *
 * Two layers:
 * - System: users, groups and roles. A role is a named set of system permissions
 *   (manage users and groups, manage roles, create apps, manage every app).
 * - Apps: each app grants one of two levels, **use** or **manage**, to users or groups.
 *   Manage includes use. A person's level is the highest level any of their grants gives.
 *
 * Release approval: knowledge-tier changes need one manager's approval; code-tier changes
 * need two by default, and each app's managers may lower that to one. When two are needed,
 * one person never signs twice.
 */

export type AppLevel = 'use' | 'manage'

export type SystemPermission = 'system.users' | 'system.roles' | 'app.create' | 'app.all'

export interface User {
  id: string
  name: string
  title: string
  /** System role ids. */
  roles: string[]
  disabled?: boolean
}

export interface Group {
  id: string
  name: string
  description: string
  members: string[]
}

export interface Role {
  id: string
  name: string
  description: string
  permissions: SystemPermission[]
  builtin?: boolean
}

export interface Grant {
  kind: 'user' | 'group'
  id: string
  level: AppLevel
}

/** `grants[app]` = who may use or manage that app. */
export type Grants = Record<string, Grant[]>

export interface Directory {
  users: User[]
  groups: Group[]
  roles: Role[]
  grants: Grants
}

export type Permission =
  | 'app.use'
  | 'app.read'
  | 'signal.record'
  | 'proposal.create'
  | 'proposal.verify'
  | 'approve.owner'
  | 'approve.engineer'
  | 'eval.run'
  | 'eval.manage'
  | 'app.trial'
  | 'release.rollback'
  | 'release.import'
  | 'access.manage'

export const LEVEL_LABEL: Record<AppLevel, string> = { use: '使用', manage: '管理' }

export const LEVEL_NOTE: Record<AppLevel, string> = {
  use: '办理业务；修正结果（修正自动成为改进信号）',
  manage: '使用；查看与修改应用包；起草、验证、批准提案；评测；发布与回滚；授权',
}

export const SYSTEM_PERMISSIONS: { id: SystemPermission; label: string; note: string }[] = [
  { id: 'system.users', label: '用户与用户组', note: '新增、停用用户，维护用户组，给用户分配角色' },
  { id: 'system.roles', label: '角色', note: '定义角色包含哪些系统权限' },
  { id: 'app.create', label: '创建应用', note: '用 AI 编码助手创建新应用，创建者自动获得该应用的管理权' },
  { id: 'app.all', label: '管理所有应用', note: '对每个应用都有管理权，用于接管无人管理的应用' },
]

export const BUILTIN_ROLES: Role[] = [
  { id: 'admin', name: '系统管理员', description: '管理用户、用户组、角色；可创建和接管所有应用', permissions: ['system.users', 'system.roles', 'app.create', 'app.all'], builtin: true },
  { id: 'developer', name: '应用开发者', description: '可以创建新应用', permissions: ['app.create'], builtin: true },
]

export const GRANTS: Record<AppLevel, Permission[]> = {
  use: ['app.use', 'signal.record'],
  manage: ['app.use', 'app.read', 'signal.record', 'proposal.create', 'proposal.verify', 'approve.owner', 'approve.engineer', 'eval.run', 'eval.manage', 'app.trial', 'release.rollback', 'release.import', 'access.manage'],
}

export class AccessError extends Error {
  readonly status: number
  constructor(message: string, status = 403) {
    super(message)
    this.name = 'AccessError'
    this.status = status
  }
}

/** System permissions a user holds through their roles. */
export function systemPermissionsOf(dir: Pick<Directory, 'roles'>, user: User): SystemPermission[] {
  const set = new Set<SystemPermission>()
  for (const id of user.roles ?? []) for (const p of dir.roles.find((r) => r.id === id)?.permissions ?? []) set.add(p)
  return [...set].sort()
}

export function hasSystem(dir: Pick<Directory, 'roles'>, user: User, permission: SystemPermission): boolean {
  return systemPermissionsOf(dir, user).includes(permission)
}

export function demandSystem(dir: Pick<Directory, 'roles'>, user: User, permission: SystemPermission): void {
  if (!hasSystem(dir, user, permission)) throw new AccessError(`${user.name} 没有系统权限：${SYSTEM_PERMISSIONS.find((p) => p.id === permission)?.label ?? permission}`)
}

/** Whether a grant covers a user, directly or through a group. */
function covers(dir: Pick<Directory, 'groups'>, grant: Grant, user: User): boolean {
  if (grant.kind === 'user') return grant.id === user.id
  return dir.groups.find((g) => g.id === grant.id)?.members.includes(user.id) ?? false
}

/**
 * A user's level in one app: the highest of their direct and group grants; `app.all` gives manage.
 * @returns null when the user has no access.
 */
export function levelOf(dir: Directory, app: string, user: User): AppLevel | null {
  if (user.disabled) return null
  if (hasSystem(dir, user, 'app.all')) return 'manage'
  let level: AppLevel | null = null
  for (const grant of dir.grants[app] ?? []) {
    if (!covers(dir, grant, user)) continue
    if (grant.level === 'manage') return 'manage'
    level = 'use'
  }
  return level
}

/** How a user came by their level in an app, for display. */
export function sourcesOf(dir: Directory, app: string, user: User): string[] {
  const out: string[] = []
  if (hasSystem(dir, user, 'app.all')) out.push('系统权限：管理所有应用')
  for (const grant of dir.grants[app] ?? []) {
    if (!covers(dir, grant, user)) continue
    out.push(grant.kind === 'user' ? `直接授权：${LEVEL_LABEL[grant.level]}` : `用户组 ${dir.groups.find((g) => g.id === grant.id)?.name ?? grant.id}：${LEVEL_LABEL[grant.level]}`)
  }
  return out
}

/** Every permission a user holds in one app; empty means the app is invisible to them. */
export function permissionsOf(dir: Directory, app: string, user: User): Permission[] {
  const level = levelOf(dir, app, user)
  return level ? [...GRANTS[level]].sort() : []
}

export function can(dir: Directory, app: string, user: User, permission: Permission): boolean {
  return permissionsOf(dir, app, user).includes(permission)
}

export function visibleApps(dir: Directory, apps: string[], user: User): string[] {
  return apps.filter((app) => levelOf(dir, app, user) !== null)
}

/** @throws AccessError naming the missing permission. */
export function demand(dir: Directory, app: string, user: User, permission: Permission): void {
  if (!can(dir, app, user, permission)) {
    const need = GRANTS.use.includes(permission) ? '使用' : '管理'
    throw new AccessError(`${user.name} 没有 ${app} 的${need}权限`)
  }
}

/** How many managers must approve a code-tier proposal in one app; every change is kept. */
export interface ApprovalPolicy {
  codeApprovals: 1 | 2
  history: { codeApprovals: 1 | 2; by: string; at: string }[]
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = { codeApprovals: 2, history: [] }

/**
 * Approval slots a proposal needs under an app's policy.
 * @throws AccessError for contract tier, which never goes through approval.
 */
export function approvalRoles(tier: string, policy: ApprovalPolicy): ('owner' | 'engineer')[] {
  if (tier === 'knowledge') return ['owner']
  if (tier === 'code') return policy.codeApprovals === 1 ? ['owner'] : ['owner', 'engineer']
  throw new AccessError('契约级变更不走进化回路，只能人工评审', 400)
}

/**
 * Validate a requested code-tier approval count.
 * @throws AccessError unless it is 1 or 2.
 */
export function checkCodeApprovals(value: unknown): 1 | 2 {
  if (value !== 1 && value !== 2) throw new AccessError('代码级批准人数只能是 1 或 2', 400)
  return value
}

/**
 * Check one approval before it reaches the kernel: a manager signs in one of the two slots,
 * never in both on the same proposal.
 * @param prior - approvals already recorded on the proposal.
 */
export function demandApproval(dir: Directory, app: string, user: User, role: 'owner' | 'engineer', prior: { role: string; by: string }[]): void {
  demand(dir, app, user, role === 'owner' ? 'approve.owner' : 'approve.engineer')
  if (prior.some((a) => a.by === user.name && a.role !== role)) throw new AccessError(`${user.name} 已经在这个提案上签过另一处；代码级变更需要两位不同的管理者批准`)
}

/**
 * Validate an app's grant list: principals exist, levels are known, and at least one
 * enabled person ends up with manage.
 * @throws AccessError describing the problem.
 */
export function checkGrants(app: string, next: Grant[], dir: Directory): void {
  const seen = new Set<string>()
  for (const g of next) {
    if (g.level !== 'use' && g.level !== 'manage') throw new AccessError(`没有权限级别 ${String(g.level)}`, 400)
    if (g.kind === 'user' ? !dir.users.some((u) => u.id === g.id) : !dir.groups.some((x) => x.id === g.id)) throw new AccessError(`没有${g.kind === 'user' ? '用户' : '用户组'} ${g.id}`, 400)
    const key = `${g.kind}:${g.id}`
    if (seen.has(key)) throw new AccessError(`${g.kind === 'user' ? '用户' : '用户组'} ${g.id} 重复授权`, 400)
    seen.add(key)
  }
  const trial: Directory = { ...dir, grants: { ...dir.grants, [app]: next } }
  if (!dir.users.some((u) => !u.disabled && !hasSystem(dir, u, 'app.all') && levelOf(trial, app, u) === 'manage')) {
    throw new AccessError('每个应用至少要有一位可用的管理者（直接授权或通过用户组）', 400)
  }
}

const ID = /^[a-z][a-z0-9_-]{1,31}$/

/** @throws AccessError when a user record is malformed or references unknown roles. */
export function checkUser(user: User, dir: Pick<Directory, 'roles'>): void {
  if (!ID.test(user.id ?? '')) throw new AccessError('用户标识只能用小写字母、数字、下划线和连字符，2–32 位，以字母开头', 400)
  if (!user.name?.trim()) throw new AccessError('缺少姓名', 400)
  for (const r of user.roles ?? []) if (!dir.roles.some((x) => x.id === r)) throw new AccessError(`没有角色 ${r}`, 400)
}

export function checkGroup(group: Group, dir: Pick<Directory, 'users'>): void {
  if (!ID.test(group.id ?? '')) throw new AccessError('用户组标识只能用小写字母、数字、下划线和连字符，2–32 位，以字母开头', 400)
  if (!group.name?.trim()) throw new AccessError('缺少用户组名称', 400)
  for (const m of group.members ?? []) if (!dir.users.some((u) => u.id === m)) throw new AccessError(`没有用户 ${m}`, 400)
}

export function checkRole(role: Role): void {
  if (!ID.test(role.id ?? '')) throw new AccessError('角色标识只能用小写字母、数字、下划线和连字符，2–32 位，以字母开头', 400)
  if (!role.name?.trim()) throw new AccessError('缺少角色名称', 400)
  for (const p of role.permissions ?? []) if (!SYSTEM_PERMISSIONS.some((x) => x.id === p)) throw new AccessError(`没有系统权限 ${p}`, 400)
}

/** At least one enabled user must keep both system-administration permissions. */
export function checkAdminRemains(dir: Directory): void {
  const ok = dir.users.some((u) => !u.disabled && hasSystem(dir, u, 'system.users') && hasSystem(dir, u, 'system.roles'))
  if (!ok) throw new AccessError('至少要保留一位可用的系统管理员（同时拥有“用户与用户组”和“角色”权限）', 400)
}
