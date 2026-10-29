'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Minus, Plus, ReceiptText, RotateCcw, Save, Speech, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { narrator } from '@/lib/calc/narrator';
import { getRate, onRateChange, setRate } from '@/lib/calc/rate';

// ─────────────────────────────────────────────────────────────────────────────
// SALES & VAT — the default home.
//
// Two modes (NON-REVERSE default · REVERSE) and one golden rule:
// THE FIELD YOU TOUCH WINS — everything else adjusts around it.
//   · type QTY or RATE → your value is honoured verbatim, the amounts follow
//     (qty × rate rebuild the base — nothing ever reverts your typing)
//   · type an AMOUNT (base or incl.-VAT) → the units absorb per unit type:
//       Pcs    the RATE absorbs (rate = base ÷ qty)
//       Dozen  qty stays on the half-dozen grid · the rate absorbs decimals
//       Kg     QTY absorbs by default; touch qty → the RATE absorbs instead
// Tidy chips offer nearby bill-friendly values (4.5 / 2.25 / quarter steps);
// round pairs nudge the total so qty AND rate both look neat.
// The sales ledger is per-device — every device keeps its own history.
// ─────────────────────────────────────────────────────────────────────────────

type Mode = 'nonrev' | 'rev';
type Unit = 'pcs' | 'kg' | 'dozen';

const UNITS: Record<Unit, string> = { pcs: 'Pcs', kg: 'Kg', dozen: 'Dozen' };
const UNIT_WORD: Record<Unit, string> = { pcs: 'pieces', kg: 'kilograms', dozen: 'dozen' };
const VAT_PRESETS = [5, 10, 13, 15, 20, 25];

const MODE_HINT: Record<Mode, string> = {
  nonrev:
    'You type the amount BEFORE VAT — the VAT and the incl.-VAT total fill themselves in. Qty × rate build the base.',
  rev: 'You type the INCL.-VAT total — the before-VAT base and the VAT fill themselves in. Qty & rate solve on the base.',
};

const UNIT_HINT: Record<Unit, string> = {
  pcs: 'Pcs — type the qty or the rate freely, the amounts follow. Edit an amount and the rate absorbs (rate = base ÷ qty).',
  kg: 'Kg — edit an amount: qty absorbs by default; once you touch the qty, the rate absorbs instead (and vice versa).',
  dozen: 'Dozen — qty moves in half-dozen steps (0.5 · 1 · 1.5 …). Edit an amount and the rate absorbs the decimals.',
};

// ── math helpers ─────────────────────────────────────────────────────────────

const roundTo = (v: number, dp: number) => {
  const m = Math.pow(10, dp);
  return Math.round(v * m + Number.EPSILON) / m;
};
const snap = (v: number, step: number) => Math.round(v / step) * step;
const trim = (v: number, dp = 2) => {
  if (!Number.isFinite(v)) return '0';
  let s = roundTo(v, dp).toFixed(dp);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};
const money = (v: number | null) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQ = (v: number, u: Unit) =>
  u === 'pcs' ? trim(v, 3) : u === 'dozen' ? trim(v, 1) : trim(v, 3);
const num = (s: string) => s.replace(/[^0-9.]/g, '');
const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Kg: rate stays fixed, the weight absorbs decimals at the smallest precision
    (2–5 dp) that lands within half a cent of the base. */
function kgQty(X: number, rate: number): number {
  for (let p = 2; p <= 5; p++) {
    const q = roundTo(X / rate, p);
    if (Math.abs(q * rate - X) <= 0.005) return q;
  }
  return roundTo(X / rate, 4);
}

