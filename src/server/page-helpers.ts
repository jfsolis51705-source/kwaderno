import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "./errors";

/** In pages: turn a service NOT_FOUND into the Next.js 404 page. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
