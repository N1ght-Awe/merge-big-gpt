import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.n1ghtawe.pocketgames',
  appName: '合成大GPT',
  webDir: 'dist',
  backgroundColor: '#f4edff',
  // No server.url: all code and artwork ship inside the APK, including first launch.
  android: { backgroundColor: '#f4edff', allowMixedContent: false },
};

export default config;
