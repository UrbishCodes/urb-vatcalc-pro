// ─────────────────────────────────────────────────────────────────────────────
// fx-991 BUSINESS PLUS — expression engine
// Token-based natural-display model + recursive-descent evaluator.
//
// Business features:
//   +VAT(r)   postfix: gross = net × (1 + r)          e.g. 100 +VAT(13%) = 113
//   −VAT(r)   postfix: net  = gross / (1 + r)         e.g. 113 −VAT(13%) = 100
//   VAT(r)    postfix: VAT inside a gross amount      e.g. 113 VAT(13%)  = 13
//   MU        binary : margin markup, a MU b = a/(1−b/100)   e.g. 100 MU 20 = 125
//   %         business percent: 200+10% = 220, 200−10% = 180, 200×10% = 20
//
// Scientific: sin cos tan (shift: inverses), log ln, 10^ e^, x^y ˣ√, √ ∛,
//   x² x³ x⁻¹, n!, π e, ×10^ exponent entry, parentheses, Ans & memory recall.
// ─────────────────────────────────────────────────────────────────────────────

export type FnName =
  | 'sin' | 'cos' | 'tan'
  | 'asin' | 'acos' | 'atan'
  | 'log' | 'ln'
  | 'sqrt' | 'cbrt'
  | 'pow10' | 'powe';

export type BinOp = '+' | '−' | '×' | '÷' | '^' | 'ˣ√' | 'MU';

export type Tok =
  | { t: 'num'; v: string } // digits, may contain '.' and 'E' (×10^ exponent, may end 'E'/'E-')
  | { t: 'bin'; v: BinOp }
  | { t: 'fn'; v: FnName }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'post'; v: 'x²' | 'x³' | 'x⁻¹' | '!' | '%' }
  | { t: 'vat'; v: 'add' | 'sub' | 'amt' }
  | { t: 'const'; v: 'π' | 'e' | 'Ans' | 'M' };

export type Angle = 'DEG' | 'RAD' | 'GRA';

export interface EvalCtx {
  vat: number; // VAT percent, e.g. 13 means 13%
  angle: Angle;
  ans: number;
  mem: number;
}

export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; error: 'syntax' | 'math' };

export interface HistItem {
  id: string;
  ts: number;
  expr: Tok[];
  result: number;
}

export const FN_LABEL: Record<FnName, string> = {
  sin: 'sin(', cos: 'cos(', tan: 'tan(',
  asin: 'sin⁻¹(', acos: 'cos⁻¹(', atan: 'tan⁻¹(',
  log: 'log(', ln: 'ln(',
  sqrt: '√(', cbrt: '∛(',
  pow10: '10^(', powe: 'e^(',
};

// operator precedences (VAT postfix binds looser than +/− so it applies to the
// whole accumulated left side, exactly like a shop calculator's TAX key)
const PREC: Record<BinOp, number> = {
  '+': 1, '−': 1,
  MU: 1.5,
  '×': 2, '÷': 2,
  '^': 4, 'ˣ√': 4,
};
const VAT_PREC = 0.9;
const MUL_PREC = 2;

class CalcError extends Error {
  kind: 'syntax' | 'math';
  constructor(kind: 'syntax' | 'math') {
    super(kind);
    this.kind = kind;
  }
}

interface Node {
  v: number;
  pct: boolean; // bare percentage literal, e.g. "10%" — effective value is v/100
}

export function fmtRate(rate: number): string {
  return String(parseFloat(rate.toFixed(2)));
}

