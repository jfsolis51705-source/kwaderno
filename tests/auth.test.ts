import { describe, expect, it } from "vitest";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { getPool } from "@/db";
import { NextRequest } from "next/server";
import { call, sessionCookieFrom } from "./helpers/api";

const valid = { fullName: "Aling Nena", email: "Nena@Example.ph", password: "sari-sari-2026" };

describe("registration and login", () => {
  it("registers, hashes the password, and starts a session", async () => {
    const r = await call(register, { body: valid });
    expect(r.status).toBe(201);
    expect(r.json.data.user.email).toBe("nena@example.ph");
    expect(r.cookie).toMatch(/kw_session=.+HttpOnly/i);

    const { rows } = await getPool().query("select password_hash from users");
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0].password_hash).not.toContain(valid.password);
    // only the hash of the session token is stored
    const token = sessionCookieFrom(r.cookie).split("=")[1];
    const s = await getPool().query("select token_hash from sessions");
    expect(s.rows[0].token_hash).not.toBe(token);

    const m = await call(me, { cookie: sessionCookieFrom(r.cookie) });
    expect(m.status).toBe(200);
    expect(m.json.data.user.fullName).toBe("Aling Nena");
  });

  it("rejects duplicate email case-insensitively", async () => {
    await call(register, { body: valid });
    const r = await call(register, { body: { ...valid, email: "NENA@example.ph" } });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe("CONFLICT");
  });

  it("validates input with field details", async () => {
    const r = await call(register, { body: { fullName: "A", email: "nope", password: "short" } });
    expect(r.status).toBe(422);
    const paths = r.json.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["fullName", "email", "password"]));
  });

  it("logs in with correct password and refuses a wrong one with a generic error", async () => {
    await call(register, { body: valid });
    const good = await call(login, { body: { email: "nena@example.ph", password: valid.password } });
    expect(good.status).toBe(200);
    expect(good.json.data.token).toBeUndefined();
    const bad = await call(login, { body: { email: "nena@example.ph", password: "wrong-password" } });
    const unknown = await call(login, { body: { email: "ghost@example.ph", password: "wrong-password" } });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.json.error.message).toBe(unknown.json.error.message);
  });

  it("rate-limits repeated failed logins for one email", async () => {
    await call(register, { body: valid });
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await call(login, { body: { email: valid.email, password: "bad-password" } })).status;
    expect(last).toBe(429);
  });

  it("logout invalidates the session server-side", async () => {
    const r = await call(register, { body: valid });
    const cookie = sessionCookieFrom(r.cookie);
    await call(logout, { method: "POST", cookie });
    const m = await call(me, { cookie });
    expect(m.status).toBe(401);
  });

  it("blocks cross-origin cookie mutations (CSRF)", async () => {
    const r = await call(register, { body: valid, headers: { origin: "https://evil.example", host: "localhost:3000" } });
    expect(r.status).toBe(403);
  });

  it("plain HTML form login (before JavaScript loads) uses POST + redirect and never echoes credentials", async () => {
    await call(register, { body: valid });
    const form = (email: string, password: string, next = "/products") =>
      new NextRequest("http://localhost:3000/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost:3000", host: "localhost:3000", "x-forwarded-for": "127.0.0.2" },
        body: new URLSearchParams({ email, password, next }).toString(),
      });
    const ok = await login(form("nena@example.ph", valid.password), { params: Promise.resolve({}) });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("http://localhost:3000/onboarding"); // no store yet
    expect(ok.headers.get("set-cookie")).toMatch(/kw_session=/);
    const bad = await login(form("nena@example.ph", "nope-nope"), { params: Promise.resolve({}) });
    expect(bad.headers.get("location")).toBe("http://localhost:3000/login?error=invalid");
    expect(bad.headers.get("location")).not.toContain("nope");
    const evil = await login(form("nena@example.ph", valid.password, "//evil.example"), { params: Promise.resolve({}) });
    expect(new URL(evil.headers.get("location")!).host).toBe("localhost:3000");
  });
});
