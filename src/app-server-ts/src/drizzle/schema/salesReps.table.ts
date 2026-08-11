import { date, foreignKey, integer, pgTable, serial, unique, varchar } from 'drizzle-orm/pg-core';

export const salesReps = pgTable(
  'sales_reps',
  {
    salesRepId: serial('sales_rep_id').primaryKey().notNull(),
    firstName: varchar('first_name', { length: 50 }).notNull(),
    lastName: varchar('last_name', { length: 50 }).notNull(),
    email: varchar({ length: 100 }).notNull(),
    phone: varchar({ length: 20 }),
    hireDate: date('hire_date').notNull(),
    region: varchar({ length: 50 }),
    managerId: integer('manager_id')
  },
  (table) => [
    foreignKey({
      columns: [table.managerId],
      foreignColumns: [table.salesRepId],
      name: 'sales_reps_manager_id_fkey'
    }),
    unique('sales_reps_email_key').on(table.email)
  ]
);
