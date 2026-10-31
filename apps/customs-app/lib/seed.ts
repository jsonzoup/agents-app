import { readDb, updateDb } from "./db";
import { buildCodeRefs } from "./code-refs";

export async function backfillCodeRefs(): Promise<void> {
  const db = await readDb();
  if (!db.tasks.some((task) => task.draft && !task.codeRefs)) return;
  await updateDb(async (current) => {
    for (const task of current.tasks) {
      if (task.draft && !task.codeRefs) task.codeRefs = await buildCodeRefs(task);
    }
  });
}