/** tidy candidate values near v at quarter / half / whole granularities */
function grid(v: number, gs: number[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const g of gs) {
    for (const m of [Math.floor(v / g), Math.ceil(v / g)]) {
      const c = roundTo(m * g, 4);
      // skip only the exact current value — a candidate a hair away (4.5 next
      // to 4.5033) is precisely the tidy option worth offering
      if (c <= 0 || Math.abs(c - v) < 1e-9) continue;
      const k = c.toFixed(4);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  out.sort((a, b) => Math.abs(a - v) - Math.abs(b - v));
  return out;
}

// number → spoken words (for the "hear it aloud" button)
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', ' thousand', ' million', ' billion'];

function intWords(n: number): string {
  if (n === 0) return 'zero';
  let out = '';
  let g = 0;
  let x = Math.floor(Math.abs(n));
  while (x > 0) {
    const grp = x % 1000;
    x = Math.floor(x / 1000);
    if (grp) {
      let s = '';
      const h = Math.floor(grp / 100);
      const t = Math.floor((grp % 100) / 10);
      const o = grp % 10;
      if (h) s += ONES[h] + ' hundred';
      if (t >= 2) {
        s += (s ? ' ' : '') + TENS[t];
        if (o) s += '-' + ONES[o];
      } else if (t * 10 + o > 0) {
        s += (s ? ' ' : '') + ONES[t * 10 + o];
      }
      out = s + SCALES[g] + (out ? ' ' + out : '');
    }
    g++;
  }
  return out;
}
function numWords(v: number): string {
  if (!Number.isFinite(v)) return ' error';
  const neg = v < 0;
  const x = Math.abs(v);
  if (x >= 1e12) return ' number too large';
  const i = Math.floor(x);
  const fr = x - i;
  let fs = '';
  if (fr > 1e-9) {
    const d = fr.toFixed(2).slice(2).replace(/0+$/, '');
    fs = ' point ' + d.split('').map((c) => ONES[+c]).join(' ');
  }
  return (neg ? 'minus ' : '') + intWords(i) + fs;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()} ${hh}:${mm}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-100px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ── per-device persistence ───────────────────────────────────────────────────

const DEV_KEY = 'urb991.device';

interface LineRec {
  id: string;
  ts: number;
  item: string;
  mode: Mode;
  unit: Unit;
  qty: number;
  rate: number;
  net: number;
  vat: number;
  gross: number;
}

interface SalesStored {
  mode: Mode;
  vat: string;
  net: string;
  gross: string;
  qty: string;
  rate: string;
  unit: Unit;
  item: string;
  kgAnchor: 'rate' | 'qty';
  anchorAmt: 'net' | 'gross';
  lines: LineRec[];
}

const storeKey = () => `urb991.sales.v1.${localStorage.getItem(DEV_KEY) || 'na'}`;

// ── component ────────────────────────────────────────────────────────────────

export default function Sales() {
  const { toast } = useToast();

  const [mode, setMode] = useState<Mode>('nonrev');
  const [vat, setVat] = useState('13');
  const [net, setNet] = useState('');
  const [gross, setGross] = useState('');
  const [unit, setUnit] = useState<Unit>('pcs');
  const [qty, setQty] = useState('');
  const [rate, setRateStr] = useState('');
  const [item, setItem] = useState('');
  const [anchorAmt, setAnchorAmt] = useState<'net' | 'gross'>('net');
  const [kgAnchor, setKgAnchor] = useState<'rate' | 'qty'>('rate');
  const [lines, setLines] = useState<LineRec[]>([]);
  const [deviceTag, setDeviceTag] = useState('');
  const [loaded, setLoaded] = useState(false);

  // the field the user touched LAST wins verbatim — everything else adjusts
  const [lastField, setLastField] = useState<'net' | 'gross' | 'qty' | 'rate' | null>(null);
  // while a unit field is focused it shows exactly what is typed (so it can
  // be cleared / retyped); on blur the solved form takes over
  const [focusField, setFocusField] = useState<'qty' | 'rate' | null>(null);
  const holdRef = useRef<{ t: ReturnType<typeof setTimeout> | null; i: ReturnType<typeof setInterval> | null }>({
    t: null,
    i: null,
  });

  // ── load (per-device) ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      let dev: string | null = null;
      try {
        dev = localStorage.getItem(DEV_KEY);
      } catch {
        dev = null;
      }
      if (!dev) dev = 'na';
      setDeviceTag(dev.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || '0000');
      const raw = localStorage.getItem(`urb991.sales.v1.${dev}`);
      if (raw) {
        const s = JSON.parse(raw) as Partial<SalesStored>;
        if (s.mode === 'rev' || s.mode === 'nonrev') setMode(s.mode);
        if (typeof s.vat === 'string') setVat(s.vat);
        if (typeof s.net === 'string') setNet(s.net);
        if (typeof s.gross === 'string') setGross(s.gross);
        if (typeof s.qty === 'string') setQty(s.qty);
        if (typeof s.rate === 'string') setRateStr(s.rate);
        if (s.unit === 'pcs' || s.unit === 'kg' || s.unit === 'dozen') setUnit(s.unit);
        if (typeof s.item === 'string') setItem(s.item);
        if (s.kgAnchor === 'qty' || s.kgAnchor === 'rate') setKgAnchor(s.kgAnchor);
        if (s.anchorAmt === 'net' || s.anchorAmt === 'gross') setAnchorAmt(s.anchorAmt);
        if (Array.isArray(s.lines)) setLines(s.lines.filter((l) => l && typeof l.net === 'number'));
      } else {
        // first visit — friendly live demo
        setNet('1000');
        setVat('13');
        setQty('4');
      }
      // shared rate wins: Sales and the calculator use ONE VAT rate
      const shared = getRate();
      if (shared != null) setVat(String(parseFloat(shared.toFixed(2))));
    } catch {
      /* start fresh */
    }
    setLoaded(true);
  }, []);

  // ── persist + keep the shared rate in sync ───────────────────────────────
  useEffect(() => {
    if (!loaded) return;
    try {
      const s: SalesStored = { mode, vat, net, gross, qty, rate, unit, item, kgAnchor, anchorAmt, lines };
      localStorage.setItem(storeKey(), JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
    const v = parseFloat(vat);
    const cur = getRate();
    if (Number.isFinite(v) && v >= 0 && Math.abs(v - (cur ?? -1)) > 1e-9) {
      setRate(Math.min(99, Math.max(0, v)));
    }
  }, [loaded, mode, vat, net, gross, qty, rate, unit, item, kgAnchor, anchorAmt, lines]);

  // calculator changed the rate → follow
  useEffect(() => {
    if (!loaded) return;
    return onRateChange((r) => {
      if (!Number.isFinite(r)) return;
      const s = String(parseFloat(r.toFixed(2)));
      setVat((prev) => (prev === s ? prev : s));
    });
  }, [loaded]);

  // ── the solve — one pass over the linked fields ──────────────────────────
  // Golden rule: the field the user touched LAST is honoured verbatim.
  //   · last touch = qty / rate  → qty × rate rebuild the base; amounts follow
  //   · last touch = an amount   → the base is that amount; the units absorb
  //     per unit type (pcs: rate absorbs · dozen: rate absorbs · kg: sticky)
  const st = useMemo(() => {
    const v = Math.min(99, Math.max(0, parseFloat(vat) || 0));
    const netN = parseFloat(net);
    const grossN = parseFloat(gross);
    const qtyN = parseFloat(qty);
    const rateN = parseFloat(rate);

    const hasQty = Number.isFinite(qtyN) && qtyN > 0;
    const hasRate = Number.isFinite(rateN) && rateN > 0;
    // dozen qty always lives on the half-dozen grid
    const q0 = hasQty ? (unit === 'dozen' ? Math.max(0.5, snap(qtyN, 0.5)) : qtyN) : null;
    const r0 = hasRate ? rateN : null;

    const unitFresh = lastField === 'qty' || lastField === 'rate';
    const unitsBuild = unitFresh && q0 != null && r0 != null;

    // base (X) — the before-tax subtotal everything else hangs off
    let X: number | null = null;
    let G: number | null = null;
    if (unitsBuild) {
      // the user just set the units → the units build the base
      X = roundTo(q0! * r0!, 6);
      G = X * (1 + v / 100);
    } else if (anchorAmt === 'gross') {
      if (Number.isFinite(grossN) && grossN > 0) {
        G = grossN;
        X = G / (1 + v / 100);
      }
    } else if (Number.isFinite(netN) && netN > 0) {
      X = netN;
      G = X * (1 + v / 100);
    }
    const Vat = X != null && G != null ? G - X : null;

    // qty × rate — the field the user did NOT touch absorbs
    let Q: number | null = null;
    let R: number | null = null;
    if (unitsBuild) {
      Q = q0;
      R = r0;
    } else if (X != null && X > 0) {
      if (unit === 'pcs') {
        if (q0 != null) {
          Q = q0; // qty honoured — the rate absorbs
          R = X / Q;
        } else if (r0 != null) {
          R = r0; // typed rate honoured — the qty solves
          Q = roundTo(X / r0, 4);
        }
      } else if (unit === 'dozen') {
        if (q0 != null) {
          Q = q0;
          R = X / Q; // rate absorbs the snap remainder
        } else if (r0 != null) {
          Q = Math.max(0.5, snap(X / r0, 0.5));
          R = X / Q;
        }
      } else {
        // kg — default: qty absorbs (rate anchored); touch qty → rate absorbs
        if (kgAnchor === 'qty' && q0 != null) {
          Q = q0;
          R = X / q0;
        } else if (r0 != null) {
          Q = kgQty(X, r0);
          R = r0;
        } else if (q0 != null) {
          Q = q0;
          R = X / q0;
        }
      }
    }

    return { v, X, G, Vat, Q, R, unitsBuild };
  }, [vat, net, gross, qty, rate, unit, anchorAmt, kgAnchor, lastField]);

  // ── linked displays, derived at render (no write-back loops) ────────────
  // the solved side always shows its solved value; the side the user typed
  // is identical to its solved value (nothing reverts); a focused unit field
  // always shows the raw keystrokes so it can be cleared / retyped freely
  const qsSolved = st.Q != null ? fmtQ(st.Q, unit) : null;
  const rsSolved = st.R != null ? trim(st.R, 4) : null;
  const netDisplay = st.unitsBuild
    ? st.X != null
      ? trim(st.X)
      : ''
    : anchorAmt === 'net'
      ? net
      : st.X != null
        ? trim(st.X)
        : '';
  const grossDisplay = st.unitsBuild
    ? st.G != null
      ? trim(st.G)
      : ''
    : anchorAmt === 'gross'
      ? gross
      : st.G != null
        ? trim(st.G)
        : '';
  const qtyDisplay = focusField === 'qty' ? qty : (qsSolved ?? qty);
  const rateDisplay = focusField === 'rate' ? rate : (rsSolved ?? rate);

  // the units just rebuilt the base → keep both amount fields (and the
  // per-device storage) in lockstep with the derived values
  useEffect(() => {
    if (!loaded || !st.unitsBuild) return;
    const n = st.X != null ? trim(st.X) : '';
    const g = st.G != null ? trim(st.G) : '';
    if (net !== n) setNet(n);
    if (gross !== g) setGross(g);
  }, [loaded, st.unitsBuild, st.X, st.G, net, gross]);

  // solved unit values are committed back into state whenever they are NOT
  // being raw-edited — so state, screen and solver always agree. This is what
  // makes unit switches / amount edits never resurrect stale values (the
  // classic "my typed number reverted" bug can no longer happen)
  useEffect(() => {
    if (!loaded) return;
    if (focusField !== 'qty' && qsSolved != null && qty !== qsSolved) setQty(qsSolved);
    if (focusField !== 'rate' && rsSolved != null && rate !== rsSolved) setRateStr(rsSolved);
  }, [loaded, focusField, st.Q, st.R, qty, rate]);

  // ── tidy suggestions ─────────────────────────────────────────────────────
  const tidy = useMemo(() => {
    const out: { main: string; sub: string; apply: () => void }[] = [];
    if (st.X == null || st.Q == null || st.R == null) return out;
    const X = st.X;
    if (unit === 'pcs' || unit === 'dozen') {
      const step = unit === 'pcs' ? 1 : 0.5;
      const label = unit === 'pcs' ? 'pcs' : 'dz';
      for (const dq of [-2 * step, -step, step, 2 * step]) {
        const q = roundTo(st.Q + dq, 2);
        if (q <= 0) continue;
        const r = X / q;
        out.push({
          main: `${fmtQ(q, unit)} ${label}`,
          sub: `rate ${trim(r, 2)}`,
          apply: () => {
            setLastField('qty');
            setQty(fmtQ(q, unit));
            setRateStr(''); // the rate re-solves against the kept base
          },
        });
      }
    } else if (kgAnchor === 'qty') {
      // rate was auto-adjusted → offer tidier rates (qty follows)
      for (const r of grid(st.R, [0.25, 0.5, 1])) {
        const q = X / r;
        out.push({
          main: `rate ${trim(r, 2)}`,
          sub: `${trim(q, 3)} kg`,
          apply: () => {
            setLastField('rate');
            setKgAnchor('rate');
            setRateStr(trim(r, 4));
            setQty(''); // the qty re-solves against the kept base
          },
        });
      }
    } else {
      // qty was auto-adjusted → offer tidier qtys (rate follows)
      for (const q of grid(st.Q, [0.25, 0.5, 1])) {
        const r = X / q;
        out.push({
          main: `${trim(q, 2)} kg`,
          sub: `rate ${trim(r, 2)}`,
          apply: () => {
            setLastField('qty');
            setKgAnchor('qty');
            setQty(trim(q, 4));
            setRateStr(''); // the rate re-solves against the kept base
          },
        });
      }
    }
    return out.slice(0, 4);
  }, [st, unit, kgAnchor]);

  // round pairs — both qty & rate tidy, total nudged a touch
  const rounds = useMemo(() => {
    if (st.X == null || st.Q == null || st.R == null) return [] as { q: number; r: number; prod: number; d: number }[];
    const X = st.X;
    const qGrid: number[] = [];
    if (unit === 'pcs') {
      for (let q = Math.max(1, Math.round(st.Q) - 3); q <= Math.round(st.Q) + 3; q++) qGrid.push(q);
    } else if (unit === 'dozen') {
      for (let q = Math.max(0.5, st.Q - 1.5); q <= st.Q + 1.5; q += 0.5) qGrid.push(roundTo(q, 1));
    } else {
      for (let q = Math.max(0.25, st.Q - 1.25); q <= st.Q + 1.25; q += 0.25) qGrid.push(roundTo(q, 2));
    }
    const cand: { q: number; r: number; prod: number; d: number }[] = [];
    for (const q of qGrid) {
      if (q <= 0) continue;
      const ex = X / q;
      for (const r of [roundTo(ex, 2), snap(ex, 0.25), Math.round(ex)]) {
        if (r <= 0) continue;
        const prod = q * r;
        const d = Math.abs(prod - X);
        if (d > Math.max(0.02 * X, 0.5)) continue;
        if (Math.abs(q - st.Q!) < 1e-9 && Math.abs(r - st.R!) < 0.001) continue;
        cand.push({ q, r, prod, d });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    const picks: typeof cand = [];
    const seenQ = new Set<string>();
    for (const c of cand) {
      const k = roundTo(c.q, 4).toFixed(4);
      if (seenQ.has(k)) continue;
      seenQ.add(k);
      picks.push(c);
      if (picks.length >= 2) break;
    }
    return picks;
  }, [st, unit]);

  const applyRound = (q: number, r: number) => {
    if (anchorAmt === 'gross') {
      toast({ title: 'Total nudged', description: 'The incl.-VAT total adjusted to fit the round pair' });
    }
    setAnchorAmt('net');
    setKgAnchor('rate');
    setLastField(null);
    setQty(fmtQ(q, unit));
    setRateStr(trim(r, 4));
    setNet(trim(q * r));
  };

  // ── verify chip ───────────────────────────────────────────────────────────
  const verify = useMemo(() => {
    if (st.X == null || st.Q == null || st.R == null) return null;
    const prod = roundTo(st.Q * st.R, 6);
    const diff = Math.abs(prod - st.X);
    return { ok: diff <= 0.009, prod, diff };
  }, [st]);

  // ── handlers ──────────────────────────────────────────────────────────────
  const setModeUI = (m: Mode) => {
    if (m === mode) return;
    // seed the newly-anchored field with its current derived value so the
    // numbers carry over seamlessly (nothing jumps when switching modes)
    if (m === 'rev') {
      if (st.G != null) setGross(trim(st.G));
    } else if (st.X != null) {
      setNet(trim(st.X));
    }
    setMode(m);
    setAnchorAmt(m === 'rev' ? 'gross' : 'net');
  };

  const setUnitUI = (u: Unit) => {
    if (u === unit) return;
    setUnit(u);
    // the kg sticky absorber SURVIVES unit switches — the touch history is
    // what decides who absorbs, and switching units is not a touch
    setLastField(null);
  };

  const onNetChange = (v: string) => {
    setNet(num(v));
    setAnchorAmt('net');
    setLastField('net');
  };
  const onGrossChange = (v: string) => {
    setGross(num(v));
    setAnchorAmt('gross');
    setLastField('gross');
  };
  // the touched field wins verbatim — the amounts follow from qty × rate
  // (once both are set); nothing ever reverts what the user types
  const onQtyChange = (v: string) => {
    setQty(num(v));
    setKgAnchor('qty');
    setLastField('qty');
  };
  const onRateFieldChange = (v: string) => {
    setRateStr(num(v));
    setKgAnchor('rate');
    setLastField('rate');
  };

  // blur → drop the raw-typing guard; commit the dozen half-step snap
  const normalizeUnits = () => {
    setFocusField(null);
    if (unit === 'dozen' && st.Q != null) {
      const s = fmtQ(st.Q, unit);
      if (qty !== s) setQty(s);
    }
  };
  const clampVat = () => {
    const v = parseFloat(vat);
    if (!Number.isFinite(v) || v < 0) setVat('13');
    else if (v > 99) setVat('99');
  };

  // steppers with press-and-hold repeat
  const stepSize = unit === 'pcs' ? 1 : unit === 'dozen' ? 0.5 : 0.25;
  const ptrGuard = useRef(0);
  const bump = (dir: 1 | -1) => {
    const cur = parseFloat(qty) || 0;
    let q = roundTo(cur + dir * stepSize, 4);
    if (unit === 'pcs') q = Math.max(1, Math.round(q));
    else if (unit === 'dozen') q = Math.max(0.5, snap(q, 0.5));
    else q = Math.max(0, q);
    onQtyChange(trim(q, 4));
  };
  const stopHold = () => {
    if (holdRef.current.t) clearTimeout(holdRef.current.t);
    if (holdRef.current.i) clearInterval(holdRef.current.i);
    holdRef.current = { t: null, i: null };
  };
  const startHold = (dir: 1 | -1) => () => {
    ptrGuard.current = Date.now();
    bump(dir);
    holdRef.current.t = setTimeout(() => {
      holdRef.current.i = setInterval(() => bump(dir), 110);
    }, 420);
  };
  // keyboard / assistive-tech fallback — a click right after pointerdown is skipped
  const stepClick = (dir: 1 | -1) => () => {
    if (Date.now() - ptrGuard.current < 600) return;
    bump(dir);
  };
  useEffect(() => stopHold, []);

  // ── actions ───────────────────────────────────────────────────────────────
  const saveLine = () => {
    if (st.X == null || st.Q == null || st.R == null || st.G == null || st.Vat == null) {
      toast({ title: 'Nothing to save yet', description: 'Enter an amount and a rate first' });
      return;
    }
    const rec: LineRec = {
      id: uid(),
      ts: Date.now(),
      item: item.trim(),
      mode,
      unit,
      qty: st.Q,
      rate: st.R,
      net: st.X,
      vat: st.Vat,
      gross: st.G,
    };
    setLines([rec, ...lines].slice(0, 300));
    toast({
      title: 'Saved to this device',
      description: `${fmtQ(st.Q, unit)} ${UNITS[unit]} × ${trim(st.R, 2)} — base ${money(st.X)}`,
    });
  };

  const copyLine = async () => {
    if (st.X == null || st.Q == null || st.R == null) {
      toast({ title: 'Nothing to copy yet', description: 'Enter an amount and a rate first' });
      return;
    }
    const line = `${item.trim() || 'Item'} | ${fmtQ(st.Q, unit)} ${UNITS[unit]} | ${trim(st.R, 4)} | ${money(st.X)}`;
    toast({ title: (await copyText(line)) ? 'Billing line copied' : 'Copy failed' });
  };

  const copyDetails = async () => {
    if (st.X == null || st.Q == null || st.R == null || st.Vat == null || st.G == null) {
      toast({ title: 'Nothing to copy yet', description: 'Enter an amount and a rate first' });
      return;
    }
    const qs2 = fmtQ(st.Q, unit);
    const rs2 = trim(st.R, 4);
    const txt =
      `Item: ${item.trim() || '—'}\n` +
      `Mode: ${mode === 'rev' ? 'Reverse (gross → net)' : 'Non-reverse (net → gross)'}\n` +
      `Unit: ${UNITS[unit]}\n` +
      `VAT rate: ${trim(st.v, 2)}%\n` +
      `Gross (incl. VAT): ${money(st.G)}\n` +
      `VAT amount: ${money(st.Vat)}\n` +
      `Base subtotal (before tax): ${money(st.X)}\n` +
      `Quantity: ${qs2} ${UNITS[unit]}\n` +
      `Unit rate (before tax): ${rs2}\n` +
      `Check: ${qs2} × ${rs2} = ${money(st.Q * st.R)} (base ${money(st.X)})`;
    toast({ title: (await copyText(txt)) ? 'Full details copied' : 'Copy failed' });
  };

  const speak = () => {
    if (st.X == null || st.Q == null || st.R == null || st.G == null || st.Vat == null) {
      narrator.forceSpeak('Please enter an amount and a rate first.');
      return;
    }
    narrator.forceSpeak(
      `${mode === 'rev' ? 'Reverse' : 'Non reverse'} mode. ` +
        `Gross ${numWords(st.G)}. ` +
        `V A T ${numWords(st.Vat)}. ` +
        `Base ${numWords(st.X)}. ` +
        `${numWords(st.Q)} ${UNIT_WORD[unit]}, at ${numWords(st.R)} per ${UNIT_WORD[unit]}, before tax.`
    );
    toast({ title: 'Reading the breakdown aloud' });
  };

  const reset = () => {
    setNet('');
    setGross('');
    setQty('');
    setRateStr('');
    setItem('');
    setKgAnchor('rate');
    setLastField(null);
    setFocusField(null);
    setAnchorAmt(mode === 'rev' ? 'gross' : 'net');
    toast({ title: 'Cleared', description: `VAT stays at ${trim(st.v, 2)}%` });
  };

  const restoreLine = (l: LineRec) => {
    setItem(l.item);
    setMode(l.mode);
    setAnchorAmt(l.mode === 'rev' ? 'gross' : 'net');
    setUnit(l.unit);
    setKgAnchor('rate');
    setLastField(null);
    setQty(fmtQ(l.qty, l.unit));
    setRateStr(trim(l.rate, 4));
    setNet(trim(l.net));
    setGross(trim(l.gross));
    toast({ title: 'Line loaded', description: 'Fields restored from this device’s ledger' });
  };

  const vatNum = st.v;
  const netPrime = anchorAmt === 'net';
  const qs = qsSolved;
  const rs = rsSolved;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-[880px]">
      {/* mode */}
      <section className="nb-card p-4 sm:p-5" aria-label="VAT mode">
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <button type="button" className={`nb-mode ${mode === 'nonrev' ? 'on' : ''}`} onClick={() => setModeUI('nonrev')} aria-pressed={mode === 'nonrev'}>
            <b>NON-REVERSE</b>
            <small>net → gross · add VAT</small>
            <i className="defbadge" aria-hidden="true">DEFAULT</i>
          </button>
          <button type="button" className={`nb-mode ${mode === 'rev' ? 'on' : ''}`} onClick={() => setModeUI('rev')} aria-pressed={mode === 'rev'}>
            <b>REVERSE</b>
            <small>gross → net · strip VAT</small>
          </button>
        </div>
        <p className="mt-3 font-mono text-[11.5px] leading-relaxed text-[#6b6455]">{MODE_HINT[mode]}</p>
      </section>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* left column */}
        <div className="space-y-4">
          {/* amounts */}
          <section className="nb-card p-4 sm:p-5" aria-label="Amounts">
            <h3 className="nb-h">AMOUNTS — LINKED</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="netIn" className="mb-1.5 flex items-center gap-2 text-[11px] font-bold tracking-wider text-[#6b6455]">
                  BASE — BEFORE VAT
                  <span className={`nb-badge ${netPrime ? 'type' : 'auto'}`}>{netPrime ? 'YOU TYPE' : 'AUTO'}</span>
                </label>
                <input
                  id="netIn"
                  className={`nb-in ${netPrime ? 'prime' : ''}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={netDisplay}
                  onChange={(e) => onNetChange(e.target.value)}
                  placeholder="e.g. 1000"
                />
              </div>
              <div>
                <label htmlFor="grossIn" className="mb-1.5 flex items-center gap-2 text-[11px] font-bold tracking-wider text-[#6b6455]">
                  TOTAL — INCL. VAT
                  <span className={`nb-badge ${netPrime ? 'auto' : 'type'}`}>{netPrime ? 'AUTO' : 'YOU TYPE'}</span>
                </label>
                <input
                  id="grossIn"
                  className={`nb-in ${netPrime ? '' : 'prime'}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={grossDisplay}
                  onChange={(e) => onGrossChange(e.target.value)}
                  placeholder="e.g. 1130"
                />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor="vatIn" className="mb-1.5 flex items-center gap-2 text-[11px] font-bold tracking-wider text-[#6b6455]">
                VAT RATE <span className="nb-badge auto">%</span>
              </label>
              <div className="grid gap-3 sm:grid-cols-[130px_minmax(0,1fr)]">
                <input
                  id="vatIn"
                  className="nb-in"
                  inputMode="decimal"
                  autoComplete="off"
                  value={vat}
                  onChange={(e) => setVat(num(e.target.value))}
                  onBlur={clampVat}
                />
                <div className="flex flex-wrap content-start gap-2">
                  {VAT_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`nb-rate-chip ${Math.abs(vatNum - p) < 0.001 ? 'on' : ''}`}
                      onClick={() => setVat(String(p))}
                      aria-pressed={Math.abs(vatNum - p) < 0.001}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* units */}
          <section className="nb-card p-4 sm:p-5" aria-label="Units and rate">
            <h3 className="nb-h">UNITS &amp; RATE — SOLVED ON THE BASE</h3>
            <label htmlFor="itemIn" className="mb-1.5 block text-[11px] font-bold tracking-wider text-[#6b6455]">
              ITEM NAME <span className="nb-badge auto">OPTIONAL</span>
            </label>
            <input
              id="itemIn"
              className="nb-in"
              type="text"
              maxLength={60}
              autoComplete="off"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="e.g. Cable ties 4-inch"
            />
            <div className="mt-3 grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Unit type">
              {(Object.keys(UNITS) as Unit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  className={`nb-mode ${unit === u ? 'on' : ''}`}
                  onClick={() => setUnitUI(u)}
                  aria-pressed={unit === u}
                >
                  <b>{UNITS[u].toUpperCase()}</b>
                  <small>{u === 'pcs' ? 'type freely · rate absorbs' : u === 'kg' ? 'sticky absorber' : 'half-dozen steps'}</small>
                </button>
              ))}
            </div>
            <div className="mt-3 grid items-end gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="qtyIn" className="mb-1.5 block text-[11px] font-bold tracking-wider text-[#6b6455]">
                  QUANTITY ({UNITS[unit]})
                </label>
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    className="stp"
                    aria-label="Decrease quantity"
                    onPointerDown={startHold(-1)}
                    onPointerUp={stopHold}
                    onPointerLeave={stopHold}
                    onPointerCancel={stopHold}
                    onClick={stepClick(-1)}
                  >
                    <Minus size={18} strokeWidth={3} />
                  </button>
                  <input
                    id="qtyIn"
                    className="nb-in text-center"
                    inputMode="decimal"
                    autoComplete="off"
                    value={qtyDisplay}
                    onChange={(e) => onQtyChange(e.target.value)}
                    onFocus={() => {
                      setFocusField('qty');
                      // sync state to the solved value first, so raw editing
                      // always starts from what is on screen (never stale)
                      const cur = qsSolved ?? qty;
                      if (cur !== qty) setQty(cur);
                    }}
                    onBlur={normalizeUnits}
                    placeholder="—"
                  />
                  <button
                    type="button"
                    className="stp"
                    aria-label="Increase quantity"
                    onPointerDown={startHold(1)}
                    onPointerUp={stopHold}
                    onPointerLeave={stopHold}
                    onPointerCancel={stopHold}
                    onClick={stepClick(1)}
                  >
                    <Plus size={18} strokeWidth={3} />
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="rateIn" className="mb-1.5 block text-[11px] font-bold tracking-wider text-[#6b6455]">
                  UNIT RATE — BEFORE VAT
                </label>
                <input
                  id="rateIn"
                  className="nb-in"
                  inputMode="decimal"
                  autoComplete="off"
                  value={rateDisplay}
                  onChange={(e) => onRateFieldChange(e.target.value)}
                  onFocus={() => {
                    setFocusField('rate');
                    // sync state to the solved value first, so raw editing
                    // always starts from what is on screen (never stale)
                    const cur = rsSolved ?? rate;
                    if (cur !== rate) setRateStr(cur);
                  }}
                  onBlur={normalizeUnits}
                  placeholder="e.g. 40"
                />
              </div>
            </div>
            <p className="mt-3 font-mono text-[11.5px] leading-relaxed text-[#6b6455]">{UNIT_HINT[unit]}</p>
          </section>

          {/* tidy suggestions */}
          {(tidy.length > 0 || rounds.length > 0) && (
            <section className="nb-tidy" aria-label="Tidier options">
              <b className="tidy-t">★ MAKE IT TIDY — KEEPS THE BASE</b>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {tidy.map((t, i) => (
                  <button key={i} type="button" className="tchip" onClick={t.apply} title="Apply this tidier option — the other field adjusts">
                    <b>{t.main}</b>
                    <small>{t.sub}</small>
                  </button>
                ))}
              </div>
              {rounds.length > 0 && (
                <>
                  <b className="tidy-t mt-3.5 block">≈ ROUND PAIR — NUDGES THE TOTAL A TOUCH</b>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {rounds.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        className="tchip rnd"
                        onClick={() => applyRound(c.q, c.r)}
                        title="Both tidy — the amounts adjust to fit"
                      >
                        <b>
                          {fmtQ(c.q, unit)} {UNITS[unit]} × {trim(c.r, 2)}
                        </b>
                        <small>
                          = {money(c.prod)}
                          {c.d > 0.005 ? ` · ±${trim(c.d, 2)}` : ''}
                        </small>
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="mt-3 font-mono text-[11px] text-[#8a8468]">
                Auto-adjusted values stay exactly as solved unless you pick a tidier one — like 4.5 or 2.25 instead of
                4.5033.
              </p>
            </section>
          )}
        </div>

        {/* right column */}
        <div className="space-y-4">
          {/* receipt */}
          <section className="bill" aria-label="Receipt summary" aria-live="polite">
            <div className="bill-head">
              <ReceiptText size={14} />
              <span>SALES CALC</span>
              <span className="mode-tag">{mode === 'rev' ? 'REVERSE' : 'NON-REV'} · {trim(vatNum, 2)}%</span>
            </div>
            <div className="bill-body">
              {item.trim() && (
                <div className="brow">
                  <span>ITEM</span>
                  <b className="max-w-[180px] truncate">{item.trim()}</b>
                </div>
              )}
              <div className="brow big">
                <span>BASE — BEFORE VAT (X)</span>
                <strong>{money(st.X)}</strong>
              </div>
              <div className="brow">
                <span>VAT AMOUNT</span>
                <b>{money(st.Vat)}</b>
              </div>
              <div className="brow">
                <span>GROSS — INCL. VAT</span>
                <b>{money(st.G)}</b>
              </div>
              <div className="bdiv" />
              <div className="brow big">
                <span>QUANTITY</span>
                <strong>{qs != null ? `${qs} ${UNITS[unit]}` : '—'}</strong>
              </div>
              <div className="brow">
                <span>UNIT RATE (BEFORE TAX)</span>
                <b>{rs != null ? rs : '—'}</b>
              </div>
              {verify && qs != null && rs != null && (
                <div className={`verify ${verify.ok ? 'ok' : 'warn'}`}>
                  <span>
                    {verify.ok ? '✓' : '≈'} {qs} {UNITS[unit]} × {rs} = {money(verify.prod)}
                    {verify.ok ? '' : ` · off by ${money(verify.diff)}`}
                  </span>
                </div>
              )}
            </div>
            <div className="bill-barcode" aria-hidden="true" />
            <div className="bill-thanks" aria-hidden="true">· · · COME AGAIN · · ·</div>
          </section>

          {/* actions */}
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" className="nb-btn b-yellow" onClick={saveLine}>
              <Save size={13} /> SAVE LINE
            </button>
            <button type="button" className="nb-btn b-white" onClick={copyLine}>
              <Copy size={13} /> COPY LINE
            </button>
            <button type="button" className="nb-btn b-white" onClick={copyDetails}>
              <Copy size={13} /> DETAILS
            </button>
            <button type="button" className="nb-btn b-teal" onClick={speak}>
              <Speech size={13} /> HEAR IT
            </button>
            <button type="button" className="nb-btn b-pink col-span-2" onClick={reset}>
              <RotateCcw size={13} /> RESET
            </button>
          </div>

          {/* per-device ledger */}
          <section className="nb-card overflow-hidden" aria-label="Saved billing lines">
            <div className="ledger-head">
              <ReceiptText size={13} />
              <span>SALES LEDGER</span>
              <span className="cnt" title="History is stored per device — no interlap between devices">
                {lines.length} · DEV #{deviceTag || '····'}
              </span>
            </div>
            <div className="ledger-body">
              {lines.length === 0 ? (
                <div className="ledger-empty">
                  ── NO LINES SAVED YET ──
                  <br />
                  press <b>SAVE LINE</b> to keep a bill here
                  <br />
                  stays on this device — every session
                </div>
              ) : (
                lines.map((l) => (
                  <div key={l.id} className="ledger-row" onClick={() => restoreLine(l)} title="Tap to load this line back into the form">
                    <span className={`l-tag ${l.mode === 'rev' ? 'rev' : ''}`}>{l.mode === 'rev' ? 'REV' : 'N-REV'}</span>
                    <span className="l-main">
                      <span className="l-line block">
                        {l.item ? `${l.item} · ` : ''}
                        {fmtQ(l.qty, l.unit)} {UNITS[l.unit]} × {trim(l.rate, 2)}
                      </span>
                      <span className="l-sub block">
                        base {money(l.net)} · +VAT {money(l.vat)} → {money(l.gross)} · {fmtTime(l.ts)}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="l-del"
                      aria-label="Delete this record"
                      title="Delete this record"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLines(lines.filter((x) => x.id !== l.id));
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="ledger-foot">· · · THIS DEVICE ONLY · · ·</div>
          </section>
        </div>
      </div>
    </div>
  );
}
