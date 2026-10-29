'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { NumText } from './bits';
import { Angle, fmt, fmtRate } from '@/lib/calc/engine';

// ─── VAT rate ────────────────────────────────────────────────────────────────

const PRESETS = [0, 5, 8, 10, 13, 15, 17.5, 20, 23, 25];

export function RateDialog({
  open,
  onOpenChange,
  rate,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rate: number;
  onSave: (r: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* body is a child component so its state resets every time the dialog opens */}
      <DialogContent className="sm:max-w-sm">
        <RateDialogBody rate={rate} onSave={onSave} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function RateDialogBody({
  rate,
  onSave,
  onOpenChange,
}: {
  rate: number;
  onSave: (r: number) => void;
  onOpenChange: (o: boolean) => void;
}) {
  const [v, setV] = useState(String(parseFloat(rate.toFixed(2))));

  const parsed = parseFloat(v);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;
  const pv = valid ? parsed : rate;

  const save = () => {
    if (!valid) return;
    onSave(parsed);
    onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
          <DialogTitle>VAT rate</DialogTitle>
          <DialogDescription>
            Used by the +VAT, −VAT and VAT AMT keys. Saved automatically on this device.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <Input
            inputMode="decimal"
            value={v}
            autoFocus
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
            className="w-28 text-right font-mono text-base"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p}
              type="button"
              variant={Math.abs(pv - p) < 1e-9 ? 'default' : 'outline'}
              size="sm"
              className="h-8 font-mono text-xs"
              onClick={() => setV(String(p))}
            >
              {p === 17.5 ? '17.5' : p}
            </Button>
          ))}
        </div>
        <div className="rounded-md bg-muted/60 px-3 py-2 font-mono text-[11px] leading-6 text-muted-foreground">
          <div>100 +VAT({fmtRate(pv)}%) = {fmt(100 * (1 + pv / 100))}</div>
          <div>100 −VAT({fmtRate(pv)}%) = {fmt(100 / (1 + pv / 100))}</div>
          <div>100 VAT({fmtRate(pv)}%) = {fmt((100 * pv) / (100 + pv))}</div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!valid}>
            Save rate
          </Button>
        </DialogFooter>
    </>
  );
}

// ─── Setup (MODE) ────────────────────────────────────────────────────────────

