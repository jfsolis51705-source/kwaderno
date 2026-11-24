import type { NextRequest } from "next/server";

/** True when a plain HTML form (no JavaScript) posted to an API route. */
export function isFormPost(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  return ct.startsWith("application/x-www-form-urlencoded") || ct.startsWith("multipart/form-data");
}

export async function formBody(req: NextRequest) {
  const fd = await req.formData();
  return Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
}

/** Same-site relative path only (prevents open redirects). */
export function safeNext(v: unknown, fallback: string) {
  return typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : fallback;
}
