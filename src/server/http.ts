import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { AppError, toErrorBody } from "./errors";
import { getSessionUser, SESSION_COOKIE, type SessionUser } from "./auth/session";
import { requireStoreAccess, type StoreContext } from "./services/stores";
import type { Role } from "@/lib/validation";

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function sessionToken(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.cookies.get(SESSION_COOKIE)?.value;
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated mutations: the Origin header must match
 * the request host (or APP_URL). Bearer-token clients are not subject to CSRF.
 */
function assertSameOrigin(req: NextRequest) {
  if (SAFE.has(req.method)) return;
  if (req.headers.get("authorization")?.startsWith("Bearer ")) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, tests) do not send Origin; SameSite=Lax still applies
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const allowed = new Set<string>();
  if (host) allowed.add(host);
  if (process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).host);
  if (!allowed.has(new URL(origin).host)) throw new AppError("FORBIDDEN", "Cross-site request blocked");
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON");
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/** Public endpoint (no session required). */
export function publicRoute<P>(fn: (req: NextRequest, params: P) => Promise<Response>) {
  return async (req: NextRequest, rc: { params: Promise<P> }) => {
    try {
      assertSameOrigin(req);
      return await fn(req, await rc.params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Requires a logged-in user. */
export function authRoute<P>(fn: Handler<{ user: SessionUser; params: P; ip: string }>) {
  return async (req: NextRequest, rc: { params: Promise<P> }) => {
    try {
      assertSameOrigin(req);
      const user = await getSessionUser(sessionToken(req));
      if (!user) throw new AppError("UNAUTHENTICATED", "Please log in");
      return await fn(req, { user, params: await rc.params, ip: clientIp(req) });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Requires a logged-in member of the `[storeId]` in the URL with at least `minRole`. */
export function storeRoute<P extends { storeId: string }>(
  fn: Handler<{ user: SessionUser; params: P; store: StoreContext }>,
  minRole: Role = "staff",
) {
  return authRoute<P>(async (req, { user, params, ip }) => {
    const store = await requireStoreAccess(user.id, params.storeId, minRole);
    store.ip = ip;
    return fn(req, { user, params, store });
  });
}

export function errorResponse(e: unknown) {
  // Let Next.js control-flow errors (prerender bail-out, redirect, notFound) propagate.
  unstable_rethrow(e);
  const { status, body } = toErrorBody(e);
  const res = NextResponse.json(body, { status });
  const retry = (body.error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  if (status === 429 && retry) res.headers.set("Retry-After", String(retry));
  return res;
}
