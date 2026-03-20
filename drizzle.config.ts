import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/drizzle-migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env['DB_PATH'] ?? 'papai.db',
  },
})
