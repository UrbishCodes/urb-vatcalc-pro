// ─────────────────────────────────────────────────────────────────────────────
// Shared VAT rate — one rate everywhere: Sales view, calculator TAX keys,
// rate dialogs. Persisted per device in localStorage; components stay in sync
// through the 'urb991:rate' window event.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'urb991.rate';

export function getRate(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(KEY);
    if (v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  } catch {
    return null;
  }
}

export function setRate(r: number) {
  if (typeof window === 'undefined' || !Number.isFinite(r)) return;
  const v = Math.min(100, Math.max(0, r));
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent<number>('urb991:rate', { detail: v }));
}

export function onRateChange(fn: (r: number) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<number>).detail);
  window.addEventListener('urb991:rate', h);
  return () => window.removeEventListener('urb991:rate', h);
}
