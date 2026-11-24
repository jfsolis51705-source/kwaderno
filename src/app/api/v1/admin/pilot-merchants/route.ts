import { authRoute, ok } from "@/server/http";
import { listPilotMerchants } from "@/server/services/pilot";

/** Platform-admin only. Contains personal data of surveyed merchants. */
export const GET = authRoute(async (_req, { user }) => ok(await listPilotMerchants(user.id)));