export function evaluate(toks: Tok[], ctx: EvalCtx): EvalResult {
  try {
    const n = toks.length;
    if (n === 0) return { ok: false, error: 'syntax' };
    let i = 0;

    const eff = (x: Node): number => (x.pct ? x.v / 100 : x.v);

    const toRad = (x: number): number =>
      ctx.angle === 'DEG' ? (x * Math.PI) / 180
        : ctx.angle === 'GRA' ? (x * Math.PI) / 200
          : x;
    const fromRad = (x: number): number =>
      ctx.angle === 'DEG' ? (x * 180) / Math.PI
        : ctx.angle === 'GRA' ? (x * 200) / Math.PI
          : x;

    const factorial = (x: number): number => {
      if (x < 0 || Math.floor(x) !== x) throw new CalcError('math');
      if (x > 170) return Infinity;
      let r = 1;
      for (let k = 2; k <= x; k++) r *= k;
      return r;
    };

    const applyVat = (x: number, kind: 'add' | 'sub' | 'amt'): number => {
      const r = ctx.vat / 100;
      if (kind === 'add') return x * (1 + r);
      if (kind === 'sub') return x / (1 + r);
      return (x * r) / (1 + r);
    };

    const applyFn = (f: FnName, x: number): number => {
      switch (f) {
        case 'sin': return Math.sin(toRad(x));
        case 'cos': return Math.cos(toRad(x));
        case 'tan': return Math.tan(toRad(x));
        case 'asin': return fromRad(Math.asin(x));
        case 'acos': return fromRad(Math.acos(x));
        case 'atan': return fromRad(Math.atan(x));
        case 'log': return Math.log10(x);
        case 'ln': return Math.log(x);
        case 'sqrt': return Math.sqrt(x);
        case 'cbrt': return Math.cbrt(x);
        case 'pow10': return Math.pow(10, x);
        case 'powe': return Math.exp(x);
      }
    };

    const parseNum = (raw: string): number => {
      const s = raw.endsWith('E') || raw.endsWith('E-')
        ? raw.slice(0, raw.endsWith('E-') ? raw.length - 2 : raw.length - 1)
        : raw;
      if (s === '' || s === '.') throw new CalcError('syntax');
      const v = parseFloat(s.replace('E', 'e'));
      if (Number.isNaN(v)) throw new CalcError('syntax');
      return v;
    };

    const constVal = (name: 'π' | 'e' | 'Ans' | 'M'): number => {
      switch (name) {
        case 'π': return Math.PI;
        case 'e': return Math.E;
        case 'Ans': return ctx.ans;
        case 'M': return ctx.mem;
      }
    };

    const combine = (op: BinOp, l: Node, r: Node): Node => {
      const lv = eff(l);
      switch (op) {
        case '+': return { v: r.pct ? lv + (lv * r.v) / 100 : lv + eff(r), pct: false };
        case '−': return { v: r.pct ? lv - (lv * r.v) / 100 : lv - eff(r), pct: false };
        case '×': return { v: lv * eff(r), pct: false };
        case '÷': return { v: lv / eff(r), pct: false };
        case '^': return { v: Math.pow(lv, eff(r)), pct: false };
        case 'ˣ√': return { v: Math.pow(eff(r), 1 / lv), pct: false };
        case 'MU': return { v: lv / (1 - r.v / 100), pct: false };
      }
    };

    const closeParen = (): void => {
      if (i < n && toks[i].t === 'rp') { i++; return; }
      if (i >= n) return; // auto-close at end of input (Casio behaviour)
      throw new CalcError('syntax');
    };

    const parsePrimary = (): Node => {
      if (i >= n) throw new CalcError('syntax');
      const tk = toks[i];
      if (tk.t === 'num') {
        i++;
        return { v: parseNum(tk.v), pct: false };
      }
      if (tk.t === 'const') {
        i++;
        return { v: constVal(tk.v), pct: false };
      }
      if (tk.t === 'lp') {
        i++;
        const x = parseExpr(0);
        closeParen();
        return { v: eff(x), pct: false };
      }
      if (tk.t === 'fn') {
        i++;
        const arg = parseExpr(0);
        closeParen();
        return { v: applyFn(tk.v, eff(arg)), pct: false };
      }
      throw new CalcError('syntax');
    };

    const parsePostfix = (): Node => {
      let x = parsePrimary();
      while (i < n && toks[i].t === 'post') {
        const tk = toks[i];
        i++;
        switch (tk.v) {
          case '%': x = { v: x.v, pct: true }; break;
          case 'x²': x = { v: Math.pow(eff(x), 2), pct: false }; break;
          case 'x³': x = { v: Math.pow(eff(x), 3), pct: false }; break;
          case 'x⁻¹':
            if (eff(x) === 0) throw new CalcError('math');
            x = { v: 1 / eff(x), pct: false };
            break;
          case '!': x = { v: factorial(eff(x)), pct: false }; break;
        }
      }
      return x;
    };

    const parseUnary = (): Node => {
      if (i < n && toks[i].t === 'bin' && toks[i].v === '−') {
        i++;
        const x = parseExpr(PREC['^']);
        return { v: -eff(x), pct: false };
      }
      if (i < n && toks[i].t === 'bin' && toks[i].v === '+') {
        i++;
        return parseExpr(PREC['^']);
      }
      return parsePostfix();
    };

    const parseExpr = (min: number): Node => {
      let left = parseUnary();
      while (i < n) {
        const tk = toks[i];
        // VAT postfix — loose binding: applies to the accumulated left value
        if (tk.t === 'vat') {
          if (VAT_PREC < min) break;
          i++;
          left = { v: applyVat(eff(left), tk.v), pct: false };
          continue;
        }
        if (tk.t === 'bin') {
          const p = PREC[tk.v];
          if (p < min) break;
          i++;
          const rightAssoc = tk.v === '^' || tk.v === 'ˣ√';
          const right = parseExpr(rightAssoc ? p : p + 1);
          left = combine(tk.v, left, right);
          continue;
        }
        // implicit multiplication: 2π, 3(4+5), 2sin(30), (2)(3)
        if (tk.t === 'num' || tk.t === 'const' || tk.t === 'lp' || tk.t === 'fn') {
          if (MUL_PREC < min) break;
          const right = parseExpr(MUL_PREC + 1);
          left = { v: eff(left) * eff(right), pct: false };
          continue;
        }
        break;
      }
      return left;
    };

    const root = parseExpr(0);
    if (i < n) throw new CalcError('syntax'); // leftover tokens, e.g. stray ')'
    const value = eff(root);
    if (!Number.isFinite(value) || Number.isNaN(value)) throw new CalcError('math');
    return { ok: true, value };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.kind };
    return { ok: false, error: 'syntax' };
  }
}

