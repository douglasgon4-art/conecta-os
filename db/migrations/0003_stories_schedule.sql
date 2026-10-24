-- Stories mensuales, días fijos de publicación y día de pago hasta 31 (se ajusta al último día de meses cortos).
ALTER TABLE "client_contracts" ADD COLUMN "stories_per_month" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD COLUMN "post_weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "client_contracts" ADD COLUMN "story_weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "client_contracts" DROP CONSTRAINT "contracts_billing_day_ck";--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "contracts_billing_day_ck" CHECK ("billing_day" between 1 and 31);--> statement-breakpoint
ALTER TABLE "client_contracts" DROP CONSTRAINT "contracts_counts_ck";--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "contracts_counts_ck" CHECK ("designs_per_month" >= 0 and "reels_per_month" >= 0 and "stories_per_month" >= 0);--> statement-breakpoint
ALTER TABLE "client_contracts" ADD CONSTRAINT "contracts_weekdays_ck" CHECK ("post_weekdays" <@ '{1,2,3,4,5,6,7}'::smallint[] and "story_weekdays" <@ '{1,2,3,4,5,6,7}'::smallint[]);--> statement-breakpoint
ALTER TABLE "production_deliverables" DROP CONSTRAINT "deliverables_kind_ck";--> statement-breakpoint
ALTER TABLE "production_deliverables" ADD CONSTRAINT "deliverables_kind_ck" CHECK ("kind" in ('diseno','perfil','portada','reel','story'));
