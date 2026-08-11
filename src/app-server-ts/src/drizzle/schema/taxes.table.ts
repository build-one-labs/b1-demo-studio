import { numeric, pgTable, serial, varchar } from 'drizzle-orm/pg-core';

export const taxes = pgTable('taxes', {
  id: serial().primaryKey().notNull(),
  name: varchar({ length: 255 }).notNull(),
  rate: numeric({ precision: 5, scale: 2 }).default('0').notNull()
});
