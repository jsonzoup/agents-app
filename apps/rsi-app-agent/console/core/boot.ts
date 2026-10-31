/**
 * Wire the console: kernel with the chosen executor, the apps' judges, the model-backed
 * learner when a model is configured, app tests for code-tier proposals, and the app coding
 * assistant over the harness. Documents, files and jobs go where the deployment says
 * (`cluster.ts`, `storage.ts`): JSON files, the home and this process by default.
 */

import { join } from 'node:path'
import { FsStore, RsiKernel, commandAppTests, mcpJudge, reflectiveLearner, systemClock } from '../../rsi-kernel/src/index.ts'
import type { Clock, Executor, Learner, Store } from '../../rsi-kernel/src/index.ts'
import { AppInfra } from './appinfra.ts'
import { InlineJobs, RedisJobs, clusterConfig, deploymentStatus, instanceId } from './cluster.ts'
import type { DeploymentStatus, Jobs } from './cluster.ts'
import { PgStore, migrate } from './pgstore.ts'
import { Bench } from './bench.ts'
import { Builder } from './builder.ts'
import type { BuilderOptions } from './builder.ts'
import { Console } from './console.ts'
import { chooseExecutor, findHarness } from './executor.ts'
import type { HarnessStatus } from './executor.ts'
import { STATE_DIR, platformEnv, resolveHome } from './home.ts'
import { deepseekModel, modelStatus } from './model.ts'
import { DirMirror, openStorage, storageConfig } from './storage.ts'

export interface BootOptions {
  /** Platform directory, where `rsi.config.json` lives. */
  platform: string
  /** Defaults to the configured home (see `home.ts`). */
  home?: string
  env?: NodeJS.ProcessEnv
  clock?: Clock
  /** Replaces the harness executor (hosts with their own runtime, tests). */
  executor?: Executor
  /** How the injected executor is described to people. */
  executorNote?: string
  /** Defaults to the harness found from the environment and the enclosing checkout. */
  harness?: HarnessStatus
  onAppAdded?: BuilderOptions['onAppAdded']
}

export interface Platform {
  console: Console
  builder: Builder
  bench: Bench
  home: string
  deployment: DeploymentStatus
  /** Each app's own database, cache, queue and bucket; null when not provisioning. */
  infra: AppInfra | null
  /** Stop taking jobs and close connections. */
  close(): Promise<void>
}

export async function bootPlatform(options: BootOptions): Promise<Platform> {
  const env = options.env ?? platformEnv(options.platform)
  const home = options.home ?? resolveHome(options.platform, env)
  const storage = openStorage(home, storageConfig(options.platform, env), env)
  const cluster = clusterConfig(options.platform, env)
  const instance = instanceId()
  const synced = await storage.files.sync()
  if (synced.pulled || synced.pushed || synced.deleted) process.stderr.write(`[rsi] 存储同步：从 ${storage.files.status.location} 取回 ${synced.pulled} 个文件，上传 ${synced.pushed} 个，删除 ${synced.deleted} 个\n`)
  let store: Store
  let docs: PgStore | null = null
  if (cluster.database.driver === 'postgres') {
    docs = new PgStore(cluster.database.url, join(home, STATE_DIR, 'cache'), { blobs: storage.blobs ?? undefined })
    await migrate(docs.pg)
    store = docs
  } else store = new FsStore(join(home, STATE_DIR, 'store'), { blobs: storage.blobs ?? undefined })
  const jobs: Jobs = cluster.queue.driver === 'redis' ? new RedisJobs(cluster.queue.url, cluster.queue.prefix, { instance, concurrency: cluster.workers }) : new InlineJobs(instance)
  const deployment = deploymentStatus(cluster, storage.files.status, instance)
  const model = deepseekModel(env)
  const harness = options.harness ?? findHarness(env, options.platform)
  const chosen = chooseExecutor(harness, home, (input) => console.executorInput(input))
  const executor = options.executor ?? chosen.executor
  const executorStatus = options.executor ? { available: true, note: options.executorNote ?? options.executor.name } : chosen.status
  const clock = options.clock ?? systemClock
  const learners: Learner[] = model ? [reflectiveLearner(model)] : []
  /** Workspace runs read their own `evals/` for `<app>/evals/...` materials. */
  const workspaceExecutor = (workspace: { app: string; root: string }) =>
    options.executor ?? chooseExecutor(harness, home, (input) => console.executorInput(input, workspace)).executor
  const kernelOver = (s: Store, ex: Executor = executor): RsiKernel =>
    new RsiKernel({
      store: s,
      clock,
      executor: ex,
      judge: (app, v) => mcpJudge(app.source.evals.root, v.command, v.args),
      learners,
      appTests: commandAppTests('node', ['--test', 'tests/*.test.ts']),
    })
  const kernel = kernelOver(store)
  const console = new Console({
    home,
    stateDir: join(home, STATE_DIR, 'console'),
    store,
    kernel,
    model,
    modelStatus: modelStatus(env),
    executorStatus,
    now: () => clock.now(),
    files: storage.files,
    blobStore: storage.blobs?.name ?? 'local',
    docs,
    jobs,
    deployment,
  })
  await console.boot()
  if (await console.ensureAdmin(env.RSI_ADMIN_PASSWORD)) process.stderr.write('[rsi] 已创建管理员账号 admin（密码来自 RSI_ADMIN_PASSWORD）\n')
  const bench = new Bench(console)
  await bench.recover()
  const builder = new Builder({
    console,
    root: join(home, STATE_DIR, 'builder'),
    harness,
    scratchKernel: (dir, workspace) => kernelOver(new FsStore(dir), workspace ? workspaceExecutor(workspace) : executor),
    now: () => clock.now(),
    onAppAdded: options.onAppAdded,
    saveEvals: (app, user, writes, note) => bench.write(app, user, writes, note),
    mirror: storage.s3 ? new DirMirror(storage.s3, `${storage.config.driver === 'minio' ? storage.config.prefix : ''}builder/`) : null,
  })
  await jobs.start()
  const infra = cluster.provision ? AppInfra.fromEnv(env, { docs, s3: storage.s3, console }) : null
  console.infra = infra
  process.stderr.write(`[rsi] 实例 ${instance}：${deployment.mode === 'cluster' ? '集群模式' : '单实例模式'}（数据 ${deployment.database.location}，文件 ${deployment.storage.location}，任务 ${deployment.queue.location}${infra ? '，为应用开通独立资源' : ''}）\n`)
  return {
    console,
    builder,
    bench,
    home,
    deployment,
    infra,
    async close() {
      await jobs.stop()
      await docs?.close()
      await infra?.close()
    },
  }
}

export async function bootConsole(options: BootOptions): Promise<Console> {
  return (await bootPlatform(options)).console
}
