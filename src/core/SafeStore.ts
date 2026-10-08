/**
 * Save files that survive damage. A save that cannot be read is never
 * replaced by a fresh one: the game loads the backup copy instead (kept
 * every few minutes), and the damaged text is set aside for support. When
 * the browser's storage is full, old caches are cleared and the save is
 * retried; if it still fails the player is told (and the desktop build
 * still writes its save file).
 */
import { crashGuard } from './CrashGuard';

const BACKUP_EVERY = 5 * 60_000;
const lastBackup = new Map<string, number>();
let problem: ((text: string) => void) | null = null;
let warned = false;

/** Show storage problems to the player (toast). */
export function onStorageProblem(fn: (text: string) => void) {
  problem = fn;
}

function tryParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as T;
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** Read a JSON save, falling back to its backup. null = no save yet. */
export function readSave<T>(key: string): T | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  const v = tryParse<T>(raw);
  if (v || !raw) return v;
  // damaged: keep it for support, load the backup
  crashGuard.report('storage', `Save "${key}" was damaged`);
  try {
    localStorage.setItem(key + '.corrupt', raw.slice(0, 200_000));
  } catch {
    /* no room */
  }
  const bak = tryParse<T>(localStorage.getItem(key + '.bak'));
  setTimeout(() => problem?.(bak ? 'Your save was damaged and has been restored from a backup.' : 'Your save could not be read. Settings → Gameplay → Save slots has your other slots and cloud saves.'), 4000);
  return bak;
}

/** Make room: caches first; ghost replays (re-recordable) only if that is not enough. */
function freeSpace(stage: number) {
  for (const k of Object.keys(localStorage)) {
    if (k.endsWith('.corrupt') || k === 'blackeye.analytics.queue' || k === 'blackeye.crashq') localStorage.removeItem(k);
    else if (stage > 1 && k.startsWith('blackeye.ghost')) localStorage.removeItem(k);
  }
}

/** Write a JSON save (keeps a backup copy every few minutes). Returns false when it could not be stored. */
export function writeSave(key: string, raw: string): boolean {
  try {
    const now = Date.now();
    if (now - (lastBackup.get(key) ?? 0) > BACKUP_EVERY) {
      const cur = localStorage.getItem(key);
      if (cur && tryParse(cur)) localStorage.setItem(key + '.bak', cur);
      lastBackup.set(key, now);
    }
    localStorage.setItem(key, raw);
    return true;
  } catch {
    try {
      for (const stage of [1, 2]) {
        freeSpace(stage);
        try {
          localStorage.setItem(key, raw);
          return true;
        } catch {
          /* still full */
        }
      }
      throw new Error('storage full');
    } catch (e) {
      if (!warned) {
        warned = true;
        crashGuard.report('storage', e);
        problem?.('Storage is full: progress could not be saved in the browser. Free some space or use a cloud save.');
      }
      return false;
    }
  }
}
