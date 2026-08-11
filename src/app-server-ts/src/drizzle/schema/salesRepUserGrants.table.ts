import { foreignKey, integer, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { salesReps } from './salesReps.table';

export const salesRepUserGrants = pgTable(
  'sales_rep_user_grants',
  {
    id: serial().primaryKey().notNull(),
    userEmail: varchar('user_email', { length: 255 }).notNull(),
    salesRepId: integer('sales_rep_id').notNull(),
    relation: varchar({ length: 50 }).notNull().default('finance_viewer'),
    createdAt: timestamp('created_at', { mode: 'string' }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({
      columns: [table.salesRepId],
      foreignColumns: [salesReps.salesRepId],
      name: 'sales_rep_user_grants_sales_rep_fkey'
    }).onDelete('cascade'),
    unique('sales_rep_user_grants_user_rep_relation_unique').on(table.userEmail, table.salesRepId, table.relation)
  ]
);
