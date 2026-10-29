'use client';

import { Fragment, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, Speech, Volume2, VolumeX } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  BinOp,
  EvalCtx,
  HistItem,
  Tok,
  evaluate,
  fmt,
  fmtRate,
  isValueEnd,
} from '@/lib/calc/engine';
import { NumText, TokList, TokView } from './bits';
import { HistoryTape } from './HistoryTape';
import { BreakdownDialog, HelpDialog, RateDialog } from './dialogs';
import { sfx, type SfxKind } from '@/lib/calc/audio';
import { DIGIT_WORDS, narrator } from '@/lib/calc/narrator';
import { getRate, onRateChange, setRate } from '@/lib/calc/rate';
import './calculator.css';

// ─── persisted state (per device — every device keeps its own history) ─────

const DEV_KEY = 'urb991.device';
const LEGACY_KEY = 'fx991biz.state.v1'; // pre-device build — imported once

const stateKeyOf = (dev: string) => `urb991.state.v2.${dev}`;

interface StoredState {
  vatRate: number;
  mem: number;
  gt: number;
  ans: number;
  sound: boolean;
  voice: boolean;
  history: HistItem[];
}

// ─── key feedback: one clearly distinct tone per key + a spoken word per key ─

const SOUND_BY_ID: Record<string, SfxKind> = {
  dot: 'dot',
  dbl0: 'dbl0',
  plus: 'op-plus',
  minus: 'op-minus',
  mul: 'op-mul',
  div: 'op-div',
  pct: 'pct',
  'vat+': 'vat-plus',
  'vat-': 'vat-minus',
  'vat-amt': 'vat-amt',
  split: 'vat-split',
  mu: 'mu',
  gt: 'gt',
  lp: 'lp',
  rp: 'rp',
  ans: 'ans',
  'm-plus': 'mem',
  'm-minus': 'mem',
  mr: 'mem',
  mc: 'mem',
  del: 'del',
  ac: 'clear',
  on: 'clear',
  shift: 'ui',
  hist: 'ui',
  rate: 'ui',
  help: 'ui',
  left: 'ui',
  right: 'ui',
  up: 'ui',
  down: 'ui',
};

const NARR_BY_ID: Record<string, string> = {
  dot: 'point',
  dbl0: 'zero zero',
  plus: 'plus',
  minus: 'minus',
  mul: 'times',
  div: 'divided by',
  eq: 'equals to',
  pct: 'percent',
  'vat+': 'add VAT',
  'vat-': 'remove VAT',
  'vat-amt': 'VAT amount',
  split: 'VAT split',
  mu: 'mark up',
  gt: 'grand total',
  lp: 'open bracket',
  rp: 'close bracket',
  ans: 'answer',
  'm-plus': 'memory plus',
  'm-minus': 'memory minus',
  mr: 'memory recall',
  mc: 'memory clear',
  del: 'delete',
  ac: 'clear all',
  on: 'on',
};

const NARR_SHIFT_BY_ID: Record<string, string> = {
  gt: 'grand total cleared',
};

interface JustEq {
  expr: Tok[];
  value: number;
  label?: string;
}

// ─── component ───────────────────────────────────────────────────────────────

