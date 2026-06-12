import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';

export interface StemMeta {
  sourceName: string;
  model: string;
  durationSec?: number;
  bpm?: number;
  firstBeatOffset?: number;
}

export const STEM_NAMES = ['drums', 'bass', 'vocals', 'other'] as const;

export function cacheRoot(): string {
  return join(app.getPath('userData'), 'stems');
}

export async function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

export function stemDir(hash: string, model: string): string {
  return join(cacheRoot(), hash, model);
}

/** Returns absolute stem wav paths if all four exist, else null. */
export async function lookupStems(
  hash: string,
  model: string,
): Promise<{ stems: Record<string, string>; meta: StemMeta | null } | null> {
  const dir = stemDir(hash, model);
  const stems: Record<string, string> = {};
  try {
    for (const name of STEM_NAMES) {
      const p = join(dir, `${name}.wav`);
      await stat(p);
      stems[name] = p;
    }
  } catch {
    return null;
  }
  let meta: StemMeta | null = null;
  try {
    meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as StemMeta;
  } catch {
    /* meta is optional */
  }
  return { stems, meta };
}

export async function writeMeta(hash: string, model: string, meta: StemMeta): Promise<void> {
  const dir = stemDir(hash, model);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
}

export async function readMeta(hash: string, model: string): Promise<StemMeta | null> {
  try {
    return JSON.parse(await readFile(join(stemDir(hash, model), 'meta.json'), 'utf8')) as StemMeta;
  } catch {
    return null;
  }
}

const MAX_CACHE_BYTES = 4 * 1024 ** 3;

/** LRU-evict oldest track dirs above the cache budget. */
export async function evictIfNeeded(): Promise<void> {
  const root = cacheRoot();
  let entries: { dir: string; mtime: number; size: number }[] = [];
  try {
    for (const name of await readdir(root)) {
      const dir = join(root, name);
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
      let size = 0;
      for (const model of await readdir(dir)) {
        const mdir = join(dir, model);
        try {
          for (const f of await readdir(mdir)) size += (await stat(join(mdir, f))).size;
        } catch {
          /* skip */
        }
      }
      entries.push({ dir, mtime: s.mtimeMs, size });
    }
  } catch {
    return;
  }
  let total = entries.reduce((a, e) => a + e.size, 0);
  entries = entries.sort((a, b) => a.mtime - b.mtime);
  for (const e of entries) {
    if (total <= MAX_CACHE_BYTES) break;
    await rm(e.dir, { recursive: true, force: true });
    total -= e.size;
  }
}
