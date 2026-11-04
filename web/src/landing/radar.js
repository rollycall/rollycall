// Roll-call radar, semi-3D: one dot per registered agent on a tilted disc, coloured from /api/stats counts (exact).
// Positions are a seeded shuffle, NOT agent ids (the caption says so). A sweep "calls the roll": live dots it passes
// rise off the plate and glow, then settle. Pointer + scroll tilt the camera a few degrees.
// Performance: dpr ≤ 2, the plate is cached while the camera is still, rAF stops offscreen / in hidden tabs.
// Reduced motion: one static tilted frame, no pointer, no sweep.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const ORDER = ['live', 'unreachable', 'dead', 'opaque'];
const BASE = ['rgba(57,229,140,0.40)', 'rgba(147,161,176,0.16)', 'rgba(255,106,85,0.50)', 'rgba(95,106,114,0.26)'];
const HI = ['#7DFFB9', '#C9D3DC', '#FF8A78', null];
const HIW = [1, 0.3, 0.95, 0];
const BUCKETS = 360, TRAIL = 110, PERIOD = 7000;

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function initRadar(canvas, { reduced = false } = {}) {
  const counts = ORDER.map((k) => Math.max(0, +canvas.dataset[k] || 0));
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return;
  const status = new Uint8Array(total);
  let p = 0; counts.forEach((n, si) => { for (let i = 0; i < n; i++) status[p++] = si; });
  const r = rng(4663);
  for (let i = total - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = status[i]; status[i] = status[j]; status[j] = t; }

  // unit-disc sunflower + angle buckets (computed once)
  const U = new Float32Array(total), V = new Float32Array(total);
  const buckets = Array.from({ length: BUCKETS }, () => ORDER.map(() => []));
  for (let i = 0; i < total; i++) {
    const rad = Math.sqrt((i + 0.5) / total), th = i * GOLDEN;
    U[i] = rad * Math.cos(th); V[i] = rad * Math.sin(th);
    let deg = Math.floor(((th % (Math.PI * 2)) / (Math.PI * 2)) * BUCKETS); if (deg < 0) deg += BUCKETS;
    buckets[deg][status[i]].push(i);
  }

  const ctx = canvas.getContext('2d');
  const plate = document.createElement('canvas'), pctx = plate.getContext('2d');
  const SX = new Float32Array(total), SY = new Float32Array(total), SS = new Float32Array(total);
  let W = 0, H = 0, R = 0, dpr = 1, dot = 1, raf = 0, visible = true, t0 = performance.now();
  const cam = { tilt: 0.98, yaw: 0 }, want = { tilt: 0.98, yaw: 0 };
  let plateKey = '';

  const F = () => 2.8 * R;
  // world (x,y,z) → screen; z < 0 lifts toward the viewer ("up" off the plate)
  function proj(u, v, z, c, s, ct, st, out, i) {
    const x = (u * c - v * s) * R, y = (u * s + v * c) * R;
    const yy = y * ct + z * st, zc = -y * st + z * ct;
    const k = F() / (F() + zc);
    out[0] = W / 2 + x * k; out[1] = H * 0.5 + yy * k; out[2] = k;
  }
  const tmp = [0, 0, 0];

  function layout() {
    const cw = canvas.clientWidth; if (!cw) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.round(cw * dpr); H = Math.round(canvas.clientHeight * dpr);
    canvas.width = W; canvas.height = H; plate.width = W; plate.height = H;
    R = Math.min(W * 0.47, H * 0.9);
    dot = Math.max(1, R * Math.sqrt(Math.PI / total) * 0.52);
    plateKey = '';
  }

  function drawPlate() {
    const key = cam.tilt.toFixed(3) + ':' + cam.yaw.toFixed(3);
    if (key === plateKey) return;
    plateKey = key;
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw), ct = Math.cos(cam.tilt), st = Math.sin(cam.tilt);
    pctx.clearRect(0, 0, W, H);
    // under-glow
    proj(0, 0, 0, c, s, ct, st, tmp);
    const g = pctx.createRadialGradient(tmp[0], tmp[1], 0, tmp[0], tmp[1], R * 1.05);
    g.addColorStop(0, 'rgba(57,229,140,0.10)'); g.addColorStop(1, 'rgba(57,229,140,0)');
    pctx.save(); pctx.translate(tmp[0], tmp[1]); pctx.scale(1, ct); pctx.translate(-tmp[0], -tmp[1]);
    pctx.fillStyle = g; pctx.beginPath(); pctx.arc(tmp[0], tmp[1], R * 1.05, 0, Math.PI * 2); pctx.fill(); pctx.restore();
    // rings + crosshair
    pctx.lineWidth = dpr;
    for (let k = 1; k <= 4; k++) {
      pctx.strokeStyle = k === 4 ? 'rgba(130,255,196,0.30)' : 'rgba(130,255,196,0.10)';
      pctx.beginPath();
      for (let a = 0; a <= 96; a++) { const th = (a / 96) * Math.PI * 2; proj((k / 4) * Math.cos(th), (k / 4) * Math.sin(th), 0, c, s, ct, st, tmp); a ? pctx.lineTo(tmp[0], tmp[1]) : pctx.moveTo(tmp[0], tmp[1]); }
      pctx.stroke();
    }
    pctx.strokeStyle = 'rgba(130,255,196,0.08)'; pctx.beginPath();
    for (const [u0, v0, u1, v1] of [[-1, 0, 1, 0], [0, -1, 0, 1]]) { proj(u0, v0, 0, c, s, ct, st, tmp); pctx.moveTo(tmp[0], tmp[1]); proj(u1, v1, 0, c, s, ct, st, tmp); pctx.lineTo(tmp[0], tmp[1]); }
    pctx.stroke();
    // rim thickness (semi-3D plate edge)
    pctx.strokeStyle = 'rgba(57,229,140,0.16)'; pctx.lineWidth = 6 * dpr; pctx.beginPath();
    for (let a = 0; a <= 96; a++) { const th = (a / 96) * Math.PI; proj(Math.cos(th), Math.sin(th), 0, c, s, ct, st, tmp); a ? pctx.lineTo(tmp[0], tmp[1] + 3 * dpr) : pctx.moveTo(tmp[0], tmp[1] + 3 * dpr); }
    pctx.stroke();
    // dots
    for (let i = 0; i < total; i++) { proj(U[i], V[i], 0, c, s, ct, st, tmp); SX[i] = tmp[0]; SY[i] = tmp[1]; SS[i] = tmp[2]; }
    for (let si = 0; si < 4; si++) {
      pctx.fillStyle = BASE[si];
      for (let i = 0; i < total; i++) if (status[i] === si) { const d = dot * SS[i]; pctx.fillRect(SX[i] - d / 2, SY[i] - d / 2, d, d); }
    }
  }

  function frame(now) {
    if (!W) return;
    cam.tilt += (want.tilt - cam.tilt) * 0.08; cam.yaw += (want.yaw - cam.yaw) * 0.08;
    if (Math.abs(want.tilt - cam.tilt) < 0.0005) cam.tilt = want.tilt;
    if (Math.abs(want.yaw - cam.yaw) < 0.0005) cam.yaw = want.yaw;
    drawPlate();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(plate, 0, 0);
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw), ct = Math.cos(cam.tilt), st = Math.sin(cam.tilt);
    const a = reduced ? null : (((now - t0) % PERIOD) / PERIOD) * BUCKETS;
    const lift = R * 0.11;
    if (a !== null) {
      // trailing wedge on the plate
      const steps = 14, span = (TRAIL / BUCKETS) * Math.PI * 2, end = (a / BUCKETS) * Math.PI * 2;
      for (let k = 0; k < steps; k++) {
        const a0 = end - span * (1 - k / steps), a1 = end - span * (1 - (k + 1) / steps);
        ctx.fillStyle = `rgba(57,229,140,${(0.16 * Math.pow((k + 1) / steps, 2)).toFixed(3)})`;
        ctx.beginPath(); proj(0, 0, 0, c, s, ct, st, tmp); ctx.moveTo(tmp[0], tmp[1]);
        for (let q = 0; q <= 4; q++) { const th = a0 + ((a1 - a0) * q) / 4; proj(Math.cos(th), Math.sin(th), 0, c, s, ct, st, tmp); ctx.lineTo(tmp[0], tmp[1]); }
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(125,255,185,0.85)'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
      proj(0, 0, 0, c, s, ct, st, tmp); ctx.moveTo(tmp[0], tmp[1]); proj(Math.cos(end), Math.sin(end), 0, c, s, ct, st, tmp); ctx.lineTo(tmp[0], tmp[1]); ctx.stroke();
    }
    // answered dots: live ones rise and glow (additive blend instead of shadowBlur: cheap)
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < (a === null ? BUCKETS : TRAIL); k++) {
      const bi = a === null ? k : ((Math.floor(a) - k) % BUCKETS + BUCKETS) % BUCKETS;
      const fade = a === null ? 0.5 : Math.pow(1 - k / TRAIL, 1.7);
      for (let si = 0; si < 3; si++) {
        const list = buckets[bi][si]; if (!list.length || !HI[si]) continue;
        ctx.globalAlpha = fade * HIW[si]; ctx.fillStyle = HI[si];
        const z = si === 0 && a !== null ? -lift * fade : 0;
        for (let j = 0; j < list.length; j++) {
          const i = list[j];
          let x = SX[i], y = SY[i], kk = SS[i];
          if (z) { proj(U[i], V[i], z, c, s, ct, st, tmp); x = tmp[0]; y = tmp[1]; kk = tmp[2]; }
          const d = dot * kk * (si === 0 ? 1.15 : 1); ctx.fillRect(x - d / 2, y - d / 2, d, d);
        }
      }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    proj(0, 0, 0, c, s, ct, st, tmp);
    ctx.fillStyle = '#7DFFB9'; ctx.beginPath(); ctx.arc(tmp[0], tmp[1], 2.5 * dpr, 0, Math.PI * 2); ctx.fill();
    if (!reduced && visible) raf = requestAnimationFrame(frame);
  }

  const start = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); };
  layout(); start();
  if ('ResizeObserver' in window) { let last = canvas.clientWidth; new ResizeObserver(() => { if (canvas.clientWidth !== last) { last = canvas.clientWidth; layout(); start(); } }).observe(canvas); }
  if (reduced) return;
  const baseTilt = 0.98;
  const onScroll = () => { want.tilt = baseTilt + Math.min(window.scrollY / 700, 1) * 0.22 + ptrTilt; };
  let ptrTilt = 0;
  if (matchMedia('(pointer: fine)').matches) {
    window.addEventListener('pointermove', (e) => {
      want.yaw = (e.clientX / window.innerWidth - 0.5) * 0.35;
      ptrTilt = (e.clientY / window.innerHeight - 0.5) * 0.1; onScroll();
    }, { passive: true });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; if (visible) start(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) start(); });
}
