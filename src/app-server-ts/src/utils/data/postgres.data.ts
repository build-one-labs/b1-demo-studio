import * as fs from 'fs';
import path from 'path';

import { sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import {
  taxes,
  productCategories,
  products,
  items,
  clients,
  salesReps,
  customers,
  invoices,
  invoiceItems,
  invoiceItemTaxes,
  payments,
  offers,
  orders,
  orderItems,
  salesRepUserGrants,
  markdownFiles
} from '@/drizzle/schema';

export type ImportTypes = 'ImportAllData';
export type ExportTypes = 'ExportAllData';

const VERBOSE = process.env.VERBOSE === 'true';
const APP_DATA_FOLDER = process.env.APP_DATA_FOLDER;

// Generated columns must not be sent on INSERT — Postgres rejects them.
const ORDER_ITEM_GENERATED = ['totalPrice'] as const;
const ORDER_GENERATED = ['quarter', 'year'] as const;

// Audit fields that default to now() — stripped from exports for diff-friendliness
// and ignored on import so the database assigns fresh values.
const AUDIT_FIELDS = ['createdAt', 'updatedAt'] as const;

// Table -> serial column. After importing rows with explicit IDs, sequences
// must be advanced past MAX(id) so subsequent inserts don't collide.
const SEQUENCES: Array<{ table: string; column: string }> = [
  { table: 'taxes', column: 'id' },
  { table: 'product_categories', column: 'category_id' },
  { table: 'products', column: 'product_id' },
  { table: 'items', column: 'id' },
  { table: 'clients', column: 'id' },
  { table: 'sales_reps', column: 'sales_rep_id' },
  { table: 'customers', column: 'customer_id' },
  { table: 'invoices', column: 'id' },
  { table: 'invoice_items', column: 'id' },
  { table: 'payments', column: 'id' },
  { table: 'offers', column: 'offer_id' },
  { table: 'orders', column: 'order_id' },
  { table: 'order_items', column: 'order_item_id' },
  { table: 'sales_rep_user_grants', column: 'id' },
  { table: 'markdown_files', column: 'id' }
];

function readJsonFile<T = unknown>(file: string): T[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const fileString = fs.readFileSync(file, { encoding: 'utf-8' });
  return JSON.parse(fileString);
}

function logPercentage(current: number, total: number, threshold: number) {
  if (!VERBOSE) return 0;
  if (total <= 1000) return 0;
  const percentage = Math.floor((current / total) * 100);
  if (percentage >= threshold) {
    console.info(`Processed ${percentage}% [${current}/${total}]`);
    return 1;
  }
  return 0;
}

async function importDataWrapper<T>(collectionName: string, data: T[], importFunction: (item: T) => Promise<unknown>) {
  const start = Date.now();

  console.info(`Importing ${collectionName}...`);
  let threshold = 0;
  for (let index = 0; index < data.length; ++index) {
    threshold += logPercentage(index, data.length, threshold * 10);
    await importFunction(data[index]);
  }

  const totalTime = ((Date.now() - start) / 1000).toFixed(2);
  console.info(`Imported ${data.length} ${collectionName} in ${totalTime}s!`);
}

function stripFields<T extends Record<string, unknown>>(item: T, fields: readonly string[]): T {
  const out = { ...item };
  for (const f of fields) delete out[f];
  return out as T;
}

function readTableJson<T = Record<string, unknown>>(root: string, fileName: string): T[] | null {
  const filePath = path.join(root, fileName);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(filePath)) return null;
  const data = readJsonFile<T>(filePath);
  return Array.isArray(data) ? data : null;
}

