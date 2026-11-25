// End-to-end smoke test: starts the real API (fresh seeded SQLite DB) + the built web app, then drives Chromium.
// Usage: npm run build && npm run e2e        (needs backend/.venv — see README)
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, "../../backend");
const frontend = resolve(here, "..");
const fx = (n) => join(here, "fixtures", n);
const shots = process.env.SCREENSHOT_DIR || join(tmpdir(), "ri-e2e-shots");
mkdirSync(shots, { recursive: true });
const API = 8199, WEB = 4199, BASE = `http://127.0.0.1:${WEB}`;
const tmp = mkdtempSync(join(tmpdir(), "ri-e2e-"));
const procs = [];
const start = (cmd, args, opts) => { const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts }); let log = ""; p.stdout.on("data", (d) => (log += d)); p.stderr.on("data", (d) => (log += d)); p.log = () => log; procs.push(p); return p; };
const waitFor = async (url, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 300)); } throw new Error("Timed out waiting for " + url); };
let failed = 0;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) failed++; };

const api = start(join(backend, ".venv/bin/uvicorn"), ["main:app", "--port", String(API), "--host", "127.0.0.1"], {
  cwd: backend, env: { ...process.env, DATABASE_URL: `sqlite:///${join(tmp, "e2e.db")}`, UPLOAD_DIR: join(tmp, "uploads"), SEED_DEMO: "1", VISION_PROVIDER: "mock" } });
const web = start(join(frontend, "node_modules/.bin/vite"), ["preview", "--port", String(WEB), "--strictPort", "--host", "127.0.0.1"], { cwd: frontend, env: { ...process.env, API_URL: `http://127.0.0.1:${API}` } });

