import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as createStoreRoute } from "@/app/api/v1/stores/route";
import { call, sessionCookieFrom } from "./api";

let n = 0;
export async function newMerchant(overrides: { email?: string; storeName?: string } = {}) {
  n++;
  const email = overrides.email ?? `owner${n}-${Date.now()}@example.ph`;
  const r = await call(register, { body: { fullName: `Owner ${n}`, email, password: "correct-horse-1" } });
  if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.json)}`);
  const cookie = sessionCookieFrom(r.cookie);
  const s = await call(createStoreRoute, { cookie, body: { name: overrides.storeName ?? `Tindahan ${n}` } });
  if (s.status !== 201) throw new Error(`store failed: ${JSON.stringify(s.json)}`);
  return { email, cookie, userId: r.json.data.user.id as string, storeId: s.json.data.id as string };
}
