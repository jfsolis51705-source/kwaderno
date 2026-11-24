import { z } from "zod";
import { ok, storeRoute } from "@/server/http";
import { getDashboard, storeToday } from "@/server/services/dashboard";

const q = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const GET = storeRoute(async (req, { store }) => {
  const p = q.parse(Object.fromEntries(req.nextUrl.searchParams));
  const today = await storeToday(store);
  const from = p.from ?? today;
  const to = p.to ?? from;
  return ok(await getDashboard(store, { from: from <= to ? from : to, to: from <= to ? to : from }));
});
