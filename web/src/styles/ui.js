// Shared browser behaviour for every Rollycall page: copy buttons ([data-copy]).
// Import from any page bundle: `import { initCopy } from '../styles/ui.js'; initCopy();`
export function initCopy(root = document) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = btn.getAttribute('data-copy');
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    const prev = btn.textContent;
    btn.textContent = ok ? 'Copied' : 'Select';
    if (ok) btn.setAttribute('data-done', '');
    setTimeout(() => { btn.textContent = prev; btn.removeAttribute('data-done'); }, 1400);
  });
}

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
