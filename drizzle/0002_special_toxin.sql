ALTER TABLE "call_logs" ADD COLUMN "p50_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "p90_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "turn_latencies_ms" integer[];