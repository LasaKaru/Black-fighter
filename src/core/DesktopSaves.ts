/**
 * Desktop save files for Steam Cloud. In the browser saves live only in
 * localStorage; in the Electron build every save is also written to
 * <userData>/saves/<key>.json, which Steam Auto-Cloud syncs between PCs.
 * On start the newer of the two copies wins (by its savedAt stamp).
 */

const bridge = () => (typeof window !== 'undefined' ? window.blackeyeDesktop : undefined);

function stamp(raw: string | null): number {
  if (!raw) return -1;
  try {
    const o = JSON.parse(raw) as { savedAt?: number };
    return typeof o.savedAt === 'number' ? o.savedAt : 0;
  } catch {
    return -1;
  }
}

/** Call once at boot, before anything reads localStorage. */
export function restoreDesktopSaves() {
  const d = bridge();
  if (!d?.loadSaves) return;
  let files: Record<string, string> = {};
  try {
    files = d.loadSaves() ?? {};
  } catch {
    return;
  }
  for (const [key, raw] of Object.entries(files)) {
    try {
      const local = localStorage.getItem(key);
      // a cloud copy that is newer (or the only copy) replaces the local one
      if (stamp(raw) > stamp(local)) localStorage.setItem(key, raw);
    } catch {
      /* storage full or blocked */
    }
  }
}

/** Mirror one save to disk (no-op in the browser). */
export function mirrorSave(key: string, raw: string) {
  try {
    bridge()?.writeSave?.(key, raw);
  } catch {
    /* ignore */
  }
}
