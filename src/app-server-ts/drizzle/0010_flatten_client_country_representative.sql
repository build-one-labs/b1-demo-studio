ALTER TABLE "clients" ALTER COLUMN "country" SET DATA TYPE varchar(100) USING "country"::jsonb->>'name';--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "representative" SET DATA TYPE varchar(100) USING "representative"::jsonb->>'name';
