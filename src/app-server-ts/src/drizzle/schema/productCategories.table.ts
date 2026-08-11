import { pgTable, serial, text, varchar } from 'drizzle-orm/pg-core';

export const productCategories = pgTable('product_categories', {
  categoryId: serial('category_id').primaryKey().notNull(),
  categoryName: varchar('category_name', { length: 50 }).notNull(),
  description: text()
});
