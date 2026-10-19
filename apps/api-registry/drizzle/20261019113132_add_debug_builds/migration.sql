ALTER TABLE "packages" ADD COLUMN "entrypoint" text;--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "built_with" varchar(64);--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "debug_commitment" varchar(66);--> statement-breakpoint
ALTER TABLE "packages" ADD COLUMN "debug_built_with" varchar(64);