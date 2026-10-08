/**
 * Chat and name moderation for multiplayer, managed from the owner panel:
 *
 * - a blocked-words list (whole words, any case, common letter swaps like
 *   0→o, 1→i, 3→e, 4→a, 5→s, @→a, $→s) replaced by ★ in chat and names;
 * - mutes by network address (10 minutes … permanent); a muted player's
 *   messages are dropped and they are told why;
 * - a spam limit: more than 5 messages in 6 seconds are dropped;
 * - the last 300 chat messages kept in memory for the panel (not on disk).
 *
 * Words and mutes persist in DATA_DIR/moderation.json.
 */
import { join } from 'node:path';
import { readJson, writeJson } from './fsutil';

export interface ChatLine {
  t: number;
  room: string;
  id: number;
  name: string;
  ip: string;
  text: string;
  /** Blocked words were replaced, or the line was dropped (muted / spam). */
  flag: '' | 'filtered' | 'muted' | 'spam';
}

/** A short default list; the owner edits it in the panel. */
const DEFAULT_WORDS = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'kys'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

export class Moderation {
  words: string[] = [...DEFAULT_WORDS];
  /** ip → muted until (ms; Infinity = permanent). */
  muted = new Map<string, { until: number; name: string }>();
  log: ChatLine[] = [];
  private recent = new Map<number, number[]>();
  private file: string;
  private re: RegExp | null = null;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'moderation.json');
    this.compile();
  }

  async load() {
    try {
      const o = await readJson<{ words?: string[]; muted?: Array<[string, { until: number | null; name: string }]> }>(this.file);
      if (Array.isArray(o.words)) this.words = o.words.filter((w) => typeof w === 'string');
      for (const [ip, m] of o.muted ?? []) this.muted.set(ip, { until: m.until ?? Infinity, name: m.name });
      this.compile();
    } catch {
      /* defaults */
    }
  }

  private save() {
    const muted = [...this.muted].map(([ip, m]) => [ip, { until: Number.isFinite(m.until) ? m.until : null, name: m.name }]);
    void writeJson(this.file, { words: this.words, muted }).catch((e) => console.error('[moderation] save failed', e));
  }

  private compile() {
    const esc = this.words.map((w) => w.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
    // whole words plus common endings (fucking, shits, …) without catching longer innocent words
    this.re = esc.length ? new RegExp(`(^|[^a-z])((?:${esc.join('|')})(?:s|es|ed|er|ers|ing|in|y|ty|head|face)?)(?=$|[^a-z])`, 'gi') : null;
  }

  setWords(list: string[]) {
    this.words = [...new Set(list.map((w) => w.trim().toLowerCase().slice(0, 40)).filter((w) => w.length >= 2))].slice(0, 500);
    this.compile();
    this.save();
  }

  /** Replace blocked words (checked on a letter-swap-normalised copy) with stars. */
  filter(text: string): { text: string; hit: boolean } {
    if (!this.re) return { text, hit: false };
    // same length as the text (UTF-16 units), so match positions line up
    const chars = text.split('');
    const norm = chars
      .map((ch) => {
        const l = ch.toLowerCase();
        return l.length === 1 ? (LEET[l] ?? l) : ch;
      })
      .join('');
    let hit = false;
    this.re.lastIndex = 0;
    for (const m of norm.matchAll(this.re)) {
      hit = true;
      const start = (m.index ?? 0) + m[1].length;
      for (let i = start; i < start + m[2].length && i < chars.length; i++) chars[i] = '★';
    }
    return { text: hit ? chars.join('') : text, hit };
  }

  /** A clean player name ('' when nothing is left). */
  cleanName(name: string): string {
    const f = this.filter(name);
    return f.hit ? f.text.replace(/★+/g, '').trim() : name;
  }

  isMuted(ip: string, now = Date.now()): boolean {
    const m = this.muted.get(ip);
    if (!m) return false;
    if (m.until <= now) {
      this.muted.delete(ip);
      this.save();
      return false;
    }
    return true;
  }

  mute(ip: string, name: string, minutes: number) {
    this.muted.set(ip, { until: minutes > 0 ? Date.now() + minutes * 60_000 : Infinity, name });
    this.save();
  }

  unmute(ip: string): boolean {
    const ok = this.muted.delete(ip);
    if (ok) this.save();
    return ok;
  }

  /**
   * Check one chat line. Returns the text to send, or null when it is dropped
   * (with the reason for the sender).
   */
  chat(c: { id: number; name: string; ip: string; room: string }, raw: string, now = Date.now()): { text: string } | { drop: string } {
    const push = (text: string, flag: ChatLine['flag']) => {
      this.log.push({ t: now, room: c.room, id: c.id, name: c.name, ip: c.ip, text, flag });
      if (this.log.length > 300) this.log.shift();
    };
    if (this.isMuted(c.ip, now)) {
      push(raw, 'muted');
      const m = this.muted.get(c.ip)!;
      return { drop: Number.isFinite(m.until) ? `You are muted for ${Math.ceil((m.until - now) / 60_000)} more minute(s).` : 'You are muted on this server.' };
    }
    const times = (this.recent.get(c.id) ?? []).filter((t) => now - t < 6000);
    times.push(now);
    this.recent.set(c.id, times);
    if (times.length > 5) {
      push(raw, 'spam');
      return { drop: 'Slow down: too many messages.' };
    }
    const f = this.filter(raw);
    push(f.text, f.hit ? 'filtered' : '');
    return { text: f.text };
  }

  forget(id: number) {
    this.recent.delete(id);
  }

  summary(now = Date.now()) {
    return {
      words: this.words,
      muted: [...this.muted]
        .filter(([, m]) => m.until > now)
        .map(([ip, m]) => ({ ip, name: m.name, until: Number.isFinite(m.until) ? m.until : 0 })),
      log: this.log.slice(-200).reverse(),
    };
  }
}
