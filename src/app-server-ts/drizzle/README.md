# Drizzle Migrations Guide

A comprehensive guide to managing database schema and data migrations with Build.One and Drizzle ORM.

## Overview

Drizzle provides a robust migration system that allows you to version control your database schema changes and manage data transformations. This guide covers both schema migrations (structural changes) and custom data migrations.

## Migration Workflow

### 1. Schema Migrations

Schema migrations handle structural changes to your database (tables, columns, indexes, etc.).

#### Step 1: Update Your Schema

Make changes to your Drizzle schema files (typically in `src/app-server-ts/src/drizzle/schema.ts`):

```typescript
// Example schema changes
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).unique(),
  // New column added
  createdAt: timestamp('created_at').defaultNow()
});

// New table added
export const releases = pgTable('releases', {
  id: serial('id').primaryKey(),
  version: varchar('version', { length: 50 }),
  releaseDate: timestamp('release_date')
});
```

#### Step 2: Generate Migration

Use Drizzle Kit to generate a migration file based on schema changes:

```bash
yarn workspace @buildone/app-server-ts db:migrate:generate <migration_name>
 
```

This creates a new migration file in your migrations directory with SQL commands to update the database structure.

For example

```bash
yarn workspace @buildone/app-server-ts db:migrate:generate add_users
```

```text
📦 app-server-ts
├── 📂 drizzle
│   ├── 📂 _meta
│   ├── 📜 0000_init.sql
│   └── 📜 0001_add_users.sql
├── 📂 src
└── …
```

#### Step 3: Apply Schema Migration

Run the generated migration to update your database:

```bash
yarn workspace @buildone/app-server-ts db:migrate
```

#### Step 4: Commit Changes

Add and commit all changes in the `src/app-server-ts` directory:

```bash
git add src/app-server-ts
git commit -m "Add migration for [description of changes]"
```

### 2. Custom Data Migrations

For complex data transformations that can't be handled by schema migrations alone, you can create custom migration scripts.

#### When to Use Custom Migrations

- Data transformations during schema changes
- Populating new columns with calculated values
- Moving data between tables
- Complex business logic migrations
- Seeding initial data

#### Creating a Custom Migration

1. **Create a new custom migration file**:

```bash
yarn workspace @buildone/app-server-ts db:migrate:generate <migration_name> --custom
```

2. **Modify the new custom migration file**:

Modify the custom migration file to apply the required changes.

For example

```bash
yarn workspace @buildone/app-server-ts db:migrate:generate seed_users --custom
```

```text
📦 app-server-ts
├── 📂 drizzle
│   ├── 📂 _meta
│   ├── 📜 0000_init.sql
│   ├── 📜 0001_add_users.sql
│   └── 📜 0002_seed_users.sql
├── 📂 src
└── …
```

```typescript
./drizzle/0001_seed-users.sql

INSERT INTO "users" ("name") VALUES('Dan');
INSERT INTO "users" ("name") VALUES('Andrew');
INSERT INTO "users" ("name") VALUES('Dandrew');
```

3. **Apply the custom migration**:

```bash
yarn workspace <project> drizzle-kit --config src/drizzle/drizzle.config.ts migrate

```

## Configuration

### Drizzle Config File

Ensure your `drizzle.config.ts` is properly configured:

```typescript
// src/drizzle/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default {
  schema: './src/drizzle/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL
  }
} satisfies Config;
```

## Best Practices

### Schema Migrations

1. **Always generate migrations for schema changes** - Don't modify the database directly
2. **Use descriptive migration names** - Makes it easier to understand what each migration does
3. **Test migrations thoroughly** - Run them against a copy of production data
4. **Keep migrations small and focused** - One logical change per migration
5. **Never edit existing migrations** - Create new ones to fix issues

### Data Migrations

1. **Handle large datasets carefully** - Use batching for operations on large tables
2. **Validate data integrity** - Add checks to ensure data consistency
3. **Use transactions** - Wrap complex operations in database transactions
4. **Log migration progress** - Especially for long-running operations

## Team Workflow

### New Workspace Setup

When a new workspace is created, it will automatically have all existing migrations applied to ensure database consistency across environments.

### Development Process

1. **Pull latest changes** from the repository
2. **Run pending migrations** to sync your local database (are also run on workspace startup)
3. **Make schema changes** in your development environment
4. **Generate and test migrations** locally
5. **Commit migration files** along with schema changes
6. **Deploy migrations** to staging/production environments

### Migration Coordination

- **Coordinate with team members** before making breaking changes
- **Document complex migrations** in commit messages or pull requests
- **Use feature flags** for gradual rollouts of schema changes
- **Plan downtime** for migrations that require it

## Troubleshooting

### Common Issues

1. **Migration conflicts** - Multiple developers changing the same schema

   - Solution: Communicate schema changes, merge conflicts in migration files

2. **Failed migrations** - Migration stops partway through

   - Solution: Check logs, fix issues, potentially roll back and retry

3. **Data inconsistencies** - Custom migrations don't handle edge cases

   - Solution: Add validation, use transactions, test with production-like data

4. **Performance issues** - Migrations take too long on large datasets
   - Solution: Use batching, run during maintenance windows, optimize queries

### Recovery Commands

```bash
# Check migration status
yarn workspace <project> drizzle-kit --config src/drizzle/drizzle.config.ts check


## Conclusion

Drizzle's migration system provides powerful tools for managing database evolution. By following these patterns and best practices, you can maintain a stable, version-controlled database schema while safely transforming data as your application grows.

Remember to always test migrations thoroughly and coordinate with your team when making significant database changes.
```
