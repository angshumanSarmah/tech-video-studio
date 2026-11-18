import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadConfig } from '#core/config.ts';
import { ensureDataDirs } from '#core/data-dirs.ts';
import { closeDatabase, dbPathFor, openDatabase } from '#core/db/client.ts';
import { createApp } from '#server/app.ts';

/** `dist/node/server/index.js` -> `dist/web`. Only meaningful in the built bundle. */
const WEB_DIST_DIR = fileURLToPath(new URL('../../web', import.meta.url));

// tsup sets NODE_ENV=production at build time; under tsx (dev) Vite serves the SPA instead.
const isProductionBuild = process.env['NODE_ENV'] === 'production';

const config = loadConfig();
ensureDataDirs(config.dataDir);
const db = openDatabase(dbPathFor(config.dataDir));

const app = createApp({
  db,
  webDistDir: isProductionBuild ? WEB_DIST_DIR : undefined,
  enableDevRoutes: !isProductionBuild,
});

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
});

function shutdown(): void {
  server.close(() => {
    closeDatabase(db);
    process.exit(0);
  });
  // Open SSE streams never end on their own and would hold `close` forever.
  if ('closeAllConnections' in server) server.closeAllConnections();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
