"use client";
import { api, ApiError } from "./api-client";
import { enqueue, type OpType } from "./offline-queue";

/**
 * Sends a write to the API, or — when there is no connection — keeps it in the
 * device queue to sync later. The idempotency key doubles as the operation ID,
 * so an online attempt that timed out and its offline copy can never both apply.
 */
export async function submitOrQueue<T>(o: {
  storeId: string;
  url: string;
  opType: OpType;
  payload: Record<string, unknown> & { idempotencyKey: string };
  summary: string;
}): Promise<{ queued: true } | { queued: false; data: T }> {
  const queue = async () => {
    const { idempotencyKey, ...rest } = o.payload;
    await enqueue({ operationId: idempotencyKey, storeId: o.storeId, opType: o.opType, payload: rest, summary: o.summary });
    return { queued: true as const };
  };
  if (typeof navigator !== "undefined" && !navigator.onLine) return queue();
  try {
    return { queued: false, data: await api<T>(o.url, { method: "POST", json: o.payload }) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) return queue();
    throw e;
  }
}
