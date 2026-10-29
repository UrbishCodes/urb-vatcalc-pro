// ─────────────────────────────────────────────────────────────────────────────
// URB1SH-991 active narration — very fast key-press speech
//
// Behaviour (per spec):
//   • while the user types a number, every digit is spoken one-by-one,
//     as fast as possible — no skipping ("four eight nine four nine four…")
//   • if the user out-types the narrator, the digits buffer silently and are
//     spoken as ONE rapid burst the moment the number ends (operator, =,
//     or a short pause) — then the operator word plays in its own utterance
//   • operators speak as words: plus, minus, times, divided by, equals to…
//   • pasted / programmatic input never enters this module → silent
//   • VOICE on/off is announced by a chime only (never spoken words)
// ─────────────────────────────────────────────────────────────────────────────

const DIGIT_RATE = 3.0; // single digit, spoken immediately
const RUN_RATE = 3.1; // catch-up burst of buffered digits
const WORD_RATE = 2.5; // operator / function words
const FLUSH_AFTER_MS = 300; // pause that ends a number run

class Narrator {
  enabled = true;
  private q: { text: string; rate: number }[] = [];
  private run: string[] | null = null; // buffered digit words of current number
  private busy = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const pick = () => {
      const en = speechSynthesis
        .getVoices()
        .filter((v) => (v.lang ?? '').toLowerCase().startsWith('en'));
      this.voice =
        en.find((v) => /google us english/i.test(v.name)) ??
        en.find((v) => (v.lang ?? '').toLowerCase() === 'en-us') ??
        en[0] ??
        null;
    };
    pick();
    speechSynthesis.addEventListener('voiceschanged', pick);
    // watchdog: Chrome occasionally swallows utterance onend — recover
    window.setInterval(() => {
      if (this.busy && !speechSynthesis.speaking && !speechSynthesis.pending) {
        this.busy = false;
        this.pump();
      } else if (!this.busy && this.q.length > 0) {
        this.pump();
      }
    }, 240);
  }

  setEnabled(v: boolean) {
    this.enabled = v;
    if (!v) {
      try {
        speechSynthesis.cancel();
      } catch {
        /* speech unavailable */
      }
      this.q = [];
      this.run = null;
      this.busy = false;
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
    }
  }

  /** one digit of the number being typed */
  digit(word: string) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    // narrator idle → speak this digit right away
    if (!this.busy && this.q.length === 0 && this.run === null) {
      this.say(word, DIGIT_RATE);
      return;
    }
    // narrator busy → buffer; a burst catches up when the number ends
    if (this.run === null) this.run = [];
    this.run.push(word);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushRun(), FLUSH_AFTER_MS);
  }

  /** operator / function word — digits flush first, then the word separately */
  word(text: string) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    this.flushRun();
    this.q.push({ text, rate: WORD_RATE });
    this.pump();
  }

  /** end the current digit run so the burst plays before whatever comes next */
  private flushRun() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.run && this.run.length > 0) {
      this.q.push({ text: this.run.join(' '), rate: RUN_RATE });
      this.run = null;
    }
    this.pump();
  }

  /**
   * Long-form speech for explicit "hear it aloud" buttons (Sales view).
   * Bypasses the enabled gate — the user asked for it with a click — and
   * replaces any queued key narration.
   */
  forceSpeak(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      speechSynthesis.cancel();
    } catch {
      /* speech unavailable */
    }
    this.q = [];
    this.run = null;
    this.busy = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.12;
    u.pitch = 1;
    u.volume = 1;
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    } else {
      u.lang = 'en-US';
    }
    speechSynthesis.speak(u);
  }

  private say(text: string, rate: number) {
    if (!('speechSynthesis' in window)) return;
    this.busy = true;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = 1;
    u.volume = 1;
    if (this.voice) {
      u.voice = this.voice;
      u.lang = this.voice.lang;
    } else {
      u.lang = 'en-US';
    }
    const done = () => {
      this.busy = false;
      this.pump();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  }

  private pump() {
    if (this.busy || this.q.length === 0) return;
    const item = this.q.shift();
    if (item) this.say(item.text, item.rate);
  }
}

export const narrator = new Narrator();

/** digit → spoken word */
export const DIGIT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
] as const;
