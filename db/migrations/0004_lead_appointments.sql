-- Datos de la cita con el prospecto: hora, modalidad y lugar o enlace de la videollamada.
ALTER TABLE "leads" ADD COLUMN "appointment_time" time;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "appointment_mode" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "appointment_place" text;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_appointment_mode_ck" CHECK ("appointment_mode" is null or "appointment_mode" in ('presencial','videollamada'));--> statement-breakpoint
ALTER TABLE "lead_calls" ADD COLUMN "appointment_time" time;--> statement-breakpoint
ALTER TABLE "lead_calls" ADD COLUMN "appointment_mode" text;--> statement-breakpoint
ALTER TABLE "lead_calls" ADD COLUMN "appointment_place" text;--> statement-breakpoint
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_appointment_mode_ck" CHECK ("appointment_mode" is null or "appointment_mode" in ('presencial','videollamada'));
