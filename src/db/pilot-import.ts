/**
 * Loads the normalised pilot merchant list into the database (idempotent).
 *
 *   npm run pilot:normalize   # KML + XLSX in data/private/ -> data/private/pilot-merchants.json
 *   npm run pilot:import      # JSON -> pilot_merchants table, then re-matches existing stores
 *
 * The data files are git-ignored. Never copy them into the repository.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "./index";
import { importPilotMerchants, matchStoreToPilot } from "@/server/services/pilot";

async function main() {
  const file = process.argv[2] ?? "data/private/pilot-merchants.json";
  const rows = JSON.parse(readFileSync(file, "utf8"));
  const r = await importPilotMerchants(rows);
  console.log(`Pilot merchants: ${r.inserted} inserted, ${r.updated} updated (${r.total} in file)`);
  // Stores that already have a GPS fix but no pilot link get a chance to match now.
  const unmatched = await getDb().execute<{ id: string; latitude: string; longitude: string }>(
    sql`select id, latitude, longitude from stores where latitude is not null and pilot_merchant_id is null and deleted_at is null`,
  );
  let matched = 0;
  for (const s of unmatched.rows) {
    if (await getDb().transaction((tx) => matchStoreToPilot(tx, s.id, Number(s.latitude), Number(s.longitude)))) matched++;
  }
  console.log(`Existing stores newly matched to a pilot pin: ${matched}`);
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
