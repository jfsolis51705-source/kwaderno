import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { DateRangeFilter } from "../dashboard/date-range-filter";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/server/auth/current";
import { storeToday } from "@/server/services/dashboard";
import { REPORT_TITLES, REPORT_TYPES, runReport, type ColumnType, type ReportType } from "@/server/services/reports";
import { formatPeso, formatQty } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const dt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function show(v: unknown, type: ColumnType) {
  if (v == null || v === "") return "—";
  if (type === "money") return formatPeso(Number(v));
  if (type === "qty") return formatQty(Number(v));
  if (type === "datetime") return dt.format(new Date(v as string));
  return String(v);
}
const right = (t: ColumnType) => t === "money" || t === "qty" || t === "int";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ type?: string; from?: string; to?: string }> }) {
  const { store } = await requireAppContext();
  const sp = await searchParams;
  const type: ReportType = REPORT_TYPES.includes(sp.type as ReportType) ? (sp.type as ReportType) : "daily_sales";
  const today = await storeToday(store);
  let from = isDate(sp.from) ? sp.from! : new Date(new Date(today + "T00:00:00Z").getTime() - 6 * 864e5).toISOString().slice(0, 10);
  let to = isDate(sp.to) ? sp.to! : today;
  if (from > to) [from, to] = [to, from];
  const report = await runReport(store, type, { from, to });
  const qs = (o: Record<string, string>) => new URLSearchParams({ type, from, to, ...o }).toString();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description={report.dated ? `${report.title} · ${from} to ${to}` : `${report.title} · as of now`}
        actions={
          <Button asChild variant="outline">
            <a href={`/api/v1/stores/${store.storeId}/reports/${type}?${new URLSearchParams({ from, to, format: "csv" })}`} download><Download /> Download CSV</a>
          </Button>
        }
      />
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Report type">
        {REPORT_TYPES.map((t) => (
          <Link key={t} href={`/reports?${qs({ type: t })}`} className={cn("rounded-full border px-3 py-1.5 text-sm whitespace-nowrap", t === type ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}>
            {REPORT_TITLES[t]}
          </Link>
        ))}
      </nav>
      {report.dated && <DateRangeFilter from={from} to={to} today={today} />}
      {report.rows.length === 0 ? (
        <EmptyState icon={BarChart3} title="Nothing to report" description={report.dated ? "No records in this date range." : "No records yet."} />
      ) : (
        <div className="bg-card rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>{report.columns.map((c) => <TableHead key={c.key} className={cn(right(c.type) && "text-right")}>{c.label}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((r, i) => (
                <TableRow key={i}>{report.columns.map((c) => <TableCell key={c.key} className={cn(right(c.type) && "num text-right", c.type === "text" && "max-w-64 truncate")}>{show(r[c.key], c.type)}</TableCell>)}</TableRow>
              ))}
              {report.totals && (
                <TableRow className="bg-muted/50 font-semibold">
                  {report.columns.map((c, i) => <TableCell key={c.key} className={cn(right(c.type) && "num text-right")}>{i === 0 ? "Total" : c.key in report.totals! ? show(report.totals![c.key], c.type) : ""}</TableCell>)}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
