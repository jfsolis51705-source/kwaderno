/**
 * Browser end-to-end checks against a running KWADERNO (production build recommended).
 *
 *   npm run build && npm start            # app on :3000, DB seeded with `npm run db:seed`
 *   (optional) AI service on AI_SERVICE_URL with RECEIPT_PROVIDER=mock
 *   node e2e/run.mjs                      # BASE_URL=http://localhost:3000 by default
 *   CHROMIUM_PATH=/path/to/chromium node e2e/run.mjs   # if Playwright browsers are not installed
 *   E2E_ADMIN_EMAIL=admin@kwaderno.ph node e2e/run.mjs  # also check the Super-Admin portal
 *
 * Uses the `playwright` package (Chromium). Exits non-zero on the first failure.
 * NOTE: it creates real records in the demo store — run against a dev/demo database only.
 */
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "demo@kwaderno.ph";
const PASSWORD = process.env.E2E_PASSWORD ?? "demo-tindahan";
const OUT = mkdtempSync(path.join(tmpdir(), "kwaderno-e2e-"));
const errors = [];
let passed = 0;

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${String(e.message).split("\n")[0]}`);
    process.exitCode = 1;
    throw e;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function login(ctx) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/login`);
  await p.waitForLoadState("networkidle");
  await p.fill("#email", EMAIL);
  await p.fill("#password", PASSWORD);
  await p.click("button[type=submit]");
  await p.waitForURL("**/dashboard");
  return p;
}
const api = (p, url, init) => p.evaluate(async ([u, i]) => (await (await fetch(u, i)).json()).data, [url, init]);

