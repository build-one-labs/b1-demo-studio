import { foreignKey, integer, numeric, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { invoices } from './invoices.table';

export const payments = pgTable(
  'payments',
  {
    id: serial().primaryKey().notNull(),
    invoiceId: integer('invoice_id').notNull(),
    amount: numeric({ precision: 12, scale: 2 }).default('0').notNull(),
    date: timestamp({ mode: 'string' }).defaultNow().notNull(),
    method: varchar({ length: 100 }),
    reference: varchar({ length: 255 })
  },
  (table) => [
    foreignKey({
      columns: [table.invoiceId],
      foreignColumns: [invoices.id],
      name: 'payments_invoice_id_invoices_id_fk'
    })
  ]
);
