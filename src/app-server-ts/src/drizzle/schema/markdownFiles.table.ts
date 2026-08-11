import { pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const markdownFiles = pgTable('markdown_files', {
  id: serial('id').primaryKey().notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  sampleTipTap: text('sample_tip_tap'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});
