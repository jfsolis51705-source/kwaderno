CREATE TYPE "public"."expiry_clear_reason" AS ENUM('sold_out', 'disposed', 'returned');--> statement-breakpoint
CREATE TYPE "public"."expiry_status" AS ENUM('active', 'cleared');--> statement-breakpoint
CREATE TABLE "product_expiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"expiry_date" date NOT NULL,
	"quantity" numeric(14, 3),
	"product_photo_path" text NOT NULL,
	"label_photo_path" text NOT NULL,
	"note" text,
	"status" "expiry_status" DEFAULT 'active' NOT NULL,
	"clear_reason" "expiry_clear_reason",
	"cleared_by" uuid,
	"cleared_at" timestamp with time zone,
	"inventory_transaction_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_expiries_qty_pos" CHECK ("product_expiries"."quantity" is null or "product_expiries"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_expiries" ADD CONSTRAINT "product_expiries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_expiries" ADD CONSTRAINT "product_expiries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_expiries" ADD CONSTRAINT "product_expiries_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_expiries" ADD CONSTRAINT "product_expiries_inventory_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("inventory_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_expiries" ADD CONSTRAINT "product_expiries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_expiries_store_status_date_idx" ON "product_expiries" USING btree ("store_id","status","expiry_date");--> statement-breakpoint
CREATE INDEX "product_expiries_product_idx" ON "product_expiries" USING btree ("product_id");