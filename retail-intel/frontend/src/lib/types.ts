export type StockStatus = "ok" | "low" | "out";
export type CaptureKind = "shelf" | "receipt" | "ledger";

export interface Store { id: number; name: string; barangay: string | null; city: string | null; owner_name?: string | null }

export interface Product {
  id: number; store_id: number; sku: string; name: string; brand: string | null; variant: string | null; barcode: string | null;
  price: number; cost: number; reorder_level: number; qty_on_hand: number; status: StockStatus; thumbnail_url: string | null; updated_at: string | null;
}

export interface CaptureItem { sku: string; name?: string | null; brand?: string | null; variant?: string | null; qty: number; unit_price: number; confidence: number }

export interface Capture {
  id: number; store_id: number; kind: CaptureKind; client_id: string | null; image_url: string; sha256: string; phash: string;
  width: number; height: number; size_bytes: number; blur_score: number; quality_ok: boolean; quality_issues: string[];
  duplicate_of: number | null; status: "pending_review" | "verified" | "rejected"; provider: string; items: CaptureItem[];
  points_awarded: number; checkin_bonus?: number; created_at: string; verified_at: string | null;
}

export interface OrderLine { id: number; product_id: number; sku: string; name: string; qty: number; unit_cost: number; line_total: number; reason?: string | null }
export interface Order {
  id: number; store_id: number; store?: string; distributor: string; status: "draft" | "submitted" | "fulfilled" | "cancelled"; note: string | null;
  lines: OrderLine[]; total: number; created_at: string; submitted_at: string | null; fulfilled_at: string | null;
}

export interface Rewards {
  store_id: number; balance: number; points_per_capture: Record<CaptureKind, number>;
  history: { id: number; points: number; reason: string; capture_id: number | null; created_at: string }[];
  redemptions: { id: string; label: string; points: number; can_redeem: boolean; points_short: number }[];
}

export interface Overview {
  stores: { id: number; name: string; barangay: string | null; city: string | null; skus: number; cashflow_score: number; cashflow_band: string; units_per_day: number; checkin_streak: number; ok: number; low: number; out: number; stock_value: number; points: number; pending_captures: number; last_capture_at: string | null }[];
  totals: { stores: number; skus: number; low: number; out: number; captures: number; flagged: number; points: number; open_orders: number };
  captures_by_status: Record<string, number>;
  alerts: { store_id: number; store: string; product_id: number; sku: string; name: string; brand: string | null; qty_on_hand: number; reorder_level: number; status: StockStatus }[];
  share_of_shelf: { brand: string; units: number; share: number }[];
  shelf_captures_used: number;
  order_queue: Order[];
}

export interface AuditEntry { id: number; store_id: number | null; action: string; entity: string; entity_id: number | null; detail: Record<string, unknown>; created_at: string }

export type SyncOpType = "adjust" | "product_upsert" | "product_patch";
export interface QueuedOp { id: string; kind: "op"; storeId: number; type: SyncOpType; payload: Record<string, unknown>; createdAt: string; seq?: number; error?: string }
export interface QueuedCapture { id: string; kind: "capture"; storeId: number; captureKind: CaptureKind; data: ArrayBuffer; mime: string; fileName: string; createdAt: string; seq?: number; error?: string }
export type QueueEntry = QueuedOp | QueuedCapture;

export interface CheckinDay { date: string; ledger: boolean; shelf: boolean; complete: boolean }
export interface Checkins { today: CheckinDay; streak: number; days: CheckinDay[]; complete_days: number; bonus: { per_day: number; every_7_days: number } }
export interface Cashflow {
  store_id: number; score: number; band: "Strong" | "Fair" | "Building"; disclaimer: string; improve: string[]; computed_at: string;
  factors: { key: string; label: string; weight: number; score: number; points: number; detail: string }[];
  metrics: { avg_daily_sales: number; sales_30d: number; ledger_days_30d: number; stock_value: number; orders_received_60d: number; checkin_streak: number };
}
