import { authRoute, ok } from "@/server/http";
import { getPlatformOverview } from "@/server/services/platform";

/** Platform admin only (403 otherwise). */
export const GET = authRoute(async (_req, { user }) => ok(await getPlatformOverview(user.id)));