async function processDataFolder(db: NodePgDatabase, root: string) {
  // Order respects FK dependencies: parents before children.

  const taxesData = readTableJson<typeof taxes.$inferInsert>(root, 'taxes.json');
  if (taxesData) {
    await importDataWrapper('taxes', taxesData, (item) =>
      db.insert(taxes).values(item).onConflictDoUpdate({ target: taxes.id, set: item })
    );
  }

  const categoriesData = readTableJson<typeof productCategories.$inferInsert>(root, 'product_categories.json');
  if (categoriesData) {
    await importDataWrapper('product categories', categoriesData, (item) =>
      db.insert(productCategories).values(item).onConflictDoUpdate({
        target: productCategories.categoryId,
        set: item
      })
    );
  }

  const productsData = readTableJson<typeof products.$inferInsert>(root, 'products.json');
  if (productsData) {
    await importDataWrapper('products', productsData, (item) =>
      db.insert(products).values(item).onConflictDoUpdate({ target: products.productId, set: item })
    );
  }

  const itemsData = readTableJson<typeof items.$inferInsert>(root, 'items.json');
  if (itemsData) {
    await importDataWrapper('items', itemsData, (item) => {
      const set = stripFields(item, AUDIT_FIELDS);
      return db
        .insert(items)
        .values(item)
        .onConflictDoUpdate({ target: items.id, set: { ...set, updatedAt: new Date().toISOString() } });
    });
  }

  const clientsData = readTableJson<typeof clients.$inferInsert>(root, 'clients.json');
  if (clientsData) {
    await importDataWrapper('clients', clientsData, (item) => {
      const set = stripFields(item, AUDIT_FIELDS);
      return db
        .insert(clients)
        .values(item)
        .onConflictDoUpdate({ target: clients.id, set: { ...set, updatedAt: new Date().toISOString() } });
    });
  }

  // Sales reps have a self-FK (manager_id). Two-pass: insert with manager_id
  // stripped, then update the manager link in a second pass.
  const salesRepsData = readTableJson<typeof salesReps.$inferInsert>(root, 'sales_reps.json');
  if (salesRepsData) {
    await importDataWrapper('sales reps (pass 1)', salesRepsData, (item) => {
      const insertable = stripFields(item, ['managerId']);
      return db
        .insert(salesReps)
        .values(insertable)
        .onConflictDoUpdate({ target: salesReps.salesRepId, set: insertable });
    });
    const withManagers = salesRepsData.filter((row) => row.managerId !== null && row.managerId !== undefined);
    if (withManagers.length > 0) {
      await importDataWrapper('sales reps (pass 2 - managers)', withManagers, (item) =>
        db.insert(salesReps).values(item).onConflictDoUpdate({ target: salesReps.salesRepId, set: item })
      );
    }
  }

  const customersData = readTableJson<typeof customers.$inferInsert>(root, 'customers.json');
  if (customersData) {
    await importDataWrapper('customers', customersData, (item) =>
      db.insert(customers).values(item).onConflictDoUpdate({ target: customers.customerId, set: item })
    );
  }

  const invoicesData = readTableJson<typeof invoices.$inferInsert>(root, 'invoices.json');
  if (invoicesData) {
    await importDataWrapper('invoices', invoicesData, (item) => {
      const set = stripFields(item, AUDIT_FIELDS);
      return db
        .insert(invoices)
        .values(item)
        .onConflictDoUpdate({ target: invoices.id, set: { ...set, updatedAt: new Date().toISOString() } });
    });
  }

  const invoiceItemsData = readTableJson<typeof invoiceItems.$inferInsert>(root, 'invoice_items.json');
  if (invoiceItemsData) {
    await importDataWrapper('invoice items', invoiceItemsData, (item) =>
      db.insert(invoiceItems).values(item).onConflictDoUpdate({ target: invoiceItems.id, set: item })
    );
  }

  const invoiceItemTaxesData = readTableJson<typeof invoiceItemTaxes.$inferInsert>(root, 'invoice_item_taxes.json');
  if (invoiceItemTaxesData) {
    await importDataWrapper('invoice item taxes', invoiceItemTaxesData, (item) =>
      db
        .insert(invoiceItemTaxes)
        .values(item)
        .onConflictDoUpdate({
          target: [invoiceItemTaxes.invoiceItemId, invoiceItemTaxes.taxId],
          set: item
        })
    );
  }

  const paymentsData = readTableJson<typeof payments.$inferInsert>(root, 'payments.json');
  if (paymentsData) {
    await importDataWrapper('payments', paymentsData, (item) =>
      db.insert(payments).values(item).onConflictDoUpdate({ target: payments.id, set: item })
    );
  }

  const offersData = readTableJson<typeof offers.$inferInsert>(root, 'offers.json');
  if (offersData) {
    await importDataWrapper('offers', offersData, (item) =>
      db.insert(offers).values(item).onConflictDoUpdate({ target: offers.offerId, set: item })
    );
  }

  const ordersData = readTableJson<typeof orders.$inferInsert>(root, 'orders.json');
  if (ordersData) {
    await importDataWrapper('orders', ordersData, (item) => {
      const insertable = stripFields(item, ORDER_GENERATED);
      return db.insert(orders).values(insertable).onConflictDoUpdate({ target: orders.orderId, set: insertable });
    });
  }

  const orderItemsData = readTableJson<typeof orderItems.$inferInsert>(root, 'order_items.json');
  if (orderItemsData) {
    await importDataWrapper('order items', orderItemsData, (item) => {
      const insertable = stripFields(item, ORDER_ITEM_GENERATED);
      return db
        .insert(orderItems)
        .values(insertable)
        .onConflictDoUpdate({ target: orderItems.orderItemId, set: insertable });
    });
  }

  const grantsData = readTableJson<typeof salesRepUserGrants.$inferInsert>(root, 'sales_rep_user_grants.json');
  if (grantsData) {
    await importDataWrapper('sales rep user grants', grantsData, (item) =>
      db
        .insert(salesRepUserGrants)
        .values(item)
        .onConflictDoUpdate({
          target: [salesRepUserGrants.userEmail, salesRepUserGrants.salesRepId, salesRepUserGrants.relation],
          set: item
        })
    );
  }

  const markdownData = readTableJson<typeof markdownFiles.$inferInsert>(root, 'markdown_files.json');
  if (markdownData) {
    await importDataWrapper('markdown files', markdownData, (item) =>
      db.insert(markdownFiles).values(item).onConflictDoUpdate({ target: markdownFiles.id, set: item })
    );
  }
}

