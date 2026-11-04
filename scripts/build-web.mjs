// Build web/dist: concatenated CSS, landing bundle, fonts, icons. Run: npm run build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web/dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });

const cssFiles = ['tokens', 'fonts', 'base', 'components'].map((f) => `web/src/styles/${f}.css`)
  .concat(['web/src/landing/landing.css', 'web/src/pages/pages.css']);
fs.writeFileSync(path.join(dist, 'app.css'), cssFiles.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n'));
await build({ entryPoints: [path.join(root, 'web/src/landing/main.js')], bundle: true, minify: true, format: 'iife', outfile: path.join(dist, 'landing.js') });
fs.writeFileSync(path.join(dist, 'pages.js'), `import { initCopy } from '../src/styles/ui.js'; initCopy();`);
await build({ entryPoints: [path.join(dist, 'pages.js')], bundle: true, minify: true, format: 'iife', outfile: path.join(dist, 'pages.js'), allowOverwrite: true });

const fonts = { 'archivo-black': ['400'], 'public-sans': ['400', '600'], 'red-hat-mono': ['400', '500'] };
for (const [pkg, ws] of Object.entries(fonts)) for (const w of ws) {
  const f = `${pkg}-latin-${w}-normal.woff2`;
  fs.copyFileSync(path.join(root, `node_modules/@fontsource/${pkg}/files/${f}`), path.join(dist, 'fonts', f));
}
for (const f of ['favicon.svg', 'site.webmanifest']) fs.copyFileSync(path.join(root, 'web/art', f), path.join(dist, f));
console.log('web/dist built');
