CREATE TABLE "pilot_merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_key" text NOT NULL,
	"layer" text NOT NULL,
	"surveyor" text,
	"store_name" text NOT NULL,
	"business_type" text DEFAULT 'sari_sari' NOT NULL,
	"owner_name" text,
	"contact_phone" text,
	"address" text,
	"barangay" text,
	"city" text,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"signed" boolean DEFAULT false NOT NULL,
	"registration_status" text,
	"retention_status" text,
	"surveyed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "pilot_merchant_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pilot_merchants_external_key_uq" ON "pilot_merchants" USING btree ("external_key");--> statement-breakpoint
CREATE INDEX "pilot_merchants_latlng_idx" ON "pilot_merchants" USING btree ("latitude","longitude");--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_pilot_merchant_id_pilot_merchants_id_fk" FOREIGN KEY ("pilot_merchant_id") REFERENCES "public"."pilot_merchants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stores_pilot_merchant_uq" ON "stores" USING btree ("pilot_merchant_id") WHERE "stores"."pilot_merchant_id" is not null;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_lat_range" CHECK ("stores"."latitude" is null or "stores"."latitude" between -90 and 90);--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_lng_range" CHECK ("stores"."longitude" is null or "stores"."longitude" between -180 and 180);--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_latlng_pair" CHECK (("stores"."latitude" is null) = ("stores"."longitude" is null));