export default function Calc() {
  const { toast } = useToast();

  // persisted
  const [vatRate, setVatRate] = useState(13);
  const [soundOn, setSoundOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [deviceTag, setDeviceTag] = useState('');
  const [mem, setMem] = useState(0);
  const [gt, setGt] = useState(0);
  const [ans, setAns] = useState(0);
  const [history, setHistory] = useState<HistItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  // transient
  const [toks, setToks] = useState<Tok[]>([]);
  const [cursor, setCursor] = useState(0);
  const [shift, setShift] = useState(false);
  const [justEq, setJustEq] = useState<JustEq | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [histNav, setHistNav] = useState<number | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);

  // dialogs / panels
  const [rateOpen, setRateOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const [tapeOpen, setTapeOpen] = useState(false);

  const tapeRef = useRef<HTMLDivElement>(null);
  const stateKeyRef = useRef<string | null>(null);
  const draftRef = useRef<{ toks: Tok[]; cursor: number } | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exprRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);

  // ── persistence ────────────────────────────────────────────────────────────

  useEffect(() => {
    try {
      // per-device namespace — every device keeps its own history & settings
      let dev: string | null = null;
      try {
        dev = localStorage.getItem(DEV_KEY);
      } catch {
        dev = null;
      }
      if (!dev) {
        dev =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        try {
          localStorage.setItem(DEV_KEY, dev);
        } catch {
          /* storage unavailable — session-only state */
        }
      }
      stateKeyRef.current = stateKeyOf(dev);
      setDeviceTag(dev.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || '0000');

      let raw: string | null = null;
      try {
        raw = localStorage.getItem(stateKeyRef.current);
      } catch {
        raw = null;
      }
      // one-time import from the pre-device build
      if (!raw) {
        try {
          raw = localStorage.getItem(LEGACY_KEY);
        } catch {
          raw = null;
        }
      }
      if (raw) {
        try {
          const s = JSON.parse(raw) as Partial<StoredState>;
          if (typeof s.vatRate === 'number' && s.vatRate >= 0 && s.vatRate <= 100) setVatRate(s.vatRate);
          if (typeof s.mem === 'number') setMem(s.mem);
          if (typeof s.gt === 'number') setGt(s.gt);
          if (typeof s.ans === 'number') setAns(s.ans);
          if (typeof s.sound === 'boolean') setSoundOn(s.sound);
          if (typeof s.voice === 'boolean') setVoiceOn(s.voice);
          if (Array.isArray(s.history)) setHistory(s.history.filter((h) => h && Array.isArray(h.expr)));
        } catch {
          /* corrupt state — start fresh */
        }
      }
    } catch {
      /* start fresh */
    }
    setLoaded(true);
  }, []);

  // shared VAT rate wins on mount — Sales view and calculator use ONE rate
  useEffect(() => {
    if (!loaded) return;
    const shared = getRate();
    if (shared != null) setVatRate(shared);
  }, [loaded]);

  // keep the rate in sync while the Sales view is open in another moment
  useEffect(() => {
    if (!loaded) return;
    return onRateChange((r) => {
      if (Number.isFinite(r)) setVatRate(r);
    });
  }, [loaded]);

  // apply audio prefs (and keep them in sync with the SOUND / VOICE keys)
  useEffect(() => {
    if (!loaded) return;
    sfx.setEnabled(soundOn);
    narrator.setEnabled(voiceOn);
  }, [loaded, soundOn, voiceOn]);

  useEffect(() => {
    if (!loaded || !stateKeyRef.current) return;
    try {
      const s: StoredState = { vatRate, mem, gt, ans, sound: soundOn, voice: voiceOn, history };
      localStorage.setItem(stateKeyRef.current, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }, [loaded, vatRate, mem, gt, ans, soundOn, voiceOn, history]);

  // ── derived ────────────────────────────────────────────────────────────────

  const ctx: EvalCtx = useMemo(
    () => ({ vat: vatRate, angle: 'DEG', ans, mem }),
    [vatRate, ans, mem]
  );
  const preview = useMemo(() => (toks.length ? evaluate(toks, ctx) : null), [toks, ctx]);
  const currentValue = (): number | null =>
    justEq ? justEq.value : preview?.ok ? preview.value : null;
  const breakVal = justEq ? justEq.value : preview?.ok ? preview.value : ans;

  // ── small helpers ──────────────────────────────────────────────────────────

  const flash = useCallback((msg: string) => {
    setErr(msg);
    if (flashRef.current) clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setErr(null), 1500);
  }, []);

  const markPressed = useCallback((id: string) => {
    setPressed(id);
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setPressed(null), 170);
  }, []);

  const clearPostEq = () => {
    setJustEq(null);
    setErr(null);
    setHistNav(null);
  };
  // base state for handlers — after '=' a fresh value starts a new expression
  const base = (): { t: Tok[]; c: number } => {
    if (justEq) {
      clearPostEq();
      return { t: [], c: 0 };
    }
    return { t: toks, c: cursor };
  };
  // base state for operators / postfix — after '=' they continue from Ans
  const baseAns = (): { t: Tok[]; c: number } => {
    if (justEq) {
      clearPostEq();
      return { t: [{ t: 'const', v: 'Ans' }], c: 1 };
    }
    return { t: toks, c: cursor };
  };
  const commit = (t: Tok[], c: number) => {
    setToks(t);
    setCursor(c);
  };

  // ── key handlers ───────────────────────────────────────────────────────────

  const hDigit = (d: string) => {
    const { t, c } = base();
    const prev = t[c - 1];
    const next = t[c];
    if (prev?.t === 'num') {
      const digits = prev.v.replace(/[^0-9]/g, '').length;
      if (digits >= 15) {
        flash('Too long');
        return;
      }
      const v = prev.v === '0' && !prev.v.includes('E') ? d : prev.v + d;
      commit([...t.slice(0, c - 1), { t: 'num', v }, ...t.slice(c)], c);
      return;
    }
    if (next?.t === 'num') {
      commit([...t.slice(0, c), { t: 'num', v: d + next.v }, ...t.slice(c + 1)], c);
      return;
    }
    commit([...t.slice(0, c), { t: 'num', v: d }, ...t.slice(c)], c + 1);
  };

  const hDot = () => {
    const { t, c } = base();
    const prev = t[c - 1];
    const next = t[c];
    if (prev?.t === 'num' && !prev.v.includes('.') && !prev.v.includes('E')) {
      commit([...t.slice(0, c - 1), { t: 'num', v: prev.v + '.' }, ...t.slice(c)], c);
      return;
    }
    if (next?.t === 'num' && !next.v.includes('.') && !next.v.includes('E')) {
      commit([...t.slice(0, c), { t: 'num', v: '.' + next.v }, ...t.slice(c + 1)], c);
      return;
    }
    commit([...t.slice(0, c), { t: 'num', v: '0.' }, ...t.slice(c)], c + 1);
  };

  const hOp = (v: BinOp) => {
    const { t, c } = baseAns();
    const prev = t[c - 1];
    if (!prev || prev.t === 'lp') {
      if (v === '−') {
        commit([...t.slice(0, c), { t: 'bin', v }, ...t.slice(c)], c + 1);
        return;
      }
      flash('Syntax');
      return;
    }
    if (prev.t === 'bin') {
      // pressing another operator replaces the previous one
      commit([...t.slice(0, c - 1), { t: 'bin', v }, ...t.slice(c)], c);
      return;
    }
    commit([...t.slice(0, c), { t: 'bin', v }, ...t.slice(c)], c + 1);
  };

  const hMinus = () => hOp('−');

  const hDbl0 = () => {
    const { t, c } = base();
    const prev = t[c - 1];
    if (prev?.t === 'num' && !prev.v.includes('E')) {
      const digits = prev.v.replace(/[^0-9]/g, '').length;
      if (digits >= 14) {
        flash('Too long');
        return;
      }
      const v = prev.v === '0' ? '0' : prev.v + '00';
      commit([...t.slice(0, c - 1), { t: 'num', v }, ...t.slice(c)], c);
      return;
    }
    commit([...t.slice(0, c), { t: 'num', v: '0' }, ...t.slice(c)], c + 1);
  };

  const hPost = (v: 'x²' | 'x³' | 'x⁻¹' | '!' | '%') => {
    const { t, c } = baseAns();
    if (!isValueEnd(t[c - 1])) {
      flash('Enter a value first');
      return;
    }
    commit([...t.slice(0, c), { t: 'post', v }, ...t.slice(c)], c + 1);
  };

  const hVat = (v: 'add' | 'sub' | 'amt') => {
    const { t, c } = baseAns();
    if (!isValueEnd(t[c - 1])) {
      flash('Enter an amount first');
      return;
    }
    commit([...t.slice(0, c), { t: 'vat', v }, ...t.slice(c)], c + 1);
  };

  const hLp = () => {
    const { t, c } = base();
    commit([...t.slice(0, c), { t: 'lp' }, ...t.slice(c)], c + 1);
  };

  const hRp = () => {
    const { t, c } = base();
    // fn tokens carry their own implicit opening paren ("sin(") — count them too
    const depth =
      t.filter((x) => x.t === 'lp' || x.t === 'fn').length - t.filter((x) => x.t === 'rp').length;
    if (depth <= 0 || !isValueEnd(t[c - 1])) {
      flash('Syntax');
      return;
    }
    commit([...t.slice(0, c), { t: 'rp' }, ...t.slice(c)], c + 1);
  };

  const hConst = (v: 'π' | 'e' | 'Ans' | 'M') => {
    const { t, c } = base();
    commit([...t.slice(0, c), { t: 'const', v }, ...t.slice(c)], c + 1);
  };

  const hAC = () => {
    setToks([]);
    setCursor(0);
    setErr(null);
    setJustEq(null);
    setHistNav(null);
    setShift(false);
  };

  const hDel = () => {
    if (err) {
      setErr(null);
      return;
    }
    if (justEq) {
      setJustEq(null);
      return;
    }
    if (cursor === 0) return;
    const prev = toks[cursor - 1];
    if (prev.t === 'num' && prev.v.length > 1) {
      commit([...toks.slice(0, cursor - 1), { t: 'num', v: prev.v.slice(0, -1) }, ...toks.slice(cursor)], cursor);
      return;
    }
    const before = toks[cursor - 2];
    const after = toks[cursor];
    if (prev.t === 'bin' && before?.t === 'num' && after?.t === 'num') {
      // deleting an operator between two numbers merges them: 12+34 → 1234
      const merged: Tok = { t: 'num', v: before.v + after.v };
      commit([...toks.slice(0, cursor - 2), merged, ...toks.slice(cursor + 1)], cursor - 1);
      return;
    }
    commit([...toks.slice(0, cursor - 1), ...toks.slice(cursor)], cursor - 1);
  };

  const hEq = () => {
    if (justEq || toks.length === 0) return;
    const r = evaluate(toks, ctx);
    if (r.ok) {
      sfx.play('eq');
      const entry: HistItem = {
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ts: Date.now(),
        expr: toks,
        result: r.value,
      };
      setHistory([entry, ...history].slice(0, 500));
      setAns(r.value);
      setGt(gt + r.value);
      setJustEq({ expr: toks, value: r.value });
      setToks([]);
      setCursor(0);
      setHistNav(null);
      setShift(false);
    } else {
      sfx.play('err');
      setErr(r.error === 'math' ? 'Math ERROR' : 'Syntax ERROR');
    }
  };

  const hGT = () => {
    setJustEq({ expr: [], value: gt, label: 'GT' });
    setToks([]);
    setCursor(0);
    setHistNav(null);
  };
  const hMem = (kind: 'add' | 'sub' | 'recall' | 'clear') => {
    if (kind === 'clear') {
      setMem(0);
      toast({ title: 'Memory cleared' });
      return;
    }
    if (kind === 'recall') {
      hConst('M');
      return;
    }
    const v = currentValue();
    if (v == null) {
      flash('Nothing to store');
      return;
    }
    setMem(kind === 'add' ? mem + v : mem - v);
  };

  const hMove = (d: -1 | 1) => {
    setCursor((c) => Math.max(0, Math.min(toks.length, c + d)));
  };

  const hRecall = (d: 1 | -1) => {
    if (history.length === 0) {
      flash('No history');
      return;
    }
    if (d === 1) {
      // ▲ — step to older entries (first press recalls the newest calculation)
      if (histNav == null) draftRef.current = { toks, cursor };
      const next = Math.min(history.length - 1, (histNav == null ? -1 : histNav) + 1);
      setHistNav(next);
      const h = history[next];
      setToks(h.expr);
      setCursor(h.expr.length);
      setJustEq(null);
      setErr(null);
    } else {
      // ▼ — step back toward newer entries, then restore the draft
      if (histNav == null) return;
      const next = histNav - 1;
      if (next < 0) {
        setHistNav(null);
        const dft = draftRef.current;
        if (dft) {
          setToks(dft.toks);
          setCursor(dft.cursor);
        } else {
          setToks([]);
          setCursor(0);
        }
      } else {
        setHistNav(next);
        const h = history[next];
        setToks(h.expr);
        setCursor(h.expr.length);
      }
      setJustEq(null);
      setErr(null);
    }
  };

  // ── history interactions ───────────────────────────────────────────────────

  const useResult = (v: number) => {
    let s = fmt(v);
    if (s.includes('×10^')) s = s.replace('×10^', 'E');
    const tk: Tok = { t: 'num', v: s };
    if (justEq) {
      setToks([tk]);
      setCursor(1);
      setJustEq(null);
      setErr(null);
      return;
    }
    const prev = toks[cursor - 1];
    const ins: Tok[] = isValueEnd(prev) ? [{ t: 'lp' }, tk, { t: 'rp' }] : [tk];
    setToks([...toks.slice(0, cursor), ...ins, ...toks.slice(cursor)]);
    setCursor(cursor + ins.length);
    setErr(null);
  };

  const deleteRecord = (id: string) => setHistory(history.filter((h) => h.id !== id));

  const clearHistoryAll = () => {
    setHistory([]);
    toast({ title: 'History cleared' });
  };

  const saveRate = (r: number) => {
    setVatRate(r);
    setRate(r); // one rate everywhere — the Sales view follows
    toast({ title: `VAT rate set to ${fmtRate(r)}%`, description: 'Used by the Sales view and the TAX keys' });
  };

  const toggleTape = () => {
    const open = !tapeOpen;
    setTapeOpen(open);
    if (open) setTimeout(() => tapeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 90);
  };

  // ── SHIFT + dispatcher (every keypress: sound + narration) ─────────────────

  const SHIFTED: Record<string, () => void> = {
    gt: () => {
      setGt(0);
      toast({ title: 'GT cleared' });
    },
  };

  const press = (id: string) => {
    markPressed(id);
    if (id === 'shift') {
      setShift((s) => !s);
      sfx.play('ui');
      narrator.word('shift');
      return;
    }
    // SOUND / VOICE toggles — chime only, never spoken words
    if (id === 'sound') {
      const next = !soundOn;
      setSoundOn(next);
      sfx.setEnabled(next);
      sfx.play(next ? 'chime-on' : 'chime-off', true);
      return;
    }
    if (id === 'voice') {
      const next = !voiceOn;
      setVoiceOn(next);
      narrator.setEnabled(next);
      sfx.play(next ? 'chime-on' : 'chime-off', true);
      return;
    }
    if (shift) {
      setShift(false);
      sfx.play(SOUND_BY_ID[id] ?? 'ui');
      const w = NARR_SHIFT_BY_ID[id] ?? NARR_BY_ID[id];
      if (w) narrator.word(w);
      const f = SHIFTED[id];
      if (f) f();
      return; // shifted key with no alternate function — consumed
    }
    if (/^[0-9]$/.test(id)) {
      sfx.play('digit');
      narrator.digit(DIGIT_WORDS[Number(id)]);
      hDigit(id);
      return;
    }
    sfx.play(SOUND_BY_ID[id] ?? 'ui');
    const nw = NARR_BY_ID[id];
    if (nw) narrator.word(nw);
    switch (id) {
      case 'on':
      case 'ac':
        hAC();
        return;
      case 'del':
        hDel();
        return;
      case 'eq':
        hEq();
        return;
      case 'gt':
        hGT();
        return;
      case 'mu':
        hOp('MU');
        return;
      case 'rate':
        setRateOpen(true);
        return;
      case 'hist':
        toggleTape();
        return;
      case 'help':
        setHelpOpen(true);
        return;
      case 'vat+':
        hVat('add');
        return;
      case 'vat-':
        hVat('sub');
        return;
      case 'vat-amt':
        hVat('amt');
        return;
      case 'split':
        // VAT SPLIT — net + VAT breakdown of the shown amount
        setBreakOpen(true);
        return;
      case 'pct':
        hPost('%');
        return;
      case 'lp':
        hLp();
        return;
      case 'rp':
        hRp();
        return;
      case 'ans':
        hConst('Ans');
        return;
      case 'm-plus':
        hMem('add');
        return;
      case 'm-minus':
        hMem('sub');
        return;
      case 'mr':
        hMem('recall');
        return;
      case 'mc':
        hMem('clear');
        return;
      case 'dbl0':
        hDbl0();
        return;
      case 'dot':
        hDot();
        return;
      case 'minus':
        hMinus();
        return;
      case 'plus':
        hOp('+');
        return;
      case 'mul':
        hOp('×');
        return;
      case 'div':
        hOp('÷');
        return;
      case 'left':
        hMove(-1);
        return;
      case 'right':
        hMove(1);
        return;
      case 'up':
        hRecall(1);
        return;
      case 'down':
        hRecall(-1);
        return;
    }
  };

  // ── physical keyboard ──────────────────────────────────────────────────────

  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (rateOpen || helpOpen || breakOpen) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      const k = e.key;
      let id: string | null = null;
      if (/^[0-9]$/.test(k)) id = k;
      else if (k === '.' || k === ',') id = 'dot';
      else if (k === '+') id = 'plus';
      else if (k === '-') id = 'minus';
      else if (k === '*') id = 'mul';
      else if (k === '/') id = 'div';
      else if (k === '%') id = 'pct';
      else if (k === '(') id = 'lp';
      else if (k === ')') id = 'rp';
      else if (k === 'Enter' || k === '=') id = 'eq';
      else if (k === 'Backspace') id = 'del';
      else if (k === 'Escape' || k === 'Delete') id = 'ac';
      else if (k === 'ArrowLeft') id = 'left';
      else if (k === 'ArrowRight') id = 'right';
      else if (k === 'ArrowUp') id = 'up';
      else if (k === 'ArrowDown') id = 'down';
      if (id) {
        e.preventDefault();
        pressRef.current(id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rateOpen, helpOpen, breakOpen]);

  // ── paste anywhere → insert into the expression SILENTLY ───────────────────
  // (no key sound, no narration — pasted numbers never speak, per spec)

  const insertSilent = (text: string) => {
    const { t, c } = base();
    const out: Tok[] = [...t.slice(0, c)];
    let num = '';
    const flushNum = () => {
      if (num && num !== '-') {
        out.push({ t: 'num', v: num });
        num = '';
      }
    };
    for (const ch of text.replace(/\s+/g, '').slice(0, 120)) {
      if (/[0-9]/.test(ch)) {
        num += ch;
        continue;
      }
      if (ch === ',') continue; // thousands separator — dropped
      if (ch === '.') {
        if (!num.includes('.')) num = (num || '0') + '.';
        continue;
      }
      flushNum();
      if (ch === '+') out.push({ t: 'bin', v: '+' });
      else if (ch === '-') {
        const p = out[out.length - 1];
        if (!p || p.t === 'lp' || p.t === 'bin') num = '-'; // leading negative
        else out.push({ t: 'bin', v: '−' });
      } else if (ch === '*' || ch === 'x' || ch === 'X') out.push({ t: 'bin', v: '×' });
      else if (ch === '/') out.push({ t: 'bin', v: '÷' });
      else if (ch === '^') out.push({ t: 'bin', v: '^' });
      else if (ch === '(') out.push({ t: 'lp' });
      else if (ch === ')') out.push({ t: 'rp' });
      else if (ch === '%') out.push({ t: 'post', v: '%' });
    }
    flushNum();
    const at = out.length;
    if (at === c && out.length === t.slice(0, c).length) return; // nothing usable
    commit([...out, ...t.slice(c)], at);
  };
  const insertRef = useRef(insertSilent);
  insertRef.current = insertSilent;

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (rateOpen || helpOpen || breakOpen) return;
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      const text = e.clipboardData?.getData('text');
      if (!text) return;
      e.preventDefault();
      insertRef.current(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [rateOpen, helpOpen, breakOpen]);

  // keep the LCD scrolled to the cursor
  useEffect(() => {
    if (curRef.current) curRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    else if (exprRef.current) exprRef.current.scrollLeft = exprRef.current.scrollWidth;
  }, [toks, cursor, justEq]);

  // ── key component ──────────────────────────────────────────────────────────

  const Key = ({
    id,
    label,
    sft,
    cls,
    title,
  }: {
    id: string;
    label: ReactNode;
    sft?: ReactNode;
    cls: string;
    title?: string;
  }) => (
    <button
      type="button"
      className={`ckey ${cls} ${pressed === id ? 'pressed' : ''}`}
      onClick={() => press(id)}
      title={title}
      aria-label={title ?? id}
    >
      {sft != null && <span className="sft">{sft}</span>}
      <span className="lbl">{label}</span>
    </button>
  );

  const numCls = 'k-light';

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col items-start justify-center gap-6 lg:flex-row">
      <div className="calc-shell">
        {/* brand */}
        <div className="calc-brand">
          <div>
            <span className="name">U·CALC</span>
            <span className="model" style={{ marginLeft: 10 }}>
              URB-991ES PLUS
            </span>
          </div>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="Key guide"
            aria-label="Key guide"
            className="flex items-center gap-1 rounded-md border border-neutral-600 px-2 py-1 text-[9px] font-bold tracking-widest text-neutral-300 hover:bg-neutral-700/60"
          >
            <CircleHelp size={11} /> GUIDE
          </button>
        </div>

        {/* LCD */}
        <div className="lcd-bezel">
          <div className="lcd">
            <div className="lcd-status">
              <span className={shift ? 'on' : ''}>S</span>
              <span className={mem !== 0 ? 'on' : ''}>M</span>
              <span className={gt !== 0 ? 'on' : ''}>GT</span>
              <span className={soundOn ? 'on' : ''}>SND</span>
              <span className={voiceOn ? 'on' : ''}>SAY</span>
              <span>{histNav != null ? `H·${histNav + 1}` : '　'}</span>
              <button
                type="button"
                className="vat-chip"
                onClick={() => setRateOpen(true)}
                title="Set VAT rate"
              >
                VAT {fmtRate(vatRate)}%
              </button>
            </div>

            <div className="lcd-expr" ref={exprRef}>
              {justEq ? (
                <span className="done">
                  {justEq.label && <span className="gt-tag">{justEq.label}</span>}
                  <TokList toks={justEq.expr} vatRate={vatRate} />
                  {justEq.expr.length > 0 && <span className="eq-sign">=</span>}
                </span>
              ) : (
                <>
                  {toks.map((tk, idx) => (
                    <Fragment key={idx}>
                      {idx === cursor && <span className="cur" ref={curRef} />}
                      <TokView tk={tk} vatRate={vatRate} />
                    </Fragment>
                  ))}
                  {cursor === toks.length && <span className="cur" ref={curRef} />}
                </>
              )}
            </div>

            <div className="lcd-result">
              {err ? (
                <span className="lcd-err">{err}</span>
              ) : justEq ? (
                <span className="lcd-final">
                  <NumText x={justEq.value} />
                </span>
              ) : preview?.ok ? (
                <>
                  <span className="pv-tag">PREVIEW</span>
                  <span className="lcd-prev">
                    <NumText x={preview.value} />
                  </span>
                </>
              ) : (
                <span className="lcd-wait">{toks.length ? '· · ·' : ''}</span>
              )}
            </div>
          </div>
        </div>

        {/* keyboard */}
        <div className="kbd">
          {/* row 1–2: SHIFT / HIST / REPLAY / MODE / ON / GT / MU / DRG / RATE */}
          <div className="mb-2.5 grid grid-cols-[1fr_1fr_auto_1fr_1fr] grid-rows-2 gap-2">
            <Key id="shift" label="SHIFT" cls={`k-shift ${shift ? 'on' : ''}`} title="SHIFT — alternate functions (orange labels)" />
            <Key id="hist" label="HIST" cls="k-dark" title="Show / hide the history tape" />
            <div className="col-start-3 row-span-2 row-start-1 flex items-center justify-center">
              <div className="replay">
                <button type="button" className="rp rp-up" onClick={() => press('up')} title="Recall previous entry" aria-label="Recall previous entry">
                  <ChevronUp size={15} />
                </button>
                <button type="button" className="rp rp-down" onClick={() => press('down')} title="Next entry" aria-label="Next entry">
                  <ChevronDown size={15} />
                </button>
                <button type="button" className="rp rp-left" onClick={() => press('left')} title="Move cursor left" aria-label="Move cursor left">
                  <ChevronLeft size={15} />
                </button>
                <button type="button" className="rp rp-right" onClick={() => press('right')} title="Move cursor right" aria-label="Move cursor right">
                  <ChevronRight size={15} />
                </button>
                <div className="ctr">REPLAY</div>
              </div>
            </div>
            <Key id="rate" label="RATE" cls="k-dark" title="Set the VAT rate" />
            <Key id="on" label="ON" cls="k-dark" title="Reset the display" />
            <Key id="gt" label="GT" sft="CLR" cls="k-amber" title="Grand total — sum of all = results (SHIFT: clear)" />
            <Key id="mu" label="MU" cls="k-amber" title="Margin markup: 100 MU 20 = 125" />
            <Key
              id="sound"
              label={
                <span className="tg-lbl">
                  {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  SOUND
                </span>
              }
              cls={`k-toggle ${soundOn ? 'on' : ''}`}
              title={`Key sounds ${soundOn ? 'ON' : 'OFF'} — a distinct tone for every key type (digits, + − × ÷, = …). Toggling plays a chime.`}
            />
            <Key
              id="voice"
              label={
                <span className="tg-lbl">
                  <Speech size={14} />
                  VOICE
                </span>
              }
              cls={`k-toggle ${voiceOn ? 'on' : ''}`}
              title={`Key narration ${voiceOn ? 'ON' : 'OFF'} — speaks each key as you type, at full speed. Toggling plays a chime only.`}
            />
          </div>

          {/* VAT row — the four business keys, separate, BIGGER than the
              operator keys, with proper breathing space above them */}
          <div className="vatrow mb-2.5 grid grid-cols-4 gap-3">
            <Key
              id="vat+"
              label="+VAT"
              cls="k-green"
              title={`Add ${fmtRate(vatRate)}% VAT — 100 → ${fmt(100 * (1 + vatRate / 100))}`}
            />
            <Key
              id="vat-"
              label="−VAT"
              cls="k-red"
              title={`Remove ${fmtRate(vatRate)}% VAT — ${fmt(100 * (1 + vatRate / 100))} → 100`}
            />
            <Key
              id="vat-amt"
              label="VAT·AMT"
              cls="k-amber"
              title={`VAT contained in an amount — ${fmt(100 * (1 + vatRate / 100))} VAT(${fmtRate(vatRate)}%) = ${fmt(100 * (vatRate / 100))}`}
            />
            <Key
              id="split"
              label="VAT·SPLIT"
              cls="k-split"
              title="VAT SPLIT — breaks the shown amount into net + VAT (both directions)"
            />
          </div>

          {/* utility row — brackets, percent, Ans, memory */}
          <div className="bizzone mb-2 grid grid-cols-8 gap-1.5">
            <Key id="lp" label="(" cls="k-dark" title="Open parenthesis" />
            <Key id="rp" label=")" cls="k-dark" title="Close parenthesis" />
            <Key id="pct" label="%" cls="k-dark" title="Business percent: 200+10% = 220" />
            <Key id="ans" label="Ans" cls="k-dark" title="Last committed result" />
            <Key id="m-plus" label="M+" cls="k-mem" title="Add displayed value to memory" />
            <Key id="m-minus" label="M−" cls="k-mem" title="Subtract displayed value from memory" />
            <Key id="mr" label="MR" cls="k-mem" title="Recall memory" />
            <Key id="mc" label="MC" cls="k-mem" title="Clear memory" />
          </div>

          {/* numeric block — the big keys: digits and + − × ÷ = */}
          <div className="numzone grid grid-cols-5 gap-2">
            <Key id="7" label="7" cls={`${numCls} big`} />
            <Key id="8" label="8" cls={`${numCls} big`} />
            <Key id="9" label="9" cls={`${numCls} big`} />
            <Key id="del" label="DEL" cls="k-dark" title="Delete before cursor" />
            <Key id="ac" label="AC" cls="k-ac" title="Clear everything" />
            <Key id="4" label="4" cls={`${numCls} big`} />
            <Key id="5" label="5" cls={`${numCls} big`} />
            <Key id="6" label="6" cls={`${numCls} big`} />
            <Key id="mul" label="×" cls={`${numCls} big`} title="Multiply" />
            <Key id="div" label="÷" cls={`${numCls} big`} title="Divide" />
            <Key id="1" label="1" cls={`${numCls} big`} />
            <Key id="2" label="2" cls={`${numCls} big`} />
            <Key id="3" label="3" cls={`${numCls} big`} />
            <Key id="plus" label="+" cls={`${numCls} big`} title="Add" />
            <Key id="minus" label="−" cls={`${numCls} big`} title="Subtract" />
            <Key id="0" label="0" cls={`${numCls} big`} />
            <Key id="dot" label="·" cls={`${numCls} big`} title="Decimal point" />
            <Key id="dbl0" label="00" cls={numCls} title="Double zero — 5 → 500" />
            <Key id="eq" label="=" cls="k-eq big" title="Evaluate & save to history" />
          </div>
        </div>
      </div>

      {/* history tape */}
      <div
        ref={tapeRef}
        className={`w-full lg:w-[320px] lg:shrink-0 ${tapeOpen ? 'block' : 'hidden lg:block'}`}
      >
        <HistoryTape
          history={history}
          vatRate={vatRate}
          deviceTag={deviceTag}
          onDelete={deleteRecord}
          onClear={clearHistoryAll}
          onUse={useResult}
        />
      </div>

      {/* dialogs */}
      <RateDialog open={rateOpen} onOpenChange={setRateOpen} rate={vatRate} onSave={saveRate} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} vatRate={vatRate} />
      <BreakdownDialog open={breakOpen} onOpenChange={setBreakOpen} value={breakVal} rate={vatRate} />
    </div>
  );
}
