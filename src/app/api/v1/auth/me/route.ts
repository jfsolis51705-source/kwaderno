import { authRoute, ok } from "@/server/http";
import { listMyStores } from "@/server/services/stores";

export const GET = authRoute(async (_req, { user }) => {
  return ok({ user: { id: user.id, email: user.email, fullName: user.fullName }, stores: await listMyStores(user.id) });
});
