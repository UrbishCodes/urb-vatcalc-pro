// ─────────────────────────────────────────────────────────────────────────────
// URB-991 key sound engine (WebAudio, zero assets)
//
// EVERY operation key has its own clearly different contour so the user can
// hear exactly which key landed — no two operation sounds share a shape:
//   + rising 5th · − falling 5th · × up-arpeggio · ÷ down-arpeggio
//   = resolved ding · % rising zip · MU two-step · GT low gong
//   +VAT rising bell · −VAT falling bell · VAT AMT high bell · SPLIT ding-ding
// The SOUND key gates everything; the SOUND/VOICE toggle chimes always play
// (they are the state-change feedback itself).
// ─────────────────────────────────────────────────────────────────────────────

export type SfxKind =
  | 'digit'
  | 'dot'
  | 'dbl0'
  | 'ui'
  | 'op-plus'
  | 'op-minus'
  | 'op-mul'
  | 'op-div'
  | 'eq'
  | 'pct'
  | 'mu'
  | 'gt'
  | 'vat-plus'
  | 'vat-minus'
  | 'vat-amt'
  | 'vat-split'
  | 'lp'
  | 'rp'
  | 'ans'
  | 'mem'
  | 'del'
  | 'clear'
  | 'err'
  | 'chime-on'
  | 'chime-off';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
      } catch {
        return null;
      }
      // compressor keeps overlapping key presses from clipping
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setEnabled(v: boolean) {
    this.enabled = v;
  }

  /**
   * One tone. `to` slides the pitch (exponential ramp) for zip / bell sounds.
   * freq Hz · dur seconds · type wave · gain 0-1 · delay seconds from now
   */
  private tone(freq: number, dur = 0.06, type: OscillatorType = 'sine', gain = 0.15, delay = 0, to?: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(30, freq), t0);
    if (to != null && to > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), t0 + dur * 0.92);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /**
   * Play a key sound. `force` bypasses the enabled gate — used only for the
   * SOUND / VOICE toggle chimes so the state change is always audible.
   */
  play(kind: SfxKind, force = false) {
    if (!this.enabled && !force) return;
    // tiny pitch jitter so rapid digit streams don't machine-gun identically
    const j = 1 + (Math.random() - 0.5) * 0.05;
    switch (kind) {
      case 'digit':
        this.tone(830 * j, 0.045, 'triangle', 0.11);
        break;
      case 'dot':
        this.tone(740, 0.05, 'triangle', 0.11);
        break;
      case 'dbl0':
        this.tone(1150, 0.035, 'triangle', 0.1);
        this.tone(1250, 0.045, 'triangle', 0.1, 0.045);
        break;

      // ── operators: one unmistakable contour each ──
      case 'op-plus': // rising fifth  E5 → A5
        this.tone(659, 0.06, 'sine', 0.17);
        this.tone(880, 0.11, 'sine', 0.17, 0.055);
        break;
      case 'op-minus': // falling fifth  A5 → E5
        this.tone(880, 0.06, 'sine', 0.17);
        this.tone(659, 0.11, 'sine', 0.17, 0.055);
        break;
      case 'op-mul': // quick up-arpeggio  C6 · E6 · G6
        [1046, 1318, 1568].forEach((f, i) => this.tone(f, 0.05, 'sine', 0.14, i * 0.045));
        break;
      case 'op-div': // quick down-arpeggio  G6 · E6 · C6
        [1568, 1318, 1046].forEach((f, i) => this.tone(f, 0.05, 'sine', 0.14, i * 0.045));
        break;
      case 'eq': // resolved ding  C5 + G5 + sparkle
        this.tone(523, 0.14, 'sine', 0.18);
        this.tone(784, 0.22, 'sine', 0.16, 0.02);
        this.tone(1046, 0.1, 'sine', 0.09, 0.08);
        break;
      case 'pct': // rising zip
        this.tone(430, 0.1, 'triangle', 0.15, 0, 760);
        break;
      case 'mu': // two-step  B4 → F#5
        this.tone(494, 0.05, 'triangle', 0.14);
        this.tone(740, 0.08, 'triangle', 0.14, 0.05);
        break;
      case 'gt': // low gong
        this.tone(262, 0.26, 'sine', 0.16);
        this.tone(392, 0.18, 'sine', 0.11, 0.015);
        break;

      // ── VAT keys: bell family, each a different gesture ──
      case 'vat-plus': // rising bell
        this.tone(660, 0.16, 'sine', 0.16, 0, 1245);
        this.tone(1320, 0.07, 'sine', 0.07, 0.03);
        break;
      case 'vat-minus': // falling bell
        this.tone(1175, 0.16, 'sine', 0.16, 0, 700);
        this.tone(880, 0.07, 'sine', 0.07, 0.03);
        break;
      case 'vat-amt': // single high bell + overtone
        this.tone(1480, 0.13, 'sine', 0.15);
        this.tone(2220, 0.05, 'sine', 0.06, 0.03);
        break;
      case 'vat-split': // ding-ding
        this.tone(988, 0.07, 'sine', 0.15);
        this.tone(1318, 0.15, 'sine', 0.15, 0.09);
        break;

      // ── helpers ──
      case 'lp':
        this.tone(340, 0.045, 'square', 0.06);
        break;
      case 'rp':
        this.tone(560, 0.055, 'square', 0.06);
        break;
      case 'ans':
        this.tone(988, 0.06, 'sine', 0.12);
        break;
      case 'mem':
        this.tone(740, 0.05, 'triangle', 0.13);
        break;
      case 'del':
        this.tone(262, 0.04, 'triangle', 0.13);
        break;
      case 'clear': // downward sweep
        this.tone(900, 0.16, 'sawtooth', 0.07, 0, 200);
        break;
      case 'ui':
        this.tone(620, 0.035, 'triangle', 0.08);
        break;
      case 'err':
        this.tone(147, 0.16, 'sawtooth', 0.11);
        this.tone(139, 0.18, 'sawtooth', 0.11, 0.1);
        break;
      case 'chime-on':
        this.tone(523, 0.09, 'sine', 0.16);
        this.tone(784, 0.15, 'sine', 0.16, 0.1);
        break;
      case 'chime-off':
        this.tone(784, 0.09, 'sine', 0.16);
        this.tone(523, 0.15, 'sine', 0.16, 0.1);
        break;
    }
  }
}

export const sfx = new Sfx();
