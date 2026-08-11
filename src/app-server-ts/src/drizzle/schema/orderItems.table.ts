import { sql } from 'drizzle-orm';
import { foreignKey, integer, numeric, pgTable, serial } from 'drizzle-orm/pg-core';
import { orders } from './orders.table';
import { products } from './products.table';

export const orderItems = pgTable(
  'order_items',
  {
    orderItemId: serial('order_item_id').primaryKey().notNull(),
    orderId: integer('order_id'),
    productId: integer('product_id'),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).notNull(),
    quantity: integer().notNull(),
    discount: numeric({ precision: 4, scale: 2 }).default('0.00'),
    totalPrice: numeric('total_price', { precision: 15, scale: 2 }).generatedAlwaysAs(
      sql`((unit_price * (quantity)::numeric) * ((1)::numeric - discount))`
    )
  },
  (table) => [
    foreignKey({
      columns: [table.orderId],
      foreignColumns: [orders.orderId],
      name: 'order_items_order_id_fkey'
    }),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [products.productId],
      name: 'order_items_product_id_fkey'
    })
  ]
);
