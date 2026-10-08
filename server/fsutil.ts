/**
 * Crash-safe file writes: write to a temp file, then rename over the old one
 * (atomic on the same disk), keeping the previous version as `.bak`. A crash
 * or power cut mid-write can never leave a half-written JSON file, and
 * readJson() falls back to the backup if the main file is unreadable.
 */
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeAtomic(path: string, data: string | Buffer, backup = true): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  if (backup) await copyFile(path, path + '.bak').catch(() => {});
  await rename(tmp, path);
}

export async function writeJson(path: string, value: unknown, pretty = false): Promise<void> {
  await writeAtomic(path, JSON.stringify(value, null, pretty ? 1 : undefined));
}

/** Read JSON, falling back to the `.bak` copy; throws when neither is readable. */
export async function readJson<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (e) {
    try {
      const v = JSON.parse(await readFile(path + '.bak', 'utf8')) as T;
      console.warn(`[data] ${path} unreadable, restored from backup`);
      return v;
    } catch {
      throw e;
    }
  }
}
