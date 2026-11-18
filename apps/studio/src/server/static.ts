import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

/**
 * Serves the built SPA (prod only; in dev Vite serves it and proxies `/api`). Unknown non-API
 * paths fall back to `index.html` so client-side routes survive a reload. Mount after `/api`.
 */
export function mountSpa(app: Hono, webDistDir: string): void {
  app.use('*', serveStatic({ root: webDistDir }));
  app.get('*', serveStatic({ root: webDistDir, path: 'index.html' }));
}
