CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"country" json,
	"company" varchar(255),
	"date" date,
	"status" varchar(50),
	"verified" boolean DEFAULT false,
	"activity" integer,
	"representative" json,
	"balance" numeric(10, 2)
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"customer_id" serial PRIMARY KEY NOT NULL,
	"company_name" varchar(100) NOT NULL,
	"contact_name" varchar(100),
	"email" varchar(100),
	"phone" varchar(20),
	"address" text,
	"city" varchar(50),
	"country" varchar(50),
	"industry" varchar(50),
	"sales_rep_id" integer
);
--> statement-breakpoint
CREATE TABLE "invoice_item_taxes" (
	"invoice_item_id" integer NOT NULL,
	"tax_id" integer NOT NULL,
	"amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "invoice_item_taxes_invoice_item_id_tax_id_pk" PRIMARY KEY("invoice_item_id","tax_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"product_id" integer,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_id" integer NOT NULL,
	"invoice_number" varchar(50) NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"terms" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku" varchar(100),
	"name" varchar(255) NOT NULL,
	"description" text,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "items_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"offer_id" serial PRIMARY KEY NOT NULL,
	"offer_number" varchar(20) NOT NULL,
	"customer_id" integer,
	"sales_rep_id" integer,
	"created_date" date NOT NULL,
	"valid_until" date NOT NULL,
	"total_value" numeric(15, 2) NOT NULL,
	"status" varchar(20) NOT NULL,
	"notes" text,
	"converted_to_order" boolean DEFAULT false,
	"conversion_date" date,
	CONSTRAINT "offers_offer_number_key" UNIQUE("offer_number"),
	CONSTRAINT "offers_status_check" CHECK ((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('submitted'::character varying)::text, ('pending'::character varying)::text, ('accepted'::character varying)::text, ('rejected'::character varying)::text, ('expired'::character varying)::text]))
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"order_item_id" serial PRIMARY KEY NOT NULL,
	"order_id" integer,
	"product_id" integer,
	"unit_price" numeric(10, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"discount" numeric(4, 2) DEFAULT '0.00',
	"total_price" numeric(15, 2) GENERATED ALWAYS AS (((unit_price * (quantity)::numeric) * ((1)::numeric - discount))) STORED
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"order_id" serial PRIMARY KEY NOT NULL,
	"order_number" varchar(20) NOT NULL,
	"customer_id" integer,
	"sales_rep_id" integer,
	"order_date" date NOT NULL,
	"required_date" date,
	"shipped_date" date,
	"status" varchar(20) NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"offer_id" integer,
	"quarter" integer GENERATED ALWAYS AS (EXTRACT(quarter FROM order_date)) STORED,
	"year" integer GENERATED ALWAYS AS (EXTRACT(year FROM order_date)) STORED,
	CONSTRAINT "orders_order_number_key" UNIQUE("order_number"),
	CONSTRAINT "orders_status_check" CHECK ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('shipped'::character varying)::text, ('delivered'::character varying)::text, ('cancelled'::character varying)::text]))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"date" timestamp DEFAULT now() NOT NULL,
	"method" varchar(100),
	"reference" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "product_categories" (
	"category_id" serial PRIMARY KEY NOT NULL,
	"category_name" varchar(50) NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "products" (
	"product_id" serial PRIMARY KEY NOT NULL,
	"product_name" varchar(100) NOT NULL,
	"description" text,
	"unit_price" numeric(10, 2) NOT NULL,
	"category_id" integer,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "sales_reps" (
	"sales_rep_id" serial PRIMARY KEY NOT NULL,
	"first_name" varchar(50) NOT NULL,
	"last_name" varchar(50) NOT NULL,
	"email" varchar(100) NOT NULL,
	"phone" varchar(20),
	"hire_date" date NOT NULL,
	"region" varchar(50),
	"manager_id" integer,
	CONSTRAINT "sales_reps_email_key" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "taxes" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"rate" numeric(5, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("sales_rep_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item_taxes" ADD CONSTRAINT "invoice_item_taxes_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item_taxes" ADD CONSTRAINT "invoice_item_taxes_tax_id_taxes_id_fk" FOREIGN KEY ("tax_id") REFERENCES "public"."taxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_items_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_clients_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("sales_rep_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("customer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("offer_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "public"."sales_reps"("sales_rep_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT "sales_reps_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "public"."sales_reps"("sales_rep_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_offers_customer" ON "offers" USING btree ("customer_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_offers_date" ON "offers" USING btree ("created_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_offers_status" ON "offers" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_orders_customer" ON "orders" USING btree ("customer_id" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_orders_date" ON "orders" USING btree ("order_date" date_ops);--> statement-breakpoint
CREATE INDEX "idx_orders_quarter_year" ON "orders" USING btree ("quarter" int4_ops,"year" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_orders_sales_rep" ON "orders" USING btree ("sales_rep_id" int4_ops);