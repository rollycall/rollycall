// OG image + PNG icons for Rollycall (owner: LANDING).
//   node web/art/og.mjs                                   → fixture stats, writes web/art/out/og.svg (+ PNGs if sharp is installed)
//   node web/art/og.mjs --stats https://rollycall.xyz/api/stats --out web/dist
//   node web/art/og.mjs --stats state/stats.json --out web/dist
// Text-only SVG → PNG via sharp (BRIEF §3.4: no satori needed). Re-run at deploy seed and at golive.
// Fonts: sharp/librsvg uses fontconfig; install Archivo Black + Red Hat Mono TTF on the build host
// (or the SVG falls back to Arial Black / monospace). See LANDING-NOTES.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const src = arg('--stats', path.join(here, 'fixtures/stats.json'));
const out = path.resolve(arg('--out', path.join(here, 'out')));
fs.mkdirSync(out, { recursive: true });

async function loadStats(s) {
  if (/^https?:/.test(s)) {
    const ctl = AbortSignal.timeout(15000);
    const r = await fetch(s, { signal: ctl, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`stats ${r.status}`);
    return r.json();
  }
  return JSON.parse(fs.readFileSync(s, 'utf8'));
}

const C = { paper: '#06090A', panel: '#0B1211', ink: '#E6F2EC', ink2: '#A7B6AF', line: '#1E3A30', live: '#39E58C', dead: '#FF6A55', slate: '#93A1B0', opaque: '#5F6A72' };
const n = (x) => Math.round(+x || 0).toLocaleString('en-US');
const utc = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`; };
const DISPLAY = "'Archivo Black', 'Arial Black', Arial, sans-serif";
const MONO = "'Red Hat Mono', 'DejaVu Sans Mono', Menlo, monospace";

export function ogSvg(st) {
  const per = 200, order = [['live', C.live], ['unreachable', C.slate], ['dead', C.dead], ['opaque', C.opaque]];
  const marks = [];
  for (const [k, col] of order) for (let i = 0; i < Math.round((+st[k] || 0) / per); i++) marks.push(col);
  // gates of five: 4 verticals + diagonal; 26 gates per row max
  let g = '', x0 = 80, y0 = 384;
  for (let i = 0, gi = 0; i < marks.length; i += 5, gi++) {
    const row = Math.floor(gi / 26), col = gi % 26;
    const gx = x0 + col * 40, gy = y0 + row * 52;
    const m = marks.slice(i, i + 5);
    m.slice(0, 4).forEach((c, j) => { g += `<line x1="${gx + 4 + j * 8}" y1="${gy}" x2="${gx + 4 + j * 8}" y2="${gy + 36}" stroke="${c}"/>`; });
    if (m[4]) g += `<line x1="${gx - 2}" y1="${gy + 31}" x2="${gx + 34}" y2="${gy + 5}" stroke="${m[4]}"/>`;
  }
  const tot = order.reduce((a, [k]) => a + (+st[k] || 0), 0) || 1;
  let bx = 80, bar = '';
  for (const [k, col] of order) { const w = (1040 * (+st[k] || 0)) / tot; if (w > 0) { bar += `<rect x="${bx.toFixed(1)}" y="520" width="${Math.max(w - 2, 1).toFixed(1)}" height="14" fill="${col}"/>`; bx += w; } }
  const fixture = st._fixture ? `<g><rect x="900" y="40" width="220" height="40" fill="${C.dead}"/><text x="1010" y="67" text-anchor="middle" font-family="${MONO}" font-size="18" font-weight="500" fill="#fff" letter-spacing="2">FIXTURE DATA</text></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><pattern id="g" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#82FFC4" stroke-opacity=".06"/></pattern><radialGradient id="glow" cx=".8" cy="0" r=".8"><stop offset="0" stop-color="#39E58C" stop-opacity=".18"/><stop offset="1" stop-color="#39E58C" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="${C.paper}"/><rect width="1200" height="630" fill="url(#g)"/><rect width="1200" height="630" fill="url(#glow)"/>
<rect x="40" y="40" width="1120" height="550" fill="${C.panel}" fill-opacity=".55" stroke="${C.line}" rx="14"/>
<g transform="translate(80 72)"><rect x=".5" y=".5" width="39" height="39" rx="8" fill="${C.panel}" stroke="${C.live}" stroke-opacity=".5"/><g stroke-linecap="round" stroke-width="3.2"><path d="M10 9v22M16.5 9v22M23 9v22M29.5 9v22" stroke="${C.ink}"/><path d="M5.5 26.5L34.5 13.5" stroke="${C.live}"/></g>
<text x="56" y="30" font-family="${DISPLAY}" font-size="30" fill="${C.ink}">Rollycall</text></g>
${fixture}
<text x="80" y="214" font-family="${DISPLAY}" font-size="82" fill="${C.ink2}" letter-spacing="-2">${n(st.registered)} registered.</text>
<text x="80" y="306" font-family="${DISPLAY}" font-size="82" fill="${C.live}" letter-spacing="-2">${n(st.live)} alive.</text>
<g stroke-linecap="round" stroke-width="3.4">${g}</g>
${bar}
<text x="80" y="566" font-family="${MONO}" font-size="20" fill="${C.ink2}">ERC-8004 agents on Robinhood Chain · counted ${utc(st.computedAt)}</text>
<text x="1120" y="566" text-anchor="end" font-family="${MONO}" font-size="20" font-weight="500" fill="${C.ink}">rollycall.xyz</text>
</svg>`;
}

const st = await loadStats(src);
const svg = ogSvg(st);
fs.writeFileSync(path.join(out, 'og.svg'), svg);
const fav = fs.readFileSync(path.join(here, 'favicon.svg'));
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { /* optional */ }
if (sharp) {
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, 'og.png'));
  for (const [f, s] of [['favicon-32.png', 32], ['icon-192.png', 192], ['icon-512.png', 512]]) await sharp(fav, { density: Math.ceil(72 * s / 32) }).resize(s, s).png().toFile(path.join(out, f));
  console.log('wrote', out, ['og.svg', 'og.png', 'favicon-32.png', 'icon-192.png', 'icon-512.png'].join(' '));
} else {
  console.log(`wrote ${path.join(out, 'og.svg')} — sharp not installed, PNGs skipped (APP: add "sharp" dependency)`);
}
