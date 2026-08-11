import { foreignKey, integer, numeric, pgTable, serial, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { clients } from './clients.table';

export const invoices = pgTable(
  'invoices',
  {
    id: serial().primaryKey().notNull(),
    customerId: integer('customer_id').notNull(),
    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
    date: timestamp({ mode: 'string' }).defaultNow().notNull(),
    dueDate: timestamp('due_date', { mode: 'string' }),
    totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).default('0').notNull(),
    status: varchar({ length: 50 }).default('draft').notNull(),
    terms: text(),
    notes: text(),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [clients.id],
      name: 'invoices_customer_id_clients_id_fk'
    }).onDelete('cascade'),
    unique('invoices_invoice_number_unique').on(table.invoiceNumber)
  ]
);
