'use client';

import { ReactNode } from 'react';
import { Tok, fmt, tokStr } from '@/lib/calc/engine';

/** Renders a formatted number, "1.5×10^-7" gets a real superscript. */
export function NumText({ x, className }: { x: number; className?: string }) {
  const s = fmt(x);
  if (s.includes('×10^')) {
    const [m, ex] = s.split('×10^');
    return (
      <span className={className}>
        {m}×10<sup>{ex}</sup>
      </span>
    );
  }
  return <span className={className}>{s}</span>;
}

/** One expression token, styled for the LCD / tape. */
export function TokView({ tk, vatRate }: { tk: Tok; vatRate: number }) {
  if (tk.t === 'num') {
    const s = tokStr(tk, vatRate); // digits, ×10^ for exponent
    if (s.includes('×10^')) {
      const [m, ex] = s.split('×10^');
      return (
        <span className="tk">
          {m}×10<sup>{ex}</sup>
        </span>
      );
    }
    return <span className="tk">{s}</span>;
  }
  if (tk.t === 'vat') return <span className="tk tk-vat">{tokStr(tk, vatRate)}</span>;
  if (tk.t === 'bin' && tk.v === 'MU') return <span className="tk tk-mu">MU</span>;
  return <span className="tk">{tokStr(tk, vatRate)}</span>;
}

/** A whole token sequence. */
export function TokList({
  toks,
  vatRate,
  wrap,
}: {
  toks: Tok[];
  vatRate: number;
  wrap?: boolean;
}) {
  const items: ReactNode[] = toks.map((tk, i) => (
    <TokView key={i} tk={tk} vatRate={vatRate} />
  ));
  return <span style={wrap ? { wordBreak: 'break-all', lineHeight: 1.5 } : undefined}>{items}</span>;
}
