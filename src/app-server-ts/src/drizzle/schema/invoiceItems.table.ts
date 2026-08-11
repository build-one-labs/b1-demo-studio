import { foreignKey, integer, numeric, pgTable, serial, text } from 'drizzle-orm/pg-core';
import { invoices } from './invoices.table';
import { items } from './items.table';

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: serial().primaryKey().notNull(),
    invoiceId: integer('invoice_id').notNull(),
    productId: integer('product_id'),
    description: text(),
    quantity: integer().default(1).notNull(),
    unitPrice: numeric('unit_price', { precision: 10, scale: 2 }).default('0').notNull(),
    total: numeric({ precision: 12, scale: 2 }).default('0').notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.invoiceId],
      foreignColumns: [invoices.id],
      name: 'invoice_items_invoice_id_invoices_id_fk'
    }),
    foreignKey({
      columns: [table.productId],
      foreignColumns: [items.id],
      name: 'invoice_items_product_id_items_id_fk'
    })
  ]
);
