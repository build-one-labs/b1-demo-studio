import { numeric, pgTable, serial, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

export const items = pgTable(
  'items',
  {
    id: serial().primaryKey().notNull(),
    sku: varchar({ length: 100 }),
    name: varchar({ length: 255 }).notNull(),
    description: text(),
    price: numeric({ precision: 10, scale: 2 }).default('0').notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [unique('items_sku_unique').on(table.sku)]
);
