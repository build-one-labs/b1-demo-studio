ALTER TABLE "invoices" DROP CONSTRAINT "invoices_customer_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_clients_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;