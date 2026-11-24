import { NextRequest } from "next/server";

type RouteFn = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<Response>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Calls a Next.js route handler in-process, like the real server would. */
export async function call(
  fn: RouteFn,
  opts: { method?: string; body?: unknown; cookie?: string; params?: Record<string, string>; headers?: Record<string, string>; path?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": "127.0.0.1", ...opts.headers });
  if (opts.cookie) headers.set("cookie", opts.cookie);
  const req = new NextRequest(new URL(opts.path ?? "/api/v1/test", "http://localhost:3000"), {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await fn(req, { params: Promise.resolve(opts.params ?? {}) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, res, cookie: res.headers.get("set-cookie") ?? "" };
}

export function sessionCookieFrom(setCookie: string) {
  const m = /kw_session=([^;]+)/.exec(setCookie);
  if (!m) throw new Error("no session cookie in response");
  return `kw_session=${m[1]}`;
}

/** Multipart upload to a route handler. */
export async function upload(fn: RouteFn, opts: { cookie: string; params: Record<string, string>; file: Buffer; filename?: string; type?: string }) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(opts.file)], { type: opts.type ?? "image/png" }), opts.filename ?? "receipt.png");
  const req = new NextRequest(new URL("/api/v1/test", "http://localhost:3000"), { method: "POST", headers: { cookie: opts.cookie, "x-forwarded-for": "127.0.0.1" }, body: form });
  const res = await fn(req, { params: Promise.resolve(opts.params) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
