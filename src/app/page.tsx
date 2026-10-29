'use client';

import { useState } from 'react';
import { Calculator, ReceiptText } from 'lucide-react';
import Calc from '@/components/calculator/Calc';
import Sales from '@/components/sales/Sales';
import './retro.css';

const MARQUEE =
  ' NON-REVERSE + REVERSE VAT · LINKED FIELDS · PCS / KG / DOZEN · TIDY QTY & RATE OPTIONS · URB-991ES PLUS CALCULATOR · +VAT · −VAT · VAT AMT · VAT SPLIT · PER-DEVICE HISTORY · ';

export default function Home() {
  const [view, setView] = useState<'sales' | 'calc'>('sales');
  const sales = view === 'sales';

  return (
    <div className="retro-page flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-[960px] px-3 pt-5 sm:px-4 sm:pt-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
          {sales ? (
            <h1 className="nb-title -rotate-1 select-none">
              URB VATCALC<span className="es">PRO</span>
            </h1>
          ) : (
            <h1 className="nb-title -rotate-1 select-none">
              URB-991<span className="es">ES PLUS</span>
            </h1>
          )}
          <div className="flex rotate-[0.6deg] flex-wrap items-center gap-2.5">
            {sales ? (
              <>
                <span className="nb-chip bg-[#FF6B6B] text-white">SALES + VAT</span>
                <span className="nb-chip bg-[#00A878] text-white">NON-REV DEFAULT</span>
                <span className="nb-chip bg-white">LOCAL-FIRST</span>
              </>
            ) : (
              <>
                <span className="nb-chip bg-[#FF6B6B] text-white">BUSINESS KEYS</span>
                <span className="nb-chip bg-[#00A878] text-white">NATURAL DISPLAY</span>
                <span className="nb-chip bg-white">LOCAL-FIRST</span>
              </>
            )}
          </div>

          {/* the side button — Sales is the home, the calculator is one tap away */}
          <div className="ml-auto">
            {sales ? (
              <button
                type="button"
                className="nb-side-btn"
                onClick={() => setView('calc')}
                title="Open the URB-991ES PLUS shop calculator"
                aria-label="Open the calculator"
              >
                <Calculator size={17} strokeWidth={2.4} />
                CALCULATOR →
              </button>
            ) : (
              <button
                type="button"
                className="nb-side-btn back"
                onClick={() => setView('sales')}
                title="Back to Sales & VAT"
                aria-label="Back to Sales and VAT"
              >
                <ReceiptText size={17} strokeWidth={2.4} />
                ← SALES &amp; VAT
              </button>
            )}
          </div>
        </div>
        <div className="marquee mt-4 select-none" aria-hidden="true">
          <div className="marquee-track">
            <span>{MARQUEE}</span>
            <span>{MARQUEE}</span>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-3 py-5 sm:px-4 sm:py-8">
        {sales ? <Sales /> : <Calc />}
      </main>

      <footer className="retro-foot mt-auto">
        {sales ? (
          <p>
            Fields are linked — change one, the others adjust · tidy chips offer bill-friendly qty / rates · save lines
            to this device’s ledger · <b>one VAT rate everywhere</b>
          </p>
        ) : (
          <p>
            <kbd>0-9</kbd> <kbd>.</kbd> <kbd>+ − * / % ( )</kbd> · <kbd>ENTER</kbd> = · <kbd>⌫</kbd> DEL ·{' '}
            <kbd>ESC</kbd> AC · <kbd>← →</kbd> cursor · <kbd>↑ ↓</kbd> history · paste anywhere (silent)
          </p>
        )}
        <p className="mt-0.5">
          URB VATCalc Pro · every device keeps its own histories — no interlap · no cloud · no tracking
        </p>
      </footer>
    </div>
  );
}