// ─── rendering ───────────────────────────────────────────────────────────────

export function tokStr(tk: Tok, vatRate: number): string {
  switch (tk.t) {
    case 'num': return tk.v.replace('E', '×10^');
    case 'bin': return tk.v === 'MU' ? ' MU ' : tk.v;
    case 'fn': return FN_LABEL[tk.v];
    case 'lp': return '(';
    case 'rp': return ')';
    case 'post': return tk.v;
    case 'vat': {
      const r = fmtRate(vatRate);
      if (tk.v === 'add') return `+VAT(${r}%)`;
      if (tk.v === 'sub') return `−VAT(${r}%)`;
      return `VAT(${r}%)`;
    }
    case 'const': return tk.v;
  }
}

export function exprToString(toks: Tok[], vatRate: number): string {
  return toks.map((t) => tokStr(t, vatRate)).join('');
}

/** Format a number Casio-style: 10 significant digits, ×10^n beyond range. */
export function fmt(x: number): string {
  if (!Number.isFinite(x) || Number.isNaN(x)) return 'ERROR';
  if (x === 0) return '0';
  const s = String(parseFloat(x.toPrecision(10)));
  if (!s.includes('e')) return s;
  const [m, e] = s.split('e');
  const ex = parseInt(e, 10);
  return `${m}×10^${ex}`;
}

/** True when a token sequence can legally be followed by a postfix/vat token. */
export function isValueEnd(tk: Tok | undefined): boolean {
  if (!tk) return false;
  return tk.t === 'num' || tk.t === 'rp' || tk.t === 'const' || tk.t === 'post' || tk.t === 'vat';
}
