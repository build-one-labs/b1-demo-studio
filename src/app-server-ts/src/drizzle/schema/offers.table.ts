import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  unique,
  varchar
} from 'drizzle-orm/pg-core';
import { customers } from './customers.table';
import { salesReps } from './salesReps.table';
import { sql } from 'drizzle-orm';

export const offers = pgTable(
  'offers',
  {
    offerId: serial('offer_id').primaryKey().notNull(),
    offerNumber: varchar('offer_number', { length: 20 }).notNull(),
    customerId: integer('customer_id'),
    salesRepId: integer('sales_rep_id'),
    createdDate: date('created_date').notNull(),
    validUntil: date('valid_until').notNull(),
    totalValue: numeric('total_value', { precision: 15, scale: 2 }).notNull(),
    status: varchar({ length: 20 }).notNull(),
    notes: text(),
    convertedToOrder: boolean('converted_to_order').default(false),
    conversionDate: date('conversion_date')
  },
  (table) => [
    index('idx_offers_customer').using('btree', table.customerId.asc().nullsLast().op('int4_ops')),
    index('idx_offers_date').using('btree', table.createdDate.asc().nullsLast().op('date_ops')),
    index('idx_offers_status').using('btree', table.status.asc().nullsLast().op('text_ops')),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.customerId],
      name: 'offers_customer_id_fkey'
    }),
    foreignKey({
      columns: [table.salesRepId],
      foreignColumns: [salesReps.salesRepId],
      name: 'offers_sales_rep_id_fkey'
    }),
    unique('offers_offer_number_key').on(table.offerNumber),
    check(
      'offers_status_check',
      sql`(status)::text = ANY (ARRAY[('draft'::character varying)::text, ('submitted'::character varying)::text, ('pending'::character varying)::text, ('accepted'::character varying)::text, ('rejected'::character varying)::text, ('expired'::character varying)::text])`
    )
  ]
);
