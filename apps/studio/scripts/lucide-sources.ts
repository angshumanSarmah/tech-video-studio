import { LUCIDE_VERSION, SEED_ASSETS } from '@explainer-studio/renderer/catalog';
import { icons } from 'lucide';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { featherNamesFromLicence, type LucideManifestInput } from '#core/assets/lucide-manifest.ts';

/**
 * What the Lucide manifest is built from, read from the installed packages: `lucide` (shapes,
 * export names, LICENSE with the Feather-derived list) and `lucide-static` (tags; a dev
 * dependency pinned to the same release).
 */
export function lucideManifestInput(): LucideManifestInput {
  const require = createRequire(import.meta.url);
  const lucideDir = dirname(require.resolve('lucide/package.json'));
  const staticDir = dirname(require.resolve('lucide-static/package.json'));
  const staticVersion = readVersion(staticDir);
  if (staticVersion !== LUCIDE_VERSION) {
    throw new Error(`lucide-static ${staticVersion} does not match lucide ${LUCIDE_VERSION}.`);
  }
  return {
    version: LUCIDE_VERSION,
    icons,
    tags: JSON.parse(readFileSync(join(staticDir, 'tags.json'), 'utf8')) as Record<
      string,
      string[]
    >,
    featherNames: featherNamesFromLicence(readFileSync(join(lucideDir, 'LICENSE'), 'utf8')),
    core: SEED_ASSETS,
  };
}

function readVersion(dir: string): string {
  return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string })
    .version;
}