async function resetSequences(db: NodePgDatabase) {
  for (const { table, column } of SEQUENCES) {
    await db.execute(
      sql.raw(
        `SELECT setval(pg_get_serial_sequence('${table}', '${column}'), GREATEST(COALESCE((SELECT MAX("${column}") FROM "${table}"), 0), 1))`
      )
    );
  }
}

export async function importData(type: ImportTypes, clearData = false) {
  if (!APP_DATA_FOLDER) {
    console.warn('APP_DATA_FOLDER is not set — skipping JSON import');
    return;
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(APP_DATA_FOLDER)) {
    console.info(`No JSON data folder at ${APP_DATA_FOLDER} — skipping import`);
    return;
  }

  console.info(`Running import of type ${type} from ${APP_DATA_FOLDER}...`);

  const client = new Pool({
    connectionString: process.env.APP_DATABASE_URL
  });
  const db = drizzle(client);

  try {
    if (clearData) {
      console.info('Clearing tables before import...');
      // Reverse FK order.
      await db.delete(markdownFiles);
      await db.delete(salesRepUserGrants);
      await db.delete(invoiceItemTaxes);
      await db.delete(invoiceItems);
      await db.delete(payments);
      await db.delete(invoices);
      await db.delete(orderItems);
      await db.delete(orders);
      await db.delete(offers);
      await db.delete(customers);
      await db.delete(clients);
      await db.delete(items);
      await db.delete(products);
      await db.delete(productCategories);
      await db.delete(taxes);
      await db.delete(salesReps);
    }

    await processDataFolder(db, APP_DATA_FOLDER);
    await resetSequences(db);

    console.info('Import complete.');
  } finally {
    await client.end();
  }
}

function sortObjectKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map((item) => sortObjectKeys(item));
  }
  if (obj instanceof Date) {
    return obj.toISOString();
  }
  if (obj !== null && typeof obj === 'object') {
    const sortedObj: Record<string, unknown> = {};
    const keys = Object.entries(obj as Record<string, unknown>)
      .sort(([key1, value1], [key2, value2]) => {
        if (typeof value1 === 'object' && typeof value2 === 'object') return key1.localeCompare(key2);
        if (typeof value1 !== 'object' && typeof value2 !== 'object') return key1.localeCompare(key2);
        if (typeof value1 === 'object') return 1;
        if (typeof value2 === 'object') return -1;
        return 0;
      })
      .map(([key]) => key);
    for (const key of keys) {
      sortedObj[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
    }
    return sortedObj;
  }
  return obj;
}

