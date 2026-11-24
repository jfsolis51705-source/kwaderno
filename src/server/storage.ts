import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors";

/**
 * Private file storage on local disk (UPLOAD_DIR). Files are never served statically;
 * they are streamed through authorized API routes only. Swap for S3/Blob by keeping
 * this interface (save/read by relative key).
 */
// turbopackIgnore: upload paths are runtime data, not source files to trace into the server bundle.
const root = () => path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR ?? "./storage/uploads");
export const maxUploadBytes = () => Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
];

/** Identifies the real file type from its bytes (the browser-supplied type is not trusted). */
export function sniff(buf: Buffer) {
  const hit = SIGNATURES.find((s) => buf.length >= 12 && s.test(buf));
  if (!hit) throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Upload a JPG, PNG, WebP photo or a PDF");
  return hit;
}

export async function saveUpload(storeId: string, kind: "receipts" | "expiry", buf: Buffer) {
  if (buf.length === 0) throw new AppError("VALIDATION_ERROR", "The file is empty");
  if (buf.length > maxUploadBytes()) throw new AppError("PAYLOAD_TOO_LARGE", `File is larger than ${process.env.MAX_UPLOAD_MB ?? 10} MB`);
  const { mime, ext } = sniff(buf);
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) throw new AppError("VALIDATION_ERROR", "Invalid store");
  const key = path.posix.join("stores", storeId, kind, `${randomUUID()}.${ext}`);
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { flag: "wx", mode: 0o600 });
  return { key, mime, size: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
}

export async function readUpload(key: string) {
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new AppError("FORBIDDEN", "Invalid file path");
  return readFile(full);
}
