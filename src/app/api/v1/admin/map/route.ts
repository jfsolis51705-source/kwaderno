import { authRoute, ok } from "@/server/http";
import { getNetworkMap } from "@/server/services/platform";

/** Platform admin only (403 otherwise). */
export const GET = authRoute(async (_req, { user }) => ok(await getNetworkMap(user.id)));
