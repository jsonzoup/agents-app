/**
 * OS-level confinement for one harness process. The harness's own sandbox only limits
 * writes, so an agent could still read anything the user can; confinement hides whole
 * directories (contents unreadable, names unlistable) except what the run may see.
 *
 * Only macOS Seatbelt (`sandbox-exec`) is implemented. Seatbelt does not nest, so a confined
 * process runs the harness with its inner sandbox off and this profile also carries the
 * write rules.
 */

import { spawnSync } from 'node:child_process'

export interface Confinement {
  /** Directories whose contents are hidden (no reading, listing or writing). */
  hide: string[]
  /** Directories and files inside hidden ones that stay readable. */
  read: string[]
  /** Directories where writing is refused, except under `write`. */
  readOnly: string[]
  /** Directories that stay writable (also readable). */
  write: string[]
}

export interface ConfinedCommand {
  command: string
  args: string[]
  env: Record<string, string>
}

const sbpl = (path: string) => JSON.stringify(path)

/** The Seatbelt profile; later rules win, so allowances come after denials. */
export function seatbeltProfile(c: Confinement): string {
  return [
    '(version 1)',
    '(allow default)',
    ...c.hide.map((p) => `(deny file-read-data file-write* (subpath ${sbpl(p)}))`),
    ...c.readOnly.map((p) => `(deny file-write* (subpath ${sbpl(p)}))`),
    ...c.read.map((p) => `(allow file-read-data (subpath ${sbpl(p)}))`),
    ...c.write.map((p) => `(allow file-read-data file-write* (subpath ${sbpl(p)}))`),
  ].join('\n')
}

let usable: boolean | undefined

/** Whether this host can confine a process. */
export function canConfine(): boolean {
  if (usable === undefined) {
    usable = process.platform === 'darwin' && spawnSync('sandbox-exec', ['-p', '(version 1)(allow default)', '--', 'true']).status === 0
  }
  return usable
}

/**
 * The command prefix that runs a harness confined, or null when the host cannot.
 * @returns `sandbox-exec -p <profile> --` plus the env that turns the harness's inner sandbox off.
 */
export function confinedCommand(c: Confinement): ConfinedCommand | null {
  if (!canConfine()) return null
  return { command: 'sandbox-exec', args: ['-p', seatbeltProfile(c), '--'], env: { DSH_PERMISSION_MODE: 'danger-full-access' } }
}
