import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { AppError } from "@/server/errors";
import type { StoreContext } from "./stores";

/**
 * All reports are computed from the ledgers at request time (no stored figures).
 * Each report returns typed columns so the same data renders as a table or CSV.
 */
export type ColumnType = "text" | "money" | "qty" | "int" | "date" | "datetime";
export interface Column { key: string; label: string; type: ColumnType }
export interface Report { type: ReportType; title: string; dated: boolean; columns: Column[]; rows: Record<string, unknown>[]; totals?: Record<string, number> }

export const REPORT_TYPES = ["daily_sales", "sales_by_product", "sales_by_payment", "inventory", "low_stock", "purchases", "utang", "movements"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_TITLES: Record<ReportType, string> = {
  daily_sales: "Daily sales",
  sales_by_product: "Sales by product",
  sales_by_payment: "Sales by payment method",
  inventory: "Inventory",
  low_stock: "Low stock",
  purchases: "Purchases (stock-in)",
  utang: "Customer utang",
  movements: "Inventory movements",
};

const query = z.object({ from: z.iso.date(), to: z.iso.date() });

export async function runReport(ctx: StoreContext, type: string, params: { from?: string; to?: string }): Promise<Report> {
  if (!REPORT_TYPES.includes(type as ReportType)) throw new AppError("NOT_FOUND", "Unknown report");
  const t = type as ReportType;
  const { from, to } = query.parse(params);
  if (from > to) throw new AppError("VALIDATION_ERROR", "Start date is after end date");
  const s = ctx.storeId;
  const tz = sql`(select timezone from stores where id = ${s})`;
  const inRange = (col: SQL) => sql`${col} >= (${from}::date)::timestamp at time zone ${tz} and ${col} < ((${to}::date + 1))::timestamp at time zone ${tz}`;
  const db = getDb();
  const rows = async (q: SQL) => (await db.execute(q)).rows as Record<string, unknown>[];
  const num = (r: Record<string, unknown>[], keys: string[]) => r.map((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, x[k] == null ? null : Number(x[k])])) }));
  const sum = (r: Record<string, unknown>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, r.reduce((a, x) => a + (Number(x[k]) || 0), 0)]));

  switch (t) {
    case "daily_sales": {
      const r = num(
        await rows(sql`
          select to_char(sa.occurred_at at time zone ${tz}, 'YYYY-MM-DD') as day, count(*) as transactions,
            coalesce(sum(total_centavos) filter (where payment_method = 'cash'), 0) as cash,
            coalesce(sum(total_centavos) filter (where payment_method = 'gcash'), 0) as gcash,
            coalesce(sum(total_centavos) filter (where payment_method = 'credit'), 0) as utang,
            coalesce(sum(discount_centavos), 0) as discount, coalesce(sum(total_centavos), 0) as total,
            coalesce(sum(total_centavos), 0) - coalesce(sum((select sum(round(si.quantity * si.unit_cost_centavos)) from sale_items si where si.sale_id = sa.id)), 0) as gross_profit
          from sales sa where sa.store_id = ${s} and sa.status = 'completed' and ${inRange(sql`sa.occurred_at`)}
          group by 1 order by 1`),
        ["transactions", "cash", "gcash", "utang", "discount", "total", "gross_profit"],
      );
      return {
        type: t, title: REPORT_TITLES[t], dated: true, rows: r,
        columns: [
          { key: "day", label: "Date", type: "date" }, { key: "transactions", label: "Sales", type: "int" }, { key: "cash", label: "Cash", type: "money" },
          { key: "gcash", label: "GCash", type: "money" }, { key: "utang", label: "Utang", type: "money" }, { key: "discount", label: "Discounts", type: "money" },
          { key: "total", label: "Total", type: "money" }, { key: "gross_profit", label: "Gross profit", type: "money" },
        ],
        totals: sum(r, ["transactions", "cash", "gcash", "utang", "discount", "total", "gross_profit"]),
      };
    }
    case "sales_by_product": {
      const r = num(
        await rows(sql`
          select si.product_name as product, p.unit, sum(si.quantity) as quantity, sum(si.line_total_centavos) as revenue,
            sum(round(si.quantity * si.unit_cost_centavos)) as cost, sum(si.line_total_centavos) - sum(round(si.quantity * si.unit_cost_centavos)) as profit
          from sale_items si join sales sa on sa.id = si.sale_id join products p on p.id = si.product_id
          where sa.store_id = ${s} and sa.status = 'completed' and ${inRange(sql`sa.occurred_at`)}
          group by si.product_id, si.product_name, p.unit order by revenue desc`),
        ["quantity", "revenue", "cost", "profit"],
      );
      return {
        type: t, title: REPORT_TITLES[t], dated: true, rows: r,
        columns: [
          { key: "product", label: "Product", type: "text" }, { key: "quantity", label: "Qty sold", type: "qty" }, { key: "unit", label: "Unit", type: "text" },
          { key: "revenue", label: "Revenue", type: "money" }, { key: "cost", label: "Cost", type: "money" }, { key: "profit", label: "Profit", type: "money" },
        ],
        totals: sum(r, ["revenue", "cost", "profit"]),
      };
    }
    case "sales_by_payment": {
      const r = num(
        await rows(sql`
          select case payment_method when 'credit' then 'Utang' when 'gcash' then 'GCash' else 'Cash' end as method, count(*) as transactions, sum(total_centavos) as total
          from sales where store_id = ${s} and status = 'completed' and ${inRange(sql`occurred_at`)} group by payment_method order by total desc`),
        ["transactions", "total"],
      );
      const payments = num(
        await rows(sql`select coalesce(sum(amount_centavos), 0) as collected from payments where store_id = ${s} and sale_id is null and ${inRange(sql`created_at`)}`),
        ["collected"],
      );
      if (Number(payments[0].collected) > 0) r.push({ method: "Utang payments collected", transactions: null, total: payments[0].collected });
      return {
        type: t, title: REPORT_TITLES[t], dated: true, rows: r,
        columns: [{ key: "method", label: "Payment method", type: "text" }, { key: "transactions", label: "Sales", type: "int" }, { key: "total", label: "Amount", type: "money" }],
      };
    }
    case "inventory":
    case "low_stock": {
      const r = num(
        await rows(sql`
          select p.name as product, c.name as category, p.unit, coalesce(b.quantity, 0) as stock, p.reorder_threshold as reorder_level,
            p.purchase_cost_centavos as cost, p.selling_price_centavos as price, round(greatest(coalesce(b.quantity, 0), 0) * p.purchase_cost_centavos) as value,
            case when coalesce(b.quantity, 0) <= 0 then 'Out of stock' when coalesce(b.quantity, 0) <= p.reorder_threshold then 'Low' else 'OK' end as status
          from products p left join inventory_balances b on b.product_id = p.id left join categories c on c.id = p.category_id
          where p.store_id = ${s} and p.archived_at is null ${t === "low_stock" ? sql`and coalesce(b.quantity, 0) <= p.reorder_threshold` : sql``}
          order by ${t === "low_stock" ? sql`coalesce(b.quantity, 0) - p.reorder_threshold, ` : sql``} lower(p.name)`),
        ["stock", "reorder_level", "cost", "price", "value"],
      );
      return {
        type: t, title: REPORT_TITLES[t], dated: false, rows: r,
        columns: [
          { key: "product", label: "Product", type: "text" }, { key: "category", label: "Category", type: "text" }, { key: "stock", label: "Stock", type: "qty" },
          { key: "unit", label: "Unit", type: "text" }, { key: "reorder_level", label: "Reorder at", type: "qty" }, { key: "cost", label: "Cost", type: "money" },
          { key: "price", label: "Price", type: "money" }, { key: "value", label: "Value at cost", type: "money" }, { key: "status", label: "Status", type: "text" },
        ],
        totals: sum(r, ["value"]),
      };
    }
    case "purchases": {
      const r = num(
        await rows(sql`
          select pu.purchase_date::text as date, sp.name as supplier, pu.reference_no as reference, (select count(*) from purchase_items pi where pi.purchase_id = pu.id) as items,
            pu.total_centavos as total, case when pu.receipt_id is not null then 'Receipt scan' else 'Manual' end as source, u.full_name as recorded_by
          from purchases pu left join suppliers sp on sp.id = pu.supplier_id left join users u on u.id = pu.created_by
          where pu.store_id = ${s} and pu.status = 'completed' and pu.purchase_date between ${from}::date and ${to}::date
          order by pu.purchase_date desc, pu.created_at desc`),
        ["items", "total"],
      );
      return {
        type: t, title: REPORT_TITLES[t], dated: true, rows: r,
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "supplier", label: "Supplier", type: "text" }, { key: "reference", label: "Ref no.", type: "text" },
          { key: "items", label: "Lines", type: "int" }, { key: "total", label: "Total", type: "money" }, { key: "source", label: "Source", type: "text" }, { key: "recorded_by", label: "Recorded by", type: "text" },
        ],
        totals: sum(r, ["total"]),
      };
    }
    case "utang": {
      const r = num(
        await rows(sql`
          select c.name as customer, c.phone, c.balance_centavos as balance, c.credit_limit_centavos as credit_limit,
            (select max(created_at) from customer_ledger l where l.customer_id = c.id and l.entry_type = 'payment') as last_payment,
            (select max(created_at) from customer_ledger l where l.customer_id = c.id and l.entry_type = 'credit_sale') as last_credit
          from customers c where c.store_id = ${s} and c.deleted_at is null and c.balance_centavos <> 0 order by c.balance_centavos desc`),
        ["balance", "credit_limit"],
      );
      return {
        type: t, title: REPORT_TITLES[t], dated: false, rows: r,
        columns: [
          { key: "customer", label: "Customer", type: "text" }, { key: "phone", label: "Mobile", type: "text" }, { key: "balance", label: "Balance", type: "money" },
          { key: "credit_limit", label: "Limit", type: "money" }, { key: "last_credit", label: "Last utang", type: "datetime" }, { key: "last_payment", label: "Last payment", type: "datetime" },
        ],
        totals: sum(r, ["balance"]),
      };
    }
    case "movements": {
      const r = num(
        await rows(sql`
          select t.created_at as time, p.name as product, t.type, t.quantity_delta as change, t.balance_after, p.unit, t.reason, u.full_name as user_name
          from inventory_transactions t join products p on p.id = t.product_id left join users u on u.id = t.created_by
          where t.store_id = ${s} and ${inRange(sql`t.created_at`)} order by t.created_at desc limit 5000`),
        ["change", "balance_after"],
      );
      return {
        type: t, title: REPORT_TITLES[t], dated: true, rows: r,
        columns: [
          { key: "time", label: "Time", type: "datetime" }, { key: "product", label: "Product", type: "text" }, { key: "type", label: "Type", type: "text" },
          { key: "change", label: "Change", type: "qty" }, { key: "balance_after", label: "Balance after", type: "qty" }, { key: "unit", label: "Unit", type: "text" },
          { key: "reason", label: "Reason", type: "text" }, { key: "user_name", label: "By", type: "text" },
        ],
      };
    }
  }
}

const manila = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

/** Plain-value formatting shared by CSV (money as decimal pesos, no currency symbol). */
export function cellValue(v: unknown, type: ColumnType): string {
  if (v == null) return "";
  switch (type) {
    case "money": return (Number(v) / 100).toFixed(2);
    case "qty": return String(Number(v));
    case "int": return String(Number(v));
    case "datetime": return manila.format(new Date(v as string)).replace(",", "");
    default: return String(v);
  }
}

/** RFC 4180 CSV with spreadsheet formula-injection protection. */
export function toCsv(report: Report) {
  const esc = (s: string) => {
    let v = s;
    if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = `'${v}`; // neutralise =HYPERLINK(...) etc.
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [report.columns.map((c) => esc(c.label)).join(",")];
  for (const r of report.rows) lines.push(report.columns.map((c) => esc(cellValue(r[c.key], c.type))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel opens UTF-8 (₱, ñ) correctly
}
