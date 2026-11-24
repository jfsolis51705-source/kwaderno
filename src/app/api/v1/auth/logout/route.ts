import { NextResponse, type NextRequest } from "next/server";
import { deleteSession, SESSION_COOKIE, STORE_COOKIE } from "@/server/auth/session";
import { errorResponse } from "@/server/http";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (token) await deleteSession(token);
    const res = NextResponse.json({ data: { ok: true } });
    res.cookies.delete(SESSION_COOKIE);
    res.cookies.delete(STORE_COOKIE);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