// CHROMIUM_PATH: use a system/pre-installed Chromium when the bundled Playwright browser is not downloaded.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {});
try {
  console.log(`KWADERNO e2e → ${BASE}`);
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await login(desktop);
  const storeId = (await api(p, "/api/v1/auth/me")).stores[0].id;
  const stock = async (q) => Number((await api(p, `/api/v1/stores/${storeId}/products?q=${encodeURIComponent(q)}`)).items[0]?.quantity);

  await step("layout: every page fits phone (360px) and desktop without sideways scroll or errors", async () => {
    const pages = ["/dashboard", "/sell", "/scan", "/products", "/products/new", "/stock-in", "/receipts", "/customers", "/sales", "/reports", "/reports?type=inventory", "/sync", "/audit", "/expiry", "/expiry/new", "/settings"];
    const phone = await browser.newContext({ ...devices["Galaxy S9+"], viewport: { width: 360, height: 740 } });
    const pp = await login(phone);
    for (const [ctxPage, label] of [[pp, "phone"], [p, "desktop"]]) {
      for (const url of pages) {
        await ctxPage.goto(BASE + url);
        await ctxPage.waitForLoadState("networkidle");
        const overflow = await ctxPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 1, `${label} ${url} overflows by ${overflow}px`);
        const h1 = await ctxPage.locator("main h1").first().textContent({ timeout: 10000 });
        assert(h1 && h1.trim().length > 0, `${label} ${url} has no heading`);
      }
    }
    await phone.close();
  });

  const name = `E2E Canton ${Date.now()}`;
  const code = "480" + String(Date.now()).slice(-10);
  await step("product: add with barcode and opening stock", async () => {
    await p.goto(`${BASE}/products/new?barcode=${code}`);
    await p.waitForLoadState("networkidle");
    await p.fill("#name", name);
    await p.fill("#unit", "pack");
    await p.fill("#sellingPrice", "16");
    await p.fill("#purchaseCost", "13.50");
    await p.fill("#openingQuantity", "10");
    await p.getByRole("button", { name: "Add product" }).last().click();
    await p.waitForURL(/\/products\/[0-9a-f-]{36}$/);
    assert((await stock(name)) === 10, "opening stock not 10");
  });

  await step("scan: typed barcode finds the product", async () => {
    await p.goto(`${BASE}/scan`);
    await p.waitForLoadState("networkidle");
    await p.fill('input[aria-label="Barcode"]', code);
    await p.click('button:has-text("Enter")');
    await p.waitForSelector(`text=${name}`);
  });

  await step("stock-in: delivery adds stock", async () => {
    await p.goto(`${BASE}/stock-in`);
    await p.waitForLoadState("networkidle");
    await p.fill('input[aria-label="Search products"]', name);
    await p.click("[role=option] button");
    await p.fill("#q-0", "5");
    await p.fill("#supplierName", "E2E Supplier");
    await p.click("text=Confirm stock-in");
    await p.waitForSelector("text=/Stock-in saved/");
    assert((await stock(name)) === 15, "stock not 15 after stock-in");
  });

  await step("sell: cash sale with change deducts stock", async () => {
    await p.goto(`${BASE}/sell`);
    await p.waitForLoadState("networkidle");
    await p.fill('input[aria-label="Search products"]', name);
    const tile = p.locator("ul[aria-label=Products] button", { hasText: name }).first();
    await tile.click();
    await tile.click();
    await p.fill("#tendered", "50");
    await p.locator("text=/Sukli: ₱18.00/").first().waitFor();
    await p.locator('button:has-text("Charge")').first().click();
    await p.waitForSelector("text=Sale complete");
    await p.click('button:has-text("New sale")');
    assert((await stock(name)) === 13, "stock not 13 after sale");
  });

  await step("utang: credit sale to a new customer, then partial payment", async () => {
    const cust = `E2E Customer ${Date.now()}`;
    await p.locator("ul[aria-label=Products] button", { hasText: name }).first().click();
    await p.locator('[role=radio]:has-text("Utang")').first().click();
    await p.fill('input[aria-label="Find customer"]', cust);
    await p.click(`button:has-text('Add “${cust}”')`);
    await p.locator('button:has-text("Record utang")').first().click();
    await p.waitForSelector("text=Utang recorded");
    await p.click('button:has-text("New sale")');
    await p.goto(`${BASE}/customers?q=${encodeURIComponent(cust)}`);
    await p.click(`a:has-text("${cust}")`);
    await p.click('button:has-text("Record payment")');
    await p.fill("#pay-amount", "6");
    await p.click('button:has-text("Record ₱6.00 payment")');
    await p.waitForSelector("text=Balance ₱10.00");
  });

  await step("receipt: upload → AI review → confirm (skipped if AI not configured)", async () => {
    const health = await api(p, "/api/health").catch(() => null);
    const res = await p.evaluate(async () => (await fetch("/api/health")).json());
    if (res.ai !== "ok") {
      console.log("    (AI service not reachable — skipping)");
      return;
    }
    void health;
    const img = await browser.newPage({ viewport: { width: 420, height: 300 } });
    await img.setContent(`<pre style="font:16px monospace;padding:16px">E2E RECEIPT ${Date.now()}\nMEGA SARDINES 155G 24 x 20.00</pre>`);
    const file = path.join(OUT, "receipt.png");
    await img.screenshot({ path: file });
    await img.close();
    await p.goto(`${BASE}/receipts`);
    await p.waitForLoadState("networkidle");
    await p.locator("input[type=file]:not([capture])").setInputFiles(file);
    await p.waitForURL(/\/receipts\/[0-9a-f-]{36}$/);
    await p.waitForSelector("text=Check each item", { timeout: 60000 });
    await p.click('button:has-text("Confirm stock-in")');
    await p.locator('[role=alertdialog] button:has-text("Confirm stock-in")').click();
    await p.waitForSelector("text=Stock-in recorded");
  });

  await step("offline: sale is queued on the device and syncs on reconnect", async () => {
    const before = (await api(p, `/api/v1/stores/${storeId}/sales?limit=1`)).total;
    await p.goto(`${BASE}/sell`);
    await p.waitForLoadState("networkidle");
    await desktop.setOffline(true);
    await p.fill('input[aria-label="Search products"]', name);
    await p.locator("ul[aria-label=Products] button", { hasText: name }).first().click();
    await p.locator('button:has-text("Charge")').first().click();
    await p.waitForSelector("text=Saved on this phone");
    await p.click('button:has-text("New sale")');
    await desktop.setOffline(false);
    await p.waitForFunction(() => !document.querySelector('header a[href="/sync"]'), null, { timeout: 45000 });
    const after = (await api(p, `/api/v1/stores/${storeId}/sales?limit=1`)).total;
    assert(after === before + 1, `expected ${before + 1} sales, got ${after}`);
  });

  await step("expiry: product photo → label photo → date, then dispose removes stock", async () => {
    const img = await browser.newPage({ viewport: { width: 200, height: 200 } });
    await img.setContent(`<div style="font:24px sans-serif;padding:20px">EXP 2026-01-01</div>`);
    const photoFile = path.join(OUT, "photo.png");
    await img.screenshot({ path: photoFile });
    await img.close();
    await p.goto(`${BASE}/expiry/new`);
    await p.waitForLoadState("networkidle");
    await p.fill('input[aria-label="Search products"]', name);
    await p.click("[role=option] button");
    const inputs = p.locator('input[type=file][capture]');
    await inputs.nth(0).setInputFiles(photoFile);
    await p.waitForSelector('img[alt="Take product photo"]');
    await inputs.nth(1).setInputFiles(photoFile);
    await p.waitForSelector('img[alt="Take label photo"]');
    const yesterday = new Date(Date.now() - 864e5 + 8 * 3600e3).toISOString().slice(0, 10);
    await p.fill('input[type=date]', yesterday);
    await p.locator("label", { hasText: "How many" }).locator("input").fill("2");
    await p.click('button:has-text("Save expiry")');
    await p.waitForURL("**/expiry");
    await p.waitForSelector("text=Expired — remove from shelf");
    const before = await stock(name);
    await p.locator("li", { hasText: name }).locator('button:has-text("Dispose")').click();
    await p.click('button:has-text("Remove 2")');
    await p.waitForSelector("text=/Removed 2/");
    assert((await stock(name)) === before - 2, "dispose did not remove 2 from stock");
  });

  await step("super-admin: overview and map for admins, 404 for merchants", async () => {
    const r = await p.goto(`${BASE}/admin`);
    assert(r.status() === 404 || (await p.content()).includes("404"), "merchant could open /admin");
    if (!process.env.E2E_ADMIN_EMAIL) {
      console.log("    (E2E_ADMIN_EMAIL not set — admin pages not checked)");
      return;
    }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await ctx.newPage();
    await a.goto(`${BASE}/login`);
    await a.waitForLoadState("networkidle");
    await a.fill("#email", process.env.E2E_ADMIN_EMAIL);
    await a.fill("#password", process.env.E2E_ADMIN_PASSWORD ?? PASSWORD);
    await a.click("button[type=submit]");
    await a.waitForURL(/\/(admin|dashboard)/);
    await a.goto(`${BASE}/admin`);
    await a.waitForSelector("text=Network overview");
    await a.goto(`${BASE}/admin/map`);
    await a.waitForSelector(".leaflet-container");
    await ctx.close();
  });

  await step("reports: CSV download", async () => {
    await p.goto(`${BASE}/reports?type=sales_by_product`);
    await p.waitForLoadState("networkidle");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click('a:has-text("Download CSV")')]);
    assert(dl.suggestedFilename().endsWith(".csv"), "not a CSV");
  });

  await step("security headers present", async () => {
    const r = await p.request.get(`${BASE}/login`);
    assert(r.headers()["x-frame-options"] === "DENY", "missing X-Frame-Options");
    assert((r.headers()["permissions-policy"] ?? "").includes("camera=(self)"), "missing Permissions-Policy");
  });

  assert(errors.length === 0, `page errors: ${errors.join(" | ")}`);
  console.log(`\nAll ${passed} e2e checks passed.`);
} catch {
  console.error(`\nE2E failed after ${passed} passing check(s).`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
