import { defineConfig } from 'drizzle-kit';

// Used only by `pnpm db:generate`; migrations are applied at runtime by `#core/db/migrate.ts`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/core/db/schema.ts',
  out: './drizzle',
});