try {
  await waitFor(`http://127.0.0.1:${API}/api/health`);
  await waitFor(BASE);
  // CHROMIUM_PATH lets CI or a sandbox point at a preinstalled browser when the playwright package version differs
  const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const errors = [];

  // ---------- merchant app on a phone ----------
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const m = await ctx.newPage();
  globalThis.__page = m;
  m.on("pageerror", (e) => errors.push(e.message));
  const loginAs = async (page, email) => {
    const form = page.getByRole("form", { name: "Log in" });
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Password").fill("demo1234");
    await form.getByRole("button", { name: "Log in" }).click();
  };
  await m.goto(`${BASE}/store/capture`);
  await m.getByRole("form", { name: "Log in" }).waitFor();
  check(m.url().endsWith("/login"), "logged-out visitors are sent to the login page");
  await m.getByRole("form", { name: "Log in" }).getByLabel("Email").fill("nena@demo.kwaderno.ph");
  await m.getByRole("form", { name: "Log in" }).getByLabel("Password").fill("wrong-password");
  await m.getByRole("button", { name: "Log in" }).click();
  await m.getByRole("alert").filter({ hasText: "Wrong email or password" }).waitFor();
  check(true, "wrong password is refused");
  await loginAs(m, "nena@demo.kwaderno.ph");
  await m.getByRole("combobox", { name: "Store" }).waitFor();
  const opts = await m.getByRole("combobox", { name: "Store" }).locator("option").allInnerTexts();
  check(opts.length === 1 && opts[0] === "Aling Nena Sari-sari", "merchant only sees their own store");
  check(await m.getByText("Online").first().isVisible(), "online indicator shows Online");

  // photo capture -> review -> confirm
  await m.getByTestId("photo-input").setInputFiles(fx("shelf.jpg"));
  await m.getByRole("button", { name: "Analyse photo" }).click();
  await m.getByRole("button", { name: "Confirm & update stock" }).waitFor();
  const lines = await m.getByLabel("SKU").count();
  check(lines >= 3, `vision extracted ${lines} editable lines`);
  await m.getByLabel("Quantity").first().fill("7");
  await m.screenshot({ path: join(shots, "phone-review.png") });
  await m.getByRole("button", { name: "Confirm & update stock" }).click();
  await m.getByRole("status").filter({ hasText: /stock updated, \+10 points/ }).waitFor();
  check(true, "shelf capture confirmed, +10 points");
  // daily check-in: the ledger page completes today's pair -> bonus
  await m.getByTestId("checkin-card").waitFor();
  await m.getByText("Handwritten ledger").click();
  await m.getByTestId("photo-input").setInputFiles(fx("receipt.jpg"));
  await m.getByRole("button", { name: "Analyse photo" }).click();
  await m.getByRole("button", { name: "Confirm & update stock" }).click();
  await m.getByRole("status").filter({ hasText: /\+10 check-in bonus/ }).waitFor();
  check(true, "ledger + shelf photo on the same day earns the daily check-in bonus");
  await m.getByTestId("checkin-card").getByText("🔥 1-day streak").waitFor();
  check(true, "check-in card shows the streak");
  await m.getByText("Shelf photo").first().click();

  // duplicate is rejected
  await m.getByTestId("photo-input").setInputFiles(fx("shelf.jpg"));
  await m.getByRole("button", { name: "Analyse photo" }).click();
  await m.getByText("Duplicate photo.").waitFor();
  check(true, "re-submitting the same photo is rejected as duplicate");
  await m.getByRole("button", { name: "Take another photo" }).click();

  // blurry photo flagged
  await m.getByTestId("photo-input").setInputFiles(fx("blurry.jpg"));
  await m.getByRole("button", { name: "Analyse photo" }).click();
  await m.getByText("Low quality:").waitFor();
  check(true, "blurry low-resolution photo is flagged");
  await m.getByRole("button", { name: "Discard" }).click();

  // barcode: type + Enter (keyboard wedge / manual fallback), then +6
  await m.getByRole("tab", { name: /Barcode/ }).click();
  await m.getByLabel("Barcode or SKU").fill("COKE-MISMO");
  await m.getByLabel("Barcode or SKU").press("Enter");
  const result = m.getByTestId("scan-result");
  const notFound = m.getByText(/New barcode/);
  await Promise.race([result.waitFor(), notFound.waitFor()]);
  if (await result.isVisible()) {
    const before = Number((await result.locator(".chip").innerText()).split(" ")[0]);
    await result.getByRole("button", { name: "+6" }).click();
    await m.getByText(new RegExp(`: ${before + 6} on hand`)).waitFor();
    check(true, `barcode lookup + quick increment (${before} -> ${before + 6})`);
  } else check(true, "unknown code offers quick add");

  // manual quick add
  await m.getByRole("tab", { name: /Manual/ }).click();
  const form = m.getByRole("form", { name: "Quick add product" });
  await form.getByLabel("Product name").fill("Egg (per piece)");
  await form.getByLabel("Selling price (₱)").fill("9.5");
  await form.getByLabel("Stock now").fill("30");
  await form.getByRole("button", { name: "Add product" }).click();
  await m.getByText("Added Egg (per piece)").waitFor();
  check(true, "manual quick-add product");

  // offline: adjust is queued, then synced
  await ctx.setOffline(true);
  await m.evaluate(() => window.dispatchEvent(new Event("offline")));
  await m.getByLabel("Search products").fill("Egg");
  await m.getByLabel("Change for Egg (per piece)").fill("-4");
  await m.getByRole("button", { name: "Apply" }).first().click();
  await m.getByText(/26 on hand \(queued\)/).waitFor();
  check(await m.getByText("Offline").first().isVisible(), "offline indicator + change queued locally");
  await m.getByRole("link", { name: "Sync" }).click();
  check((await m.getByTestId("queue-list").locator("li").count()) === 1, "sync queue shows 1 pending change");
  await m.screenshot({ path: join(shots, "phone-offline-queue.png") });
  await ctx.setOffline(false);
  await m.evaluate(() => window.dispatchEvent(new Event("online")));
  await m.getByText("Everything is synced.").waitFor();
  const tok = (await (await fetch(`http://127.0.0.1:${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nena@demo.kwaderno.ph", password: "demo1234" }) })).json()).token;
  const egg = await (await fetch(`http://127.0.0.1:${API}/api/stores/1/products`, { headers: { Authorization: `Bearer ${tok}` } })).json();
  check(egg.find((p) => p.sku === "EGG-PER-PIECE")?.qty_on_hand === 26, "queued change reached the server once (26)");

  // restock order: draft -> submit
  await m.getByRole("link", { name: "Restock" }).click();
  await m.getByRole("button", { name: "Create draft from low stock" }).click();
  await m.getByText("Draft order created from low-stock items").waitFor();
  const card = m.locator("[data-testid^=order-]").filter({ hasText: "draft" }).first();
  await card.getByRole("button", { name: /Submit to/ }).click();
  await m.getByText(/Sent to /).waitFor();
  check(true, "draft order generated and submitted to distributor");

  // rewards
  await m.getByRole("link", { name: "Rewards" }).click();
  const pts = Number(await m.getByTestId("points-balance").innerText());
  check(pts >= 35, `rewards balance credited (${pts})`);
  await m.getByRole("link", { name: /Business score/ }).click();
  const score = Number((await m.getByTestId("cashflow-score").innerText()).split("/")[0]);
  check(score > 0 && score <= 100, `owner sees an explained business score (${score}/100)`);
  await m.screenshot({ path: join(shots, "phone-score.png"), fullPage: true });
  await m.screenshot({ path: join(shots, "phone-rewards.png") });
  let wide = [];
  for (const path of ["capture", "catalog", "orders", "online", "rewards", "sync", "account"]) {
    await m.goto(`${BASE}/store/${path}`); await m.waitForTimeout(400);
    if (await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) wide.push(path);
  }
  check(!wide.length, `no sideways scrolling on phone screens ${wide.join(",")}`);
  // ---------- online ordering: store opens its link, a customer orders without logging in ----------
  await m.goto(`${BASE}/store/online`);
  await m.getByLabel("Link name").waitFor();
  await m.getByLabel("Link name").fill("e2e-tindahan");
  await m.getByLabel(/Taking orders/).check();
  await m.getByLabel(/Delivery$/).check();
  await m.getByLabel("Delivery fee (₱)").fill("25");
  await m.getByRole("button", { name: "Save" }).click();
  const shopUrl = await m.getByTestId("shop-link").innerText();
  check(shopUrl.endsWith("/shop/e2e-tindahan"), `store gets a shareable link (${shopUrl})`);
  const cctx = await browser.newContext({ ...devices["Pixel 7 landscape"] });
  const c = await cctx.newPage();
  c.on("pageerror", (e) => errors.push(e.message));
  globalThis.__page = c;
  await c.goto(shopUrl);
  await c.getByTestId("shop-item").first().waitFor();
  check((await c.getByTestId("shop-item").count()) > 0, "customer sees the store menu without logging in (phone landscape)");
  await c.screenshot({ path: join(shots, "shop-landscape.png") });
  const first = c.getByTestId("shop-item").first();
  await first.getByRole("button", { name: /Add/ }).click();
  await first.getByRole("button", { name: /^More / }).click();
  await c.getByRole("button", { name: /Checkout/ }).click();
  await c.getByRole("radio", { name: /Delivery/ }).click();
  await c.getByLabel(/Name/).fill("Maria Santos");
  await c.getByLabel("Mobile number").fill("0917 555 1234");
  await c.getByLabel("Address").fill("Blk 3 Lot 5, Culiat");
  const total = await c.getByTestId("checkout-total").innerText();
  await c.getByRole("button", { name: /Place order/ }).click();
  await c.getByTestId("order-status").waitFor();
  check((await c.getByTestId("order-status-text").innerText()).includes("Received"), `customer gets an order code and live status (${total})`);
  await m.getByRole("button", { name: "Refresh" }).click();
  const co = m.getByTestId("customer-order").filter({ hasText: "Maria Santos" });
  await co.waitFor();
  check((await co.innerText()).includes("Blk 3 Lot 5"), "store sees the order with the delivery address");
  await m.screenshot({ path: join(shots, "phone-online-orders.png"), fullPage: true });
  for (const b of [/Accept/, /Ready/, /Complete/]) { await co.getByRole("button", { name: b }).click(); await m.waitForTimeout(500); }
  await m.getByText(/completed — stock updated/).waitFor();
  check(true, "store accepts → ready → completes the order (stock deducted)");
  await c.reload();
  await c.getByText(/Completed/).waitFor();
  check(true, "customer status page shows Completed");
  globalThis.__page = m;
  await cctx.close();

  await m.goto(`${BASE}/portal/overview`);
  await m.getByText("This area is for KELSON operations accounts.").waitFor();
  check(true, "merchant cannot open the operations portal");

  // ---------- operations portal on desktop ----------
  const d = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  d.on("pageerror", (e) => errors.push(e.message));
  await d.goto(`${BASE}/portal/overview`);
  await loginAs(d, "ops@demo.kwaderno.ph");
  await d.waitForURL(/\/store\/capture|\/portal/);
  await d.goto(`${BASE}/portal/overview`);
  await d.getByText("Share of shelf by brand").waitFor();
  check((await d.locator("#stores-h + table tbody tr, section:has(#stores-h) tbody tr").count()) === 4, "portal lists 4 stores");
  check((await d.locator("section:has(#sos-h) li").count()) > 0, "share-of-shelf computed");
  check((await d.locator("section:has(#stores-h) th", { hasText: "Cash-flow score" }).count()) === 1, "portal shows cash-flow scores per store");
  check((await d.locator("section:has(#oos-h) tbody tr").count()) > 0, "out-of-stock alerts listed");
  await d.screenshot({ path: join(shots, "portal-overview.png"), fullPage: true });
  await d.getByRole("link", { name: "Wholesale orders" }).click();
  const sub = d.locator("[data-testid^=order-]").first();
  await sub.waitFor();
  await sub.getByRole("button", { name: "Mark received (adds stock)" }).click();
  await d.getByText("Received — stock added").waitFor();
  check(true, "portal fulfils a submitted order");
  await d.getByRole("link", { name: "Verification log" }).click();
  await d.getByText(/Duplicate of #/).first().waitFor();
  check(true, "verification log shows duplicate flags");
  await d.screenshot({ path: join(shots, "portal-audit.png") });
  check(errors.length === 0, `no page errors ${errors.length ? JSON.stringify(errors) : ""}`);
  await browser.close();
} catch (e) {
  failed++;
  console.error("E2E ERROR:", e.message.split("\n").slice(0, 6).join("\n"));
  try { await globalThis.__page?.screenshot({ path: join(shots, "failure.png"), fullPage: true }); console.error("screenshot: " + join(shots, "failure.png")); } catch { /* browser gone */ }
  console.error("--- api log ---\n" + api.log().slice(-2000));
} finally {
  for (const p of procs) p.kill();
}
console.log(failed ? `\n${failed} check(s) failed` : `\nAll e2e checks passed. Screenshots: ${shots}`);
process.exit(failed ? 1 : 0);
