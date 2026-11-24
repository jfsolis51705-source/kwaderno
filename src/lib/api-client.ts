/** Browser-side API helper. Surfaces server validation details to forms. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** Map of field -> message from a 422 response. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { path: string; message: string }[]) out[d.path] ??= d.message;
    const f = (this.details as { field?: string })?.field;
    if (f) out[f] = this.message;
    return out;
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "No internet connection. Please try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error ?? {};
    const err = new ApiError(res.status, e.code ?? "UNKNOWN", e.message ?? `Request failed (${res.status})`, e.details);
    if (e.details && !Array.isArray(e.details) && (e.details as { field?: string }).field) err.details = e.details;
    throw err;
  }
  return body?.data as T;
}
