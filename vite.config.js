import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Dev / preview: serve the ordering app for clean URLs under /siparis (matches production nginx). */
function siparisSpaFallback() {
  const siparis = /^\/siparis(?=\/|$)/;
  const rewrite = (req) => {
    const raw = req.url ?? '';
    const path = raw.split('?')[0] ?? '';
    if (!siparis.test(path)) return;
    const q = raw.includes('?') ? `?${raw.split('?')[1]}` : '';
    req.url = `/customer.html${q}`;
  };
  return {
    name: 'siparis-spa-fallback',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        rewrite(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        rewrite(req);
        next();
      });
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [siparisSpaFallback()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        customer: resolve(__dirname, 'customer.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
