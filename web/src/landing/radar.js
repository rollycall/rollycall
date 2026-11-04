// Roll-call radar: one dot per registered agent, coloured from /api/stats counts (exact),
// laid out on a sunflower disc. Positions are a deterministic shuffle, NOT agent ids (stated in the caption).
// A sweep "calls the roll": dots that answer (live) flare green as it passes. Reduced motion → one static frame.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const COL = {
  live: ['rgba(57,229,140,0.42)', '#7DFFB9', 1],
  unreachable: ['rgba(147,161,176,0.13)', '#B9C4CF', 0.28],
  dead: ['rgba(255,106,85,0.42)', '#FF8A78', 0.95],
  opaque: ['rgba(95,106,114,0.22)', null, 0],
};
const ORDER = ['live', 'unreachable', 'dead', 'opaque'];
const BUCKETS = 360, TRAIL = 100, PERIOD = 6500;

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function initRadar(canvas, { reduced = false } = {}) {
  const counts = Object.fromEntries(ORDER.map((k) => [k, Math.max(0, +canvas.dataset[k] || 0)]));
  const total = ORDER.reduce((a, k) => a + counts[k], 0);
  if (!total) return;
  // exact counts, shuffled positions (seed = chain id)
  const status = new Uint8Array(total);
  let p = 0; ORDER.forEach((k, si) => { for (let i = 0; i < counts[k]; i++) status[p++] = si; });
  const r = rng(4663);
  for (let i = total - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = status[i]; status[i] = status[j]; status[j] = t; }

  const ctx = canvas.getContext('2d');
  let W = 0, R = 0, dpr = 1, dot = 1, base = null, buckets = null, raf = 0, visible = true, t0 = performance.now();

  function layout() {
    const css = canvas.clientWidth; if (!css) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(css * dpr); canvas.width = W; canvas.height = W;
    R = W / 2 - 2 * dpr;
    dot = Math.max(1, R * Math.sqrt(Math.PI / total) * 0.5);
    buckets = Array.from({ length: BUCKETS }, () => ORDER.map(() => []));
    base = document.createElement('canvas'); base.width = W; base.height = W;
    const b = base.getContext('2d');
    // rings + crosshair
    b.strokeStyle = 'rgba(130,255,196,0.10)'; b.lineWidth = dpr;
    for (let k = 1; k <= 4; k++) { b.beginPath(); b.arc(W / 2, W / 2, (R * k) / 4, 0, Math.PI * 2); b.stroke(); }
    b.beginPath(); b.moveTo(W / 2 - R, W / 2); b.lineTo(W / 2 + R, W / 2); b.moveTo(W / 2, W / 2 - R); b.lineTo(W / 2, W / 2 + R); b.stroke();
    const xs = new Float32Array(total), ys = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const rad = R * Math.sqrt((i + 0.5) / total), th = i * GOLDEN;
      xs[i] = W / 2 + rad * Math.cos(th) - dot / 2; ys[i] = W / 2 + rad * Math.sin(th) - dot / 2;
      let deg = Math.floor(((th % (Math.PI * 2)) / (Math.PI * 2)) * BUCKETS); if (deg < 0) deg += BUCKETS;
      buckets[deg][status[i]].push(i);
    }
    ORDER.forEach((k, si) => { b.fillStyle = COL[k][0]; for (let i = 0; i < total; i++) if (status[i] === si) b.fillRect(xs[i], ys[i], dot, dot); });
    canvas._xs = xs; canvas._ys = ys;
  }

  function frame(now) {
    if (!base) return;
    const xs = canvas._xs, ys = canvas._ys;
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(base, 0, 0);
    const a = reduced ? null : (((now - t0) % PERIOD) / PERIOD) * BUCKETS;
    // sweep wedge
    if (a !== null && ctx.createConicGradient) {
      const ang = (a / BUCKETS) * Math.PI * 2;
      const g = ctx.createConicGradient(ang - (TRAIL / BUCKETS) * Math.PI * 2, W / 2, W / 2);
      g.addColorStop(0, 'rgba(57,229,140,0)'); g.addColorStop(TRAIL / BUCKETS, 'rgba(57,229,140,0.16)'); g.addColorStop(TRAIL / BUCKETS + 0.0001, 'rgba(57,229,140,0)'); g.addColorStop(1, 'rgba(57,229,140,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W / 2, W / 2, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(125,255,185,0.7)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(W / 2, W / 2); ctx.lineTo(W / 2 + R * Math.cos(ang), W / 2 + R * Math.sin(ang)); ctx.stroke();
    }
    // answered dots
    for (let k = 0; k < (a === null ? BUCKETS : TRAIL); k++) {
      const bi = a === null ? k : ((Math.floor(a) - k) % BUCKETS + BUCKETS) % BUCKETS;
      const fade = a === null ? 0.55 : Math.pow(1 - k / TRAIL, 1.6);
      ORDER.forEach((key, si) => {
        const [, hi, w] = COL[key]; if (!hi) return;
        const list = buckets[bi][si]; if (!list.length) return;
        ctx.globalAlpha = fade * w; ctx.fillStyle = hi;
        for (let j = 0; j < list.length; j++) { const i = list[j]; ctx.fillRect(xs[i], ys[i], dot, dot); }
      });
    }
    ctx.globalAlpha = 1;
    // centre ping
    ctx.fillStyle = '#7DFFB9'; ctx.beginPath(); ctx.arc(W / 2, W / 2, 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
    if (!reduced && visible) raf = requestAnimationFrame(frame);
  }

  const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); };
  layout(); start();
  if ('ResizeObserver' in window) { let last = canvas.clientWidth; new ResizeObserver(() => { if (canvas.clientWidth !== last) { last = canvas.clientWidth; layout(); start(); } }).observe(canvas); }
  if (!reduced) {
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; if (visible) start(); }).observe(canvas);
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) start(); });
  }
  canvas.classList.add('is-on');
}
