import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  unique,
  varchar
} from 'drizzle-orm/pg-core';
import { customers } from './customers.table';
import { offers } from './offers.table';
import { salesReps } from './salesReps.table';

export const orders = pgTable(
  'orders',
  {
    orderId: serial('order_id').primaryKey().notNull(),
    orderNumber: varchar('order_number', { length: 20 }).notNull(),
    customerId: integer('customer_id'),
    salesRepId: integer('sales_rep_id'),
    orderDate: date('order_date').notNull(),
    requiredDate: date('required_date'),
    shippedDate: date('shipped_date'),
    status: varchar({ length: 20 }).notNull(),
    totalAmount: numeric('total_amount', { precision: 15, scale: 2 }).notNull(),
    offerId: integer('offer_id'),
    quarter: integer().generatedAlwaysAs(sql`EXTRACT(quarter FROM order_date)`),
    year: integer().generatedAlwaysAs(sql`EXTRACT(year FROM order_date)`)
  },
  (table) => [
    index('idx_orders_customer').using('btree', table.customerId.asc().nullsLast().op('int4_ops')),
    index('idx_orders_date').using('btree', table.orderDate.asc().nullsLast().op('date_ops')),
    index('idx_orders_quarter_year').using(
      'btree',
      table.quarter.asc().nullsLast().op('int4_ops'),
      table.year.asc().nullsLast().op('int4_ops')
    ),
    index('idx_orders_sales_rep').using('btree', table.salesRepId.asc().nullsLast().op('int4_ops')),
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.customerId],
      name: 'orders_customer_id_fkey'
    }),
    foreignKey({
      columns: [table.offerId],
      foreignColumns: [offers.offerId],
      name: 'orders_offer_id_fkey'
    }),
    foreignKey({
      columns: [table.salesRepId],
      foreignColumns: [salesReps.salesRepId],
      name: 'orders_sales_rep_id_fkey'
    }),
    unique('orders_order_number_key').on(table.orderNumber),
    check(
      'orders_status_check',
      sql`(status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('shipped'::character varying)::text, ('delivered'::character varying)::text, ('cancelled'::character varying)::text])`
    )
  ]
);
