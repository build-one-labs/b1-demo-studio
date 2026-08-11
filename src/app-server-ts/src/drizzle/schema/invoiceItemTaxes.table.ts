import { foreignKey, integer, numeric, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { invoiceItems } from './invoiceItems.table';
import { taxes } from './taxes.table';

export const invoiceItemTaxes = pgTable(
  'invoice_item_taxes',
  {
    invoiceItemId: integer('invoice_item_id').notNull(),
    taxId: integer('tax_id').notNull(),
    amount: numeric({ precision: 10, scale: 2 }).default('0').notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.invoiceItemId],
      foreignColumns: [invoiceItems.id],
      name: 'invoice_item_taxes_invoice_item_id_invoice_items_id_fk'
    }),
    foreignKey({
      columns: [table.taxId],
      foreignColumns: [taxes.id],
      name: 'invoice_item_taxes_tax_id_taxes_id_fk'
    }),
    primaryKey({ columns: [table.invoiceItemId, table.taxId], name: 'invoice_item_taxes_invoice_item_id_tax_id_pk' })
  ]
);
