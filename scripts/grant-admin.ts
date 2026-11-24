/**
 * Grants (or revokes) KELSON platform-admin access.
 *   npm run admin:grant -- someone@example.com          # grant
 *   npm run admin:grant -- someone@example.com --revoke # revoke
 */
import { getPool } from "../src/db";

async function main() {
  const email = process.argv[2];
  const revoke = process.argv.includes("--revoke");
  if (!email) throw new Error("Usage: npm run admin:grant -- <email> [--revoke]");
  const r = await getPool().query("update users set is_platform_admin = $2 where lower(email) = lower($1) returning email", [email, !revoke]);
  console.log(r.rowCount ? `${revoke ? "Revoked" : "Granted"} platform admin: ${r.rows[0].email}` : `No user with email ${email}`);
  await getPool().end();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