export function SetupDialog({
  open,
  onOpenChange,
  angle,
  onAngle,
  vatRate,
  onRate,
  historyCount,
  onClearHistory,
  onResetAll,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  angle: Angle;
  onAngle: (a: Angle) => void;
  vatRate: number;
  onRate: (r: number) => void;
  historyCount: number;
  onClearHistory: () => void;
  onResetAll: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>SETUP</DialogTitle>
          <DialogDescription>Calculator settings — saved automatically.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label className="text-xs">VAT rate</Label>
          <div className="grid grid-cols-5 gap-1.5">
            {[5, 10, 13, 20].map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant={Math.abs(vatRate - p) < 1e-9 ? 'default' : 'outline'}
                className="h-8 font-mono text-xs"
                onClick={() => onRate(p)}
              >
                {p}%
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Angle unit (DRG)</Label>
          <RadioGroup
            value={angle}
            onValueChange={(a) => onAngle(a as Angle)}
            className="flex gap-4"
          >
            {(['DEG', 'RAD', 'GRA'] as Angle[]).map((a) => (
              <div key={a} className="flex items-center space-x-2">
                <RadioGroupItem value={a} id={`ang-${a}`} />
                <Label htmlFor={`ang-${a}`} className="font-mono text-xs">
                  {a}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <Separator />

        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start text-destructive"
            onClick={() => {
              onClearHistory();
              onOpenChange(false);
            }}
          >
            Clear history ({historyCount} entries)
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start text-destructive"
            onClick={() => {
              onResetAll();
              onOpenChange(false);
            }}
          >
            Reset everything (rate, memory, GT, history)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── VAT breakdown (SHIFT + VAT AMT) ────────────────────────────────────────

export function BreakdownDialog({
  open,
  onOpenChange,
  value,
  rate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  value: number | null;
  rate: number;
}) {
  const r = rate / 100;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>VAT breakdown · {fmtRate(rate)}%</DialogTitle>
          <DialogDescription>
            {value == null
              ? 'Enter an amount on the calculator first.'
              : 'Both interpretations of the current value.'}
          </DialogDescription>
        </DialogHeader>
        {value != null && (
          <div className="space-y-3 font-mono text-sm">
            <div className="rounded-md border p-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                If {fmt(value)} is NET (before VAT)
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT</span>
                <NumText x={value * r} />
              </div>
              <div className="flex justify-between font-bold">
                <span>GROSS</span>
                <NumText x={value * (1 + r)} />
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                If {fmt(value)} is GROSS (VAT included)
              </div>
              <div className="flex justify-between font-bold">
                <span>NET</span>
                <NumText x={value / (1 + r)} />
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">VAT</span>
                <NumText x={value - value / (1 + r)} />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Help / key guide ───────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{children}</kbd>
  );
}

function HRow({ keys, desc }: { keys: React.ReactNode; desc: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-xs">
      <div className="w-32 shrink-0 font-mono font-semibold">{keys}</div>
      <div className="text-muted-foreground">{desc}</div>
    </div>
  );
}

export function HelpDialog({
  open,
  onOpenChange,
  vatRate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vatRate: number;
}) {
  const r = fmtRate(vatRate);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Key guide</DialogTitle>
          <DialogDescription>
            Live preview appears as you type. Press <Kbd>=</Kbd> to commit the calculation to the
            history tape — saved on THIS device, every session, every visit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-emerald-600">
              VAT & business
            </h3>
            <HRow keys="+VAT" desc={<>Add VAT to the amount: 100 → {fmt(100 * (1 + vatRate / 100))} (at {r}%)</>} />
            <HRow keys="−VAT" desc={<>Remove VAT from an inclusive amount: {fmt(100 * (1 + vatRate / 100))} → 100</>} />
            <HRow keys="VAT AMT" desc={<>The VAT contained in an amount: {fmt(100 * (1 + vatRate / 100))} VAT({r}%) = {fmt(100 * (vatRate / 100))}</>} />
            <HRow keys="VAT SPLIT" desc="Split the shown amount into net + VAT — both directions at once" />
            <HRow keys="%" desc="Business percent: 200+10% = 220 · 200−10% = 180 · 200×10% = 20" />
            <HRow keys="MU" desc="Margin markup: 100 MU 20 = 125 (margin is 20% of the price)" />
            <HRow keys="GT" desc="Grand total — sum of every = result. SHIFT+GT clears it" />
            <HRow keys="RATE" desc="Set the VAT rate (also click the VAT chip on the display)" />
          </section>

          <section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-cyan-700">
              Sound & voice
            </h3>
            <HRow
              keys="SOUND"
              desc={<>A distinct tone for every key type — digits, <Kbd>+</Kbd> <Kbd>−</Kbd> <Kbd>×</Kbd> <Kbd>÷</Kbd> <Kbd>=</Kbd> functions — so you always hear the press landed. On / off plays a chime.</>}
            />
            <HRow
              keys="VOICE"
              desc="Speaks each key as you type it. Digits are read one-by-one at full speed; if you out-type it, it catches up and reads the whole number, then the operator. Paste stays silent. On / off plays a chime only — it never speaks words."
            />
          </section>

          <section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-amber-600">
              Memory & helpers
            </h3>
            <HRow keys="M+ / M−" desc="Add / subtract the displayed value to memory" />
            <HRow keys="MR / MC" desc="Recall memory (inserts M) / clear memory" />
            <HRow keys="Ans" desc="Last committed result" />
            <HRow keys="( )" desc="Parentheses for grouping" />
            <HRow keys="00" desc="Double zero — one press appends two zeros" />
          </section>

          <section>
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Typing & editing
            </h3>
            <HRow keys={<><Kbd>0-9</Kbd> <Kbd>.</Kbd> <Kbd>+ − * / % ( )</Kbd></>} desc="Full physical keyboard input" />
            <HRow keys={<><Kbd>Enter</Kbd></>} desc="= (commit to history)" />
            <HRow keys={<><Kbd>⌫</Kbd></>} desc="DEL — delete before cursor" />
            <HRow keys={<><Kbd>Esc</Kbd></>} desc="AC — clear the expression" />
            <HRow keys={<><Kbd>◄ ►</Kbd></>} desc="Move the cursor inside the expression" />
            <HRow keys={<><Kbd>▲ ▼</Kbd></>} desc="Recall previous entries from history" />
            <HRow keys={<><Kbd>Ctrl+V</Kbd></>} desc="Paste numbers / expressions anywhere — inserted silently (no sound, no narration)" />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
