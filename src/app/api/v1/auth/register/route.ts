import { NextResponse } from "next/server";
import { clientIp, publicRoute, readJson } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { registerUser } from "@/server/services/auth";
import { cookieOptions, createSession, SESSION_COOKIE } from "@/server/auth/session";
import { formBody, isFormPost } from "@/server/form-post";

export const POST = publicRoute(async (req) => {
  const ip = clientIp(req);
  const html = isFormPost(req);
  rateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
  try {
    const user = await registerUser(html ? await formBody(req) : await readJson(req), ip);
    const { token, expiresAt } = await createSession(user.id, { userAgent: req.headers.get("user-agent"), ip });
    const res = html ? NextResponse.redirect(new URL("/onboarding", req.url), 303) : NextResponse.json({ data: { user } }, { status: 201 });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
    return res;
  } catch (e) {
    if (html) return NextResponse.redirect(new URL("/register?error=1", req.url), 303);
    throw e;
  }
});
