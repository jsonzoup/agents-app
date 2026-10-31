import path from "node:path";
import { pathToFileURL } from "node:url";

type Handler = (req: Request) => Promise<Response>;

const holder = globalThis as unknown as { __rsiConsole?: Promise<Handler> };

/**
 * The console core runs as plain Node TypeScript, outside the bundle: the kernel spawns app
 * judges and validators at runtime and must see real files, exactly as in its tests.
 */
export function core(): Promise<Handler> {
  holder.__rsiConsole ??= (async () => {
    const repo = path.resolve(process.cwd(), "../..");
    const entry = pathToFileURL(path.join(repo, "console/core/http.ts")).href;
    const mod = (await import(/* webpackIgnore: true */ entry)) as { start: (repo: string) => Promise<Handler> };
    return mod.start(repo);
  })();
  return holder.__rsiConsole;
}

export async function forward(req: Request): Promise<Response> {
  return (await core())(req);
}
