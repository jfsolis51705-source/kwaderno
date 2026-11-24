import { AppError } from "./errors";

/**
 * Fixed-window in-memory rate limiter. Good enough for a single app instance / pilot.
 * For multiple instances swap this for Redis (same interface).
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  if (process.env.DISABLE_RATE_LIMIT === "1") return;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > limit) {
    const retry = Math.ceil((b.resetAt - now) / 1000);
    throw new AppError("RATE_LIMITED", `Too many attempts. Try again in ${retry} seconds.`, { retryAfterSeconds: retry });
  }
}

export function resetRateLimits() {
  buckets.clear();
}
