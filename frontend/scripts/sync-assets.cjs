const fs = require('node:fs');
const path = require('node:path');

const frontendRoot = path.join(__dirname, '..');
const repoRoot = path.join(frontendRoot, '..');
const src = path.join(repoRoot, 'static-public');
const dest = path.join(frontendRoot, 'public');

if (!fs.existsSync(src)) {
  console.log(
    'No `static-public/` at repo root. Add optional static files there to merge into `frontend/public/` (Vite).',
  );
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log('Synced `static-public/` → `frontend/public/`');
