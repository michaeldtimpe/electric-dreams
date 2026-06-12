import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import { Scene } from '@ed/shared';

function presetDir(): string {
  return join(app.getPath('userData'), 'presets');
}

export interface PresetInfo {
  id: string;
  name: string;
}

export async function listPresets(): Promise<PresetInfo[]> {
  try {
    const files = await readdir(presetDir());
    const out: PresetInfo[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(await readFile(join(presetDir(), f), 'utf8'));
        out.push({ id: f.replace(/\.json$/, ''), name: raw.name ?? f });
      } catch {
        /* skip corrupt */
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function savePreset(name: string, scene: Scene): Promise<PresetInfo> {
  await mkdir(presetDir(), { recursive: true });
  const id = `p-${randomUUID().slice(0, 8)}`;
  const data = { ...scene, id, name };
  await writeFile(join(presetDir(), `${id}.json`), JSON.stringify(data, null, 2));
  return { id, name };
}

export async function loadPreset(id: string): Promise<Scene | null> {
  try {
    const raw = JSON.parse(await readFile(join(presetDir(), `${id}.json`), 'utf8'));
    return Scene.parse(raw);
  } catch {
    return null;
  }
}

export async function deletePreset(id: string): Promise<void> {
  await rm(join(presetDir(), `${id}.json`), { force: true });
}
