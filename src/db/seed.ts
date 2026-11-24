/**
 * Demo seed: owner + staff, one store, and a catalog modelled on products seen on
 * real Quezon City sari-sari store shelves (field photos, June–Aug 2025).
 *
 * - Product names/brands come from the shelf photos. PRICES ARE ESTIMATES for demo
 *   use only, and NO BARCODES are seeded (we never invent barcode data).
 * - Stock is created through the real services so the ledger, purchases and
 *   dashboard look exactly as they would in use.
 * - Idempotent: skips the catalog if the store already has products.
 *
 *   npm run db:seed
 *   login: demo@kwaderno.ph / demo-tindahan   (staff: staff@kwaderno.ph, Super-Admin: admin@kwaderno.ph — same password)
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "./index";
import { products, storeMembers, stores, users } from "./schema";
import { hashPassword } from "@/server/auth/password";
import { createProduct } from "@/server/services/catalog";
import { recordAdjustment, recordStockIn } from "@/server/services/inventory";
import { createCustomer, recordCustomerPayment } from "@/server/services/customers";
import { createSale } from "@/server/services/sales";
import type { StoreContext } from "@/server/services/stores";

type Item = [name: string, brand: string, category: string, unit: string, pricePesos: number, stock: number, reorder: number, packaging?: string];

// Price = typical neighbourhood retail (estimate). Cost is set to ~85% of price below.
const CATALOG: Item[] = [
  // Canned fish & meat
  ["555 Tuna Mechado 155g", "555", "Canned goods", "can", 36, 18, 6],
  ["555 Tuna Adobo 155g", "555", "Canned goods", "can", 36, 14, 6],
  ["555 Tuna Caldereta 155g", "555", "Canned goods", "can", 36, 4, 6],
  ["555 Tuna Afritada 155g", "555", "Canned goods", "can", 36, 10, 6],
  ["555 Tuna Bicol Express 155g", "555", "Canned goods", "can", 38, 9, 6],
  ["555 Spanish Style Sardines 155g", "555", "Canned goods", "can", 42, 12, 6],
  ["Mega Sardines in Tomato Sauce 155g", "Mega", "Canned goods", "can", 24, 30, 12],
  ["Mega Sardines Green 155g", "Mega", "Canned goods", "can", 25, 16, 12],
  ["Ligo Sardines in Tomato Sauce 155g", "Ligo", "Canned goods", "can", 25, 8, 8],
  ["Hakkaido Mackerel in Natural Oil 155g", "Hakkaido", "Canned goods", "can", 32, 12, 6],
  ["Saba Squid in Soy Sauce 155g", "Saba", "Canned goods", "can", 34, 6, 4],
  ["Century Tuna Flakes in Oil 155g", "Century", "Canned goods", "can", 40, 10, 6],
  ["San Marino Corned Tuna 150g", "San Marino", "Canned goods", "can", 38, 12, 6],
  ["San Marino Chili Corned Tuna 150g", "San Marino", "Canned goods", "can", 38, 9, 6],
  ["Argentina Corned Beef 150g", "Argentina", "Canned goods", "can", 42, 15, 6],
  ["Argentina Meat Loaf 150g", "Argentina", "Canned goods", "can", 28, 11, 6],
  ["CDO Karne Norte 150g", "CDO", "Canned goods", "can", 35, 3, 6],
  ["CDO Beef Loaf 150g", "CDO", "Canned goods", "can", 26, 10, 6],
  ["CDO Luncheon Meat 165g", "CDO", "Canned goods", "can", 48, 6, 4],
  ["Star Nutri-Meats Beef Loaf 150g", "Purefoods", "Canned goods", "can", 27, 8, 4],
  ["Wow Ulam Adobo 155g", "Wow Ulam", "Canned goods", "can", 33, 12, 6],
  ["Wow Ulam Mechado 155g", "Wow Ulam", "Canned goods", "can", 33, 12, 6],
  ["Wow Ulam Menudo 155g", "Wow Ulam", "Canned goods", "can", 33, 9, 6],
  ["Wow Ulam Afritada 155g", "Wow Ulam", "Canned goods", "can", 33, 2, 6],
  // Milk & fruit
  ["Alaska Evaporada 370ml", "Alaska", "Milk", "can", 38, 8, 4],
  ["Alaska Condensada 300ml", "Alaska", "Milk", "can", 45, 5, 4],
  ["Alaska Classic Evaporated 370ml", "Alaska", "Milk", "can", 40, 6, 4],
  ["Cowbell Condensarap 300ml", "Cowbell", "Milk", "can", 32, 14, 4],
  ["Del Monte Fruit Cocktail 432g", "Del Monte", "Canned goods", "can", 72, 4, 2],
  ["Today's Mixed Fruit 432g", "Today's", "Canned goods", "can", 62, 5, 2],
  // Sachets — laundry & dish
  ["Surf Powder Cherry Blossom 65g", "Surf", "Laundry & cleaning", "sachet", 9, 60, 24],
  ["Downy Garden Bloom 24ml", "Downy", "Laundry & cleaning", "sachet", 8, 72, 24],
  ["Del Fabric Conditioner 25ml", "Del", "Laundry & cleaning", "sachet", 7, 36, 12],
  ["Joy Dishwashing Liquid Lemon 20ml", "Joy", "Laundry & cleaning", "sachet", 7, 48, 12],
  // Seasoning, coffee, drinks
  ["Maggi Magic Sarap 8g", "Maggi", "Seasoning", "sachet", 6, 70, 24],
  ["Nescafé Classic 2g", "Nescafé", "Coffee", "sachet", 3, 120, 40],
  ["Nestlé Coffee-mate 5g", "Nestlé", "Coffee", "sachet", 3, 60, 24],
  ["Tang Orange 19g", "Tang", "Drinks", "sachet", 22, 18, 10],
  ["Tang Pineapple 19g", "Tang", "Drinks", "sachet", 22, 7, 10],
  ["Nestea Lemon 25g", "Nestea", "Drinks", "sachet", 22, 12, 6],
  ["C2 Apple Green Tea 230ml", "C2", "Drinks", "bottle", 18, 24, 12],
  ["Datu Puti Soy Sauce 1L", "Datu Puti", "Condiments", "bottle", 48, 5, 3],
  ["Queen Baking Soda 100g", "Queen", "Baking", "pc", 25, 4, 2],
  // Personal care
  ["Colgate Toothpaste Regular 22ml", "Colgate", "Personal care", "pc", 22, 10, 6],
  ["Colgate Classic Toothbrush", "Colgate", "Personal care", "pc", 30, 6, 4],
  ["Sunsilk Co-Creations Shampoo 13ml", "Sunsilk", "Personal care", "sachet", 7, 48, 12],
  ["Pantene Pro-V Shampoo 12ml", "Pantene", "Personal care", "sachet", 8, 36, 12],
  ["Head & Shoulders Cool Menthol 12ml", "Head & Shoulders", "Personal care", "sachet", 8, 30, 12],
  ["Cream Silk Conditioner 11ml", "Cream Silk", "Personal care", "sachet", 8, 24, 12],
  ["Glamworks Permanent Hair Dye Black", "Glamworks", "Personal care", "pc", 65, 3, 2],
];

async function upsertUser(email: string, fullName: string, passwordHash: string) {
  const db = getDb();
  const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (existing) return existing;
  const [u] = await db.insert(users).values({ email, fullName, passwordHash }).returning();
  return u;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  const db = getDb();
  const hash = await hashPassword("demo-tindahan");
  const owner = await upsertUser("demo@kwaderno.ph", "Aling Nena Santos", hash);
  const staff = await upsertUser("staff@kwaderno.ph", "Jun Reyes", hash);
  // Demo KELSON system owner (Super-Admin portal at /admin). Not a member of any store.
  const admin = await upsertUser("admin@kwaderno.ph", "KELSON Admin (demo)", hash);
  await db.update(users).set({ isPlatformAdmin: true }).where(sql`${users.id} = ${admin.id}`);

  let [store] = await db.select().from(stores).where(sql`${stores.createdBy} = ${owner.id} and ${stores.name} = 'Nena''s Sari-sari Store'`);
  if (!store) {
    [store] = await db
      .insert(stores)
      // Location: Quezon Memorial Circle (public landmark), deliberately not near any real pilot store.
      .values({ name: "Nena's Sari-sari Store", ownerName: owner.fullName, barangay: "San Isidro", city: "Quezon City", province: "Metro Manila", latitude: "14.651600", longitude: "121.049300", createdBy: owner.id })
      .returning();
  }
  if (store.latitude == null) await db.update(stores).set({ latitude: "14.651600", longitude: "121.049300" }).where(sql`${stores.id} = ${store.id}`);
  await db.insert(storeMembers).values({ storeId: store.id, userId: owner.id, role: "owner" }).onConflictDoNothing();
  await db.insert(storeMembers).values({ storeId: store.id, userId: staff.id, role: "staff" }).onConflictDoNothing();

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(sql`${products.storeId} = ${store.id}`);
  if (n >= CATALOG.length) {
    console.log(`Store already has ${n} products — catalog seed skipped.`);
  } else {
    const ctx: StoreContext = { userId: owner.id, storeId: store.id, role: "owner" };
    const ids: Record<string, string> = {};
    for (const [name, brand, categoryName, unit, price, stock, reorder] of CATALOG) {
      const exists = await db.select({ id: products.id }).from(products).where(sql`${products.storeId} = ${store.id} and ${products.name} = ${name}`);
      if (exists[0]) {
        ids[name] = exists[0].id;
        continue;
      }
      const p = await createProduct(ctx, {
        name, brand, categoryName, unit,
        sellingPriceCentavos: price * 100,
        purchaseCostCentavos: Math.round(price * 85),
        reorderThreshold: reorder,
        openingQuantity: stock,
      });
      ids[name] = p.id;
    }

    // Packaging variant example: a strip (tira) of 12 Magic Sarap sachets, kept as its own stock.
    const tira = await db.select({ id: products.id }).from(products).where(sql`${products.storeId} = ${store.id} and ${products.name} = 'Maggi Magic Sarap 8g — tira of 12'`);
    if (!tira[0]) {
      await createProduct(ctx, {
        name: "Maggi Magic Sarap 8g — tira of 12", brand: "Maggi", categoryName: "Seasoning", unit: "tira",
        sellingPriceCentavos: 6800, purchaseCostCentavos: 6000, reorderThreshold: 1, openingQuantity: 3,
        packChildId: ids["Maggi Magic Sarap 8g"], packQuantity: 12,
      });
    }

    // A wholesale delivery and a damaged item, so the dashboard and histories show real movements.
    await recordStockIn(ctx, {
      supplierName: "Demo Wholesaler",
      referenceNo: "DEMO-0001",
      idempotencyKey: "seed-stock-in-0001",
      lines: [
        { productId: ids["Mega Sardines in Tomato Sauce 155g"], quantity: 24, unitCostCentavos: 2000 },
        { productId: ids["Nescafé Classic 2g"], quantity: 100, unitCostCentavos: 250 },
        { productId: ids["Surf Powder Cherry Blossom 65g"], quantity: 36, unitCostCentavos: 760 },
      ],
    });
    await recordAdjustment(ctx, {
      productId: ids["Alaska Condensada 300ml"], type: "damaged", quantity: 1, reason: "Dented can, not for sale", idempotencyKey: `seed-damaged-${randomUUID()}`,
    });
    // Demo customers, sales and utang (fictional people).
    const rosa = await createCustomer(ctx, { name: "Aling Rosa (demo)", phone: "09170000001", creditLimitCentavos: 50000 });
    await createCustomer(ctx, { name: "Kuya Ben (demo)" });
    const sell = (n: number, method: "cash" | "gcash" | "credit", lines: [string, number][], customerId?: string) =>
      createSale(ctx, {
        idempotencyKey: `seed-sale-${n}`, paymentMethod: method, customerId,
        referenceNo: method === "gcash" ? `DEMO${n}000` : null,
        lines: lines.map(([name, quantity]) => ({ productId: ids[name], quantity })),
      });
    await sell(1, "cash", [["Mega Sardines in Tomato Sauce 155g", 2], ["Nescafé Classic 2g", 4]]);
    await sell(2, "cash", [["Maggi Magic Sarap 8g", 3], ["Surf Powder Cherry Blossom 65g", 2], ["Downy Garden Bloom 24ml", 2]]);
    await sell(3, "gcash", [["Argentina Corned Beef 150g", 1], ["C2 Apple Green Tea 230ml", 2]]);
    await sell(4, "credit", [["555 Tuna Mechado 155g", 2], ["Alaska Evaporada 370ml", 1]], rosa.id);
    await sell(5, "credit", [["Datu Puti Soy Sauce 1L", 1]], rosa.id);
    await recordCustomerPayment(ctx, rosa.id, { amountCentavos: 5000, method: "cash", idempotencyKey: "seed-payment-1", note: "Partial payment" });
    console.log(`Seeded ${CATALOG.length + 1} demo products, 1 delivery, 1 damaged item, 2 customers, 5 sales and 1 utang payment.`);
  }
  console.log(`Store: ${store.name} (${store.id})\n  owner: demo@kwaderno.ph / demo-tindahan\n  staff: staff@kwaderno.ph / demo-tindahan\n  super-admin: admin@kwaderno.ph / demo-tindahan (open /admin)`);
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
