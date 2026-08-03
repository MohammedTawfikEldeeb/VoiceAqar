CREATE TABLE "properties" (
	"property_id" varchar(50) PRIMARY KEY NOT NULL,
	"title_ar" varchar(255) NOT NULL,
	"description_ar" text NOT NULL,
	"city_ar" varchar(100) NOT NULL,
	"district_ar" varchar(100) NOT NULL,
	"compound_name" varchar(100),
	"property_type" varchar(50) NOT NULL,
	"offering_type" varchar(20) DEFAULT 'للبيع' NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"bedrooms" integer NOT NULL,
	"bathrooms" integer NOT NULL,
	"area_sqm" integer NOT NULL,
	"furnished" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