function writeTableJson(root: string, fileName: string, data: unknown[]) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(root)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(root, { recursive: true });
  }
  const outputFile = path.join(root, fileName);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2) + '\n');
  console.info(`Exported ${data.length} rows to ${outputFile}`);
}

interface ExportOptions<T> {
  fileName: string;

  table: any;
  sort: (a: T, b: T) => number;
  excludedFields?: readonly string[];
}

async function exportTable<T extends Record<string, unknown>>(
  db: NodePgDatabase,
  root: string,
  options: ExportOptions<T>
) {
  const rows = (await db.select().from(options.table)) as T[];
  const exclude = options.excludedFields ?? AUDIT_FIELDS;
  const filtered = [...rows].sort(options.sort).map((row) => sortObjectKeys(stripFields(row, exclude)));
  writeTableJson(root, options.fileName, filtered);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function exportData(type: ExportTypes = 'ExportAllData') {
  if (!APP_DATA_FOLDER) {
    throw new Error('APP_DATA_FOLDER is not set — cannot export');
  }

  const client = new Pool({
    connectionString: process.env.APP_DATABASE_URL
  });
  const db = drizzle(client);

  try {
    await exportTable<typeof taxes.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'taxes.json',
      table: taxes,
      sort: (a, b) => a.id - b.id,
      excludedFields: []
    });
    await exportTable<typeof productCategories.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'product_categories.json',
      table: productCategories,
      sort: (a, b) => a.categoryId - b.categoryId,
      excludedFields: []
    });
    await exportTable<typeof products.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'products.json',
      table: products,
      sort: (a, b) => a.productId - b.productId,
      excludedFields: []
    });
    await exportTable<typeof items.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'items.json',
      table: items,
      sort: (a, b) => a.id - b.id
    });
    await exportTable<typeof clients.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'clients.json',
      table: clients,
      sort: (a, b) => a.id - b.id
    });
    await exportTable<typeof salesReps.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'sales_reps.json',
      table: salesReps,
      sort: (a, b) => a.salesRepId - b.salesRepId,
      excludedFields: []
    });
    await exportTable<typeof customers.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'customers.json',
      table: customers,
      sort: (a, b) => a.customerId - b.customerId,
      excludedFields: []
    });
    await exportTable<typeof invoices.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'invoices.json',
      table: invoices,
      sort: (a, b) => a.id - b.id
    });
    await exportTable<typeof invoiceItems.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'invoice_items.json',
      table: invoiceItems,
      sort: (a, b) => a.id - b.id,
      excludedFields: []
    });
    await exportTable<typeof invoiceItemTaxes.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'invoice_item_taxes.json',
      table: invoiceItemTaxes,
      sort: (a, b) => a.invoiceItemId - b.invoiceItemId || a.taxId - b.taxId,
      excludedFields: []
    });
    await exportTable<typeof payments.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'payments.json',
      table: payments,
      sort: (a, b) => a.id - b.id,
      excludedFields: []
    });
    await exportTable<typeof offers.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'offers.json',
      table: offers,
      sort: (a, b) => a.offerId - b.offerId,
      excludedFields: []
    });
    await exportTable<typeof orders.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'orders.json',
      table: orders,
      sort: (a, b) => a.orderId - b.orderId,
      excludedFields: ORDER_GENERATED
    });
    await exportTable<typeof orderItems.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'order_items.json',
      table: orderItems,
      sort: (a, b) => a.orderItemId - b.orderItemId,
      excludedFields: ORDER_ITEM_GENERATED
    });
    await exportTable<typeof salesRepUserGrants.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'sales_rep_user_grants.json',
      table: salesRepUserGrants,
      sort: (a, b) =>
        a.userEmail.localeCompare(b.userEmail) || a.salesRepId - b.salesRepId || a.relation.localeCompare(b.relation),
      excludedFields: ['id', 'createdAt']
    });
    await exportTable<typeof markdownFiles.$inferSelect>(db, APP_DATA_FOLDER, {
      fileName: 'markdown_files.json',
      table: markdownFiles,
      sort: (a, b) => a.id - b.id
    });
  } finally {
    await client.end();
  }
}
