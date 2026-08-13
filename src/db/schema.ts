import { pgTable, varchar, decimal, integer, boolean, text, timestamp } from 'drizzle-orm/pg-core';

export const properties = pgTable('properties', {
  propertyId: varchar('property_id', { length: 50 }).primaryKey(),
  titleAr: varchar('title_ar', { length: 255 }).notNull(),
  descriptionAr: text('description_ar').notNull(),
  cityAr: varchar('city_ar', { length: 100 }).notNull(),
  districtAr: varchar('district_ar', { length: 100 }).notNull(),
  compoundName: varchar('compound_name', { length: 100 }),
  propertyType: varchar('property_type', { length: 50 }).notNull(),
  offeringType: varchar('offering_type', { length: 20 }).default('للبيع').notNull(),
  price: decimal('price', { precision: 14, scale: 2 }).notNull(),
  bedrooms: integer('bedrooms').notNull(),
  bathrooms: integer('bathrooms').notNull(),
  areaSqm: integer('area_sqm').notNull(),
  furnished: boolean('furnished').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Property = typeof properties.$inferSelect;
export type NewProperty = typeof properties.$inferInsert;

export const users = pgTable('users', {
  userId: varchar('user_id', { length: 50 }).primaryKey(),
  phoneNumber: varchar('phone_number', { length: 50 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;