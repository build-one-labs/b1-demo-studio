import 'dotenv/config';
import { runFrameworkMigrations } from '@buildone/app-server-tslib/framework';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function runMigrations() {
  const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });
  const db = drizzle(pool);

  console.log('Running B1 framework migrations...');
  await runFrameworkMigrations(process.env.B1_DATABASE_URL as string);
  console.log('Framework migrations completed');

  console.log('Running database migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations completed');

  await pool.end();
}

runMigrations().catch((error: unknown) => {
  console.error('Migration failed:', error);
  throw error;
});
