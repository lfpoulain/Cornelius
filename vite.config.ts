import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Le serveur suit PORT de .env : le proxy de développement doit viser le même port.
  const env = loadEnv(mode, process.cwd(), '');
  const server = 'http://127.0.0.1:' + (env.PORT || '3000');
  return {
    root: 'web',
    resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
    plugins: [react(), tailwind()],
    build: {
      outDir: '../dist/web',
      emptyOutDir: true,
      assetsInlineLimit: 0,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/, maxSize: 450_000 }],
          },
        },
      },
    },
    server: {
      // CORNELIUS_DEV_PORT : le serveur n'accepte que cette origine pour l'interface de dev.
      port: Number(env.CORNELIUS_DEV_PORT || 5173),
      strictPort: true,
      // Anchored patterns: /api/, /events and /audio are also module paths
      // (web/api.ts, web/audio/*), a plain prefix would swallow them.
      proxy: {
        '^/api/': server,
        '^/events(\\?|$)': { target: server.replace('http', 'ws'), ws: true },
        '^/audio(\\?|$)': { target: server.replace('http', 'ws'), ws: true },
      },
    },
  };
});
