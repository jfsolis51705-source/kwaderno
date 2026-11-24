import { ZodError } from "zod";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INSUFFICIENT_STOCK"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_STOCK: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/** Domain error carrying an HTTP-mappable code. Messages are safe to show to merchants. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have access to this store") => new AppError("FORBIDDEN", msg);

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function toErrorBody(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  }
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: {
        error: {
          code: "VALIDATION_ERROR",
          message: "Please check the highlighted fields",
          details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
    };
  }
  // Postgres unique violation that slipped through service-level checks
  const pg = err as { code?: string; constraint?: string };
  if (pg?.code === "23505") {
    return { status: 409, body: { error: { code: "CONFLICT", message: "This record already exists", details: { constraint: pg.constraint } } } };
  }
  console.error("[kwaderno] unhandled error", err);
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } } };
}
