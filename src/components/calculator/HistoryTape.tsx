'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ReceiptText, Trash2, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { HistItem, fmt } from '@/lib/calc/engine';
import { NumText, TokList } from './bits';

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()} ${hh}:${mm}`;
}

export function HistoryTape({
  history,
  vatRate,
  deviceTag,
  onDelete,
  onClear,
  onUse,
}: {
  history: HistItem[];
  vatRate: number;
  deviceTag: string;
  onDelete: (id: string) => void;
  onClear: () => void;
  onUse: (value: number) => void;
}) {
  return (
    <div className="tape w-full lg:w-[320px] lg:sticky lg:top-6">
      <div className="tape-head">
        <div className="t1">
          <ReceiptText size={14} />
          <span>CALCULATION TAPE</span>
          <span
            className="dev-chip"
            title="History is stored per device — every device keeps its own list, no interlap"
          >
            DEVICE #{deviceTag || '····'}
          </span>
        </div>
        <div className="t2">
          <span>{history.length} saved</span>
          <span>·</span>
          <span>click a row to reuse</span>
          <span className="ml-auto">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="nb-clear h-6 gap-1 rounded-none border-2 border-[#14120B] bg-[#FF6B6B] px-2 text-[10px] font-bold text-white shadow-[2px_2px_0_#14120B] hover:bg-[#e05555] hover:text-white disabled:opacity-40"
                  disabled={history.length === 0}
                >
                  <Trash2 size={11} /> Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all history?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes all {history.length} saved calculations from THIS
                    device. Other devices are not affected. It cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep them</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={onClear}
                  >
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </span>
        </div>
      </div>

      <div className="tape-body">
        {history.length === 0 ? (
          <div className="tape-empty">
            ── NO CALCULATIONS YET ──
            <br />
            press <b>=</b> to print a calculation here
            <br />
            stays on this device — every visit, every session
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {history.map((h) => (
              <motion.div
                key={h.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                className="tape-row"
                onClick={() => onUse(h.result)}
                title="Click to insert this result into the calculator"
              >
                <div className="tape-expr">
                  <TokList toks={h.expr} vatRate={vatRate} wrap />
                </div>
                <div className="tape-line">
                  <span className="tape-eq">=</span>
                  <span className="tape-res">
                    <NumText x={h.result} />
                  </span>
                </div>
                <div className="tape-meta">
                  <span>{fmtTime(h.ts)}</span>
                  <button
                    className="tape-del"
                    title="Delete this record"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(h.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
      <div className="tape-foot">· · · THIS DEVICE ONLY · · ·</div>
    </div>
  );
}
