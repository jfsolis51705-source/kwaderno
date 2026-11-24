import { hash, verify } from "@node-rs/argon2";

// Argon2id with OWASP-recommended baseline parameters (19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string) {
  return hash(password, OPTS);
}

export async function verifyPassword(hashed: string, password: string) {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** A real hash of a random string, used to equalise timing when the email is unknown. */
let dummy: Promise<string> | null = null;
export function dummyHash() {
  dummy ??= hashPassword("kwaderno-timing-equaliser");
  return dummy;
}
