ALTER TABLE "clients" ADD COLUMN "active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "createdby" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "customerPriority" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "dunsNumber" varchar(10);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "employees" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "fax" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "industry" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "lastUpdatedBy" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "parentCompany" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "shippingAddress" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "sla" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "slaExpirationDate" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "slaSerialNumber" varchar(10);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tickerSymbol" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "type" varchar(50);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "website" varchar(255);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "yearStarted" varchar(50);