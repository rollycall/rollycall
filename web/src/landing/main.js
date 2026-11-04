// Landing behaviour: copy buttons, radar sweep, one-time count-up, tally draw-in, scroll reveal.
// All numbers are already in the SSR HTML; JS only animates. Reduced motion → static radar frame, no motion.
import { initCopy, reducedMotion } from '../styles/ui.js';
import { initRadar } from './radar.js';

const reduced = reducedMotion();
document.documentElement.classList.add('js');
initCopy();
for (const c of document.querySelectorAll('canvas[data-radar]')) initRadar(c, { reduced });

if (!reduced) {
  for (const board of document.querySelectorAll('.rc-tally')) {
    const gates = board.querySelectorAll('.rc-gate');
    const step = Math.min(1, 45 / Math.max(gates.length, 1));
    gates.forEach((g, i) => g.style.setProperty('--g', String(Math.round(i * step))));
    board.classList.add('is-drawing');
  }
  // numbers count up once
  const els = [...document.querySelectorAll('[data-count]')];
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const dur = 900, t0 = performance.now();
  const targets = els.map((el) => +el.getAttribute('data-count') || 0);
  els.forEach((el) => { el.textContent = '0'; });
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    els.forEach((el, i) => { el.textContent = fmt(targets[i] * e); });
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(() => els.forEach((el, i) => { el.textContent = fmt(targets[i]); }), dur + 150);

  // scroll reveal
  const items = document.querySelectorAll('.rc-reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    items.forEach((el) => io.observe(el));
  } else items.forEach((el) => el.classList.add('is-in'));
}
