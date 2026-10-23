import type { Plugin, ResolvedConfig } from 'vite';
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

/** Keep archived artwork in source control, but exclude it from the offline APK. */
export function androidAssets(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'android-runtime-assets',
    configResolved(value) { config = value; },
    closeBundle() {
      const relative = 'assets/characters/repaired-v1';
      cpSync(resolve(config.root, 'public', relative), resolve(config.root, config.build.outDir, relative), { recursive: true });
    },
  };
}
