import { authRoute, ok } from "@/server/http";
import { listPlatformStores } from "@/server/services/platform";

/** Platform admin only (403 otherwise). */
export const GET = authRoute(async (_req, { user }) => ok(await listPlatformStores(user.id)));
