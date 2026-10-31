/**
 * Zip archives without dependencies: write (deflate) and read (stored or deflate). Enough for
 * exporting and importing apps; no zip64, encryption or multi-disk archives.
 */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  /** Forward-slash relative path. */
  path: string
  bytes: Uint8Array
}

const MAX_ENTRIES = 20000
const MAX_TOTAL = 1024 * 1024 * 1024

function dosTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** Pack entries into a zip archive. */
export function writeZip(entries: ZipEntry[], date = new Date()): Buffer {
  const { time, day } = dosTime(date)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const raw = Buffer.from(entry.bytes)
    const packed = deflateRawSync(raw)
    const deflate = packed.length < raw.length
    const data = deflate ? packed : raw
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/** A safe relative path inside an archive, or null for entries that must be skipped (directories, `..`, absolute). */
function safePath(name: string): string | null {
  const path = name.replace(/\\/g, '/')
  if (path.endsWith('/') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return null
  const parts = path.split('/')
  if (parts.some((p) => p === '..' || p === '' || p === '.')) return null
  if (parts[0] === '__MACOSX' || parts.at(-1) === '.DS_Store') return null
  return path
}

/**
 * Unpack a zip archive. Directory entries, `__MACOSX` and unsafe paths are skipped.
 * @throws when the archive is malformed, encrypted, uses an unsupported method or is too large.
 */
export function readZip(input: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i
      break
    }
  }
  if (end < 0) throw new Error('不是 zip 压缩包')
  const count = buf.readUInt16LE(end + 10)
  if (count > MAX_ENTRIES) throw new Error(`压缩包里文件太多（${count}）`)
  let at = buf.readUInt32LE(end + 16)
  const out: ZipEntry[] = []
  let total = 0
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('压缩包目录损坏')
    const flags = buf.readUInt16LE(at + 8)
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const rawSize = buf.readUInt32LE(at + 24)
    const nameLength = buf.readUInt16LE(at + 28)
    const extraLength = buf.readUInt16LE(at + 30)
    const commentLength = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString(flags & 0x0800 ? 'utf8' : 'latin1')
    at += 46 + nameLength + extraLength + commentLength
    const path = safePath(name)
    if (!path) continue
    if (flags & 1) throw new Error(`${name} 加密了，不支持`)
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name} 的数据损坏`)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    total += rawSize
    if (total > MAX_TOTAL) throw new Error('压缩包解开后超过 1 GB')
    let bytes: Buffer
    if (method === 0) bytes = Buffer.from(data)
    else if (method === 8) bytes = inflateRawSync(data, { maxOutputLength: Math.max(rawSize, 1) })
    else throw new Error(`${name} 的压缩方式（${method}）不支持`)
    out.push({ path, bytes })
  }
  return out
}
