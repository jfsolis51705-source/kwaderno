import "server-only";
import { after } from "next/server";

/**
 * Runs work after the response is sent (Next.js `after`). Outside a request scope
 * (scripts) it simply runs in the background. Set RECEIPT_AUTO_PROCESS=0 to disable
 * automatic receipt processing (tests call the processor directly).
 */
export function runInBackground(task: () => Promise<unknown>) {
  const safe = () => task().catch((e) => console.error("[kwaderno] background task failed", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}
