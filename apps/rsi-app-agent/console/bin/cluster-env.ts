/**
 * Make `deploy/.env` for cluster mode: random passwords for PostgreSQL, Redis and MinIO, the
 * addresses the platform uses, and the switches that turn cluster mode on. Docker Compose reads
 * it for the services; the platform reads it when `rsi.config.json` has `"envFile": "deploy/.env"`.
 *
 *   node console/bin/cluster-env.ts            write deploy/.env unless it exists
 *   node console/bin/cluster-env.ts --force    replace it (the services' data keeps the old passwords)
 *
 * Ports: RSI_PG_PORT, RSI_REDIS_PORT, RSI_MINIO_PORT from the environment, else 5432, 6380, 9100.
 */

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const platform = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const file = join(platform, 'deploy/.env')
if (existsSync(file) && !process.argv.includes('--force')) {
  process.stdout.write(`${file} 已存在，未改动（要重新生成请加 --force）\n`)
  process.exit(0)
}
const pw = () => randomBytes(24).toString('base64url')
const pg = process.env.RSI_PG_PORT ?? '5432'
const redis = process.env.RSI_REDIS_PORT ?? '6380'
const minio = process.env.RSI_MINIO_PORT ?? '9100'
const pgPassword = pw()
const redisPassword = pw()
const s3Secret = pw()
const lines = [
  '# 平台集群模式的连接与密钥；只给运维看，不要提交。由 console/bin/cluster-env.ts 生成。',
  '',
  '# docker compose 用',
  `RSI_PG_PASSWORD=${pgPassword}`,
  `RSI_REDIS_PASSWORD=${redisPassword}`,
  `RSI_PG_PORT=${pg}`,
  `RSI_REDIS_PORT=${redis}`,
  `RSI_MINIO_PORT=${minio}`,
  `RSI_MINIO_CONSOLE_PORT=${Number(minio) + 1}`,
  '',
  '# 平台用：数据在 PostgreSQL，文件在 MinIO，后台任务和实例间通知走 Redis',
  'RSI_DATABASE=postgres',
  `RSI_DATABASE_URL=postgres://rsi:${pgPassword}@127.0.0.1:${pg}/rsi`,
  'RSI_QUEUE=redis',
  `RSI_REDIS_URL=redis://:${redisPassword}@127.0.0.1:${redis}`,
  'RSI_STORAGE=minio',
  `RSI_S3_ENDPOINT=http://127.0.0.1:${minio}`,
  'RSI_S3_BUCKET=rsi-platform',
  'RSI_S3_ACCESS_KEY=rsi-admin',
  `RSI_S3_SECRET_KEY=${s3Secret}`,
  '',
  '# 为每个应用开通独立的 PostgreSQL 数据库、Redis 前缀与队列、MinIO 存储桶',
  'RSI_APP_PROVISION=1',
  '',
]
await mkdir(dirname(file), { recursive: true })
await writeFile(file, lines.join('\n'), { mode: 0o600 })
process.stdout.write(`已生成 ${file}（权限 600）\n`)
