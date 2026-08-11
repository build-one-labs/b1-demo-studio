import { boolean, foreignKey, integer, numeric, pgTable, serial, text, varchar } from 'drizzle-orm/pg-core';
import { productCategories } from './productCategories.table';

export const products = pgTable(
  'products',
  {
    productId: serial('product_id').primaryKey().notNull(),
    productName: varchar('product_name', { length: 100 }).notNull(),
    description: text(),
    image: text(),
    category: text(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    quantity: integer(),
    rating: integer(),
    categoryId: integer('category_id'),
    isActive: boolean('is_active').default(true)
  },
  (table) => [
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [productCategories.categoryId],
      name: 'products_category_id_fkey'
    })
  ]
);
