import { foreignKey, integer, pgTable, serial, text, varchar } from 'drizzle-orm/pg-core';
import { salesReps } from './salesReps.table';

export const customers = pgTable(
  'customers',
  {
    customerId: serial('customer_id').primaryKey().notNull(),
    companyName: varchar('company_name', { length: 100 }).notNull(),
    contactName: varchar('contact_name', { length: 100 }),
    email: varchar({ length: 100 }),
    phone: varchar({ length: 20 }),
    address: text(),
    city: varchar({ length: 50 }),
    country: varchar({ length: 50 }),
    industry: varchar({ length: 50 }),
    salesRepId: integer('sales_rep_id')
  },
  (table) => [
    foreignKey({
      columns: [table.salesRepId],
      foreignColumns: [salesReps.salesRepId],
      name: 'customers_sales_rep_id_fkey'
    })
  ]
);
