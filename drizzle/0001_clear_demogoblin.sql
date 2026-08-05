CREATE TABLE "call_logs" (
	"call_id" varchar(50) PRIMARY KEY NOT NULL,
	"user_id" varchar(50),
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"status" varchar(20) DEFAULT 'initiated' NOT NULL,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" varchar(50) PRIMARY KEY NOT NULL,
	"phone_number" varchar(50) NOT NULL,
	"name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;