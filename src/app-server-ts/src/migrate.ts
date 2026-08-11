import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function runMigrations() {
  const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });
  const db = drizzle(pool);

  console.log('Running database migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations completed');

  await pool.end();
}

runMigrations().catch((error: unknown) => {
  console.error('Migration failed:', error);
  throw error;
});
