import { defineConfig } from 'vite';
import { androidAssets } from './build/android-assets';

export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5173, strictPort: true },
  build: { copyPublicDir: mode !== 'android' },
  plugins: mode === 'android' ? [androidAssets()] : [],
}));
