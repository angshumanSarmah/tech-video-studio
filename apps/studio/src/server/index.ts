import { serve } from '@hono/node-server';
import { loadConfig } from '#core/config.ts';
import { ensureDataDirs } from '#core/data-dirs.ts';
import { createApp } from '#server/app.ts';

const config = loadConfig();
ensureDataDirs(config.dataDir);

const server = serve({ fetch: createApp().fetch, port: config.port }, (info) => {
  console.log(`[server] listening on http://localhost:${info.port}`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
