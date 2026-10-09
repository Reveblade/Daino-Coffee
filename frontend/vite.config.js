import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function redirectTableShortPath(req, res, next) {
  const raw = req.url ?? '';
  const path = raw.split('?')[0] ?? '';
  const m = /^\/t\/([^/]+)\/?$/.exec(path);
  if (!m) return next();
  const qs = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
  res.statusCode = 302;
  res.setHeader('Location', `/siparis/masa/${encodeURIComponent(m[1])}${qs}`);
  res.end();
}

/** Dev / preview: same short QR path as production nginx (`/t/{slug}` → ordering app). */
function menuTableShortPathRedirect() {
  return {
    name: 'menu-table-short-path-redirect',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(redirectTableShortPath);
    },
    configurePreviewServer(server) {
      server.middlewares.use(redirectTableShortPath);
    },
  };
}

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
  plugins: [menuTableShortPathRedirect(), siparisSpaFallback()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        customer: resolve(__dirname, 'customer.html'),
        iletisim: resolve(__dirname, 'iletisim.html'),
        anket: resolve(__dirname, 'anket.html'),
        ekipmanEspresso: resolve(__dirname, 'ekipman/espresso-makinesi.html'),
        ekipmanGrinder: resolve(__dirname, 'ekipman/kahve-ogutucusu.html'),
        ekipmanFiltre: resolve(__dirname, 'ekipman/filtre-demleme.html'),
        ekipmanKettle: resolve(__dirname, 'ekipman/ince-uclu-kettle.html'),
        ekipmanSut: resolve(__dirname, 'ekipman/sut-ve-pitcher.html'),
        ekipmanTarti: resolve(__dirname, 'ekipman/dijital-tarti.html'),
        kahveEspresso: resolve(__dirname, 'kahve/espresso.html'),
        kahveAmericano: resolve(__dirname, 'kahve/americano.html'),
        kahveLatte: resolve(__dirname, 'kahve/latte.html'),
        kahveTurkKahvesi: resolve(__dirname, 'kahve/turk-kahvesi.html'),
        kahveKaramelMacchiato: resolve(__dirname, 'kahve/karamel-macchiato.html'),
        kahveCappuccino: resolve(__dirname, 'kahve/cappuccino.html'),
        kahveColdBrew: resolve(__dirname, 'kahve/cold-brew.html'),
        kahveBuzluKaramelLatte: resolve(__dirname, 'kahve/buzlu-karamel-latte.html'),
        kahveBuzluMocha: resolve(__dirname, 'kahve/buzlu-mocha.html'),
        kahveBuzluMatchaEspresso: resolve(__dirname, 'kahve/buzlu-matcha-espresso.html'),
        kahveBogurtlenHibiskus: resolve(__dirname, 'kahve/bogurtlen-hibiskus.html'),
        icecekHibiskusCayi: resolve(__dirname, 'icecek/hibiskus-cayi.html'),
        icecekLimonata: resolve(__dirname, 'icecek/limonata.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
