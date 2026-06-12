import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import type { StemJobStatus } from '@ed/shared';
import { stemDir } from './stem-cache';

export type ProgressFn = (status: StemJobStatus) => void;

/** Locate the python/ project dir in dev (repo) and packaged layouts. */
function pythonProjectDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'python');
  return resolve(__dirname, '../../../../python');
}

let child: ChildProcess | null = null;
let running = false;

export function isSeparating(): boolean {
  return running;
}

export function killSidecar(): void {
  child?.kill('SIGTERM');
  child = null;
  running = false;
}

/**
 * Run Demucs on `inputPath`, writing 4 stems into the cache dir for `hash`.
 * Progress arrives as JSON lines on the wrapper's stdout.
 */
export async function separate(
  inputPath: string,
  hash: string,
  model: string,
  onProgress: ProgressFn,
): Promise<Record<string, string>> {
  if (running) throw new Error('A separation job is already running');
  const outDir = stemDir(hash, model);
  await mkdir(outDir, { recursive: true });

  const projectDir = pythonProjectDir();
  const args = [
    'run',
    '--project',
    projectDir,
    'python',
    join(projectDir, 'separate.py'),
    '--input',
    inputPath,
    '--out',
    outDir,
    '--model',
    model,
  ];

  running = true;
  onProgress({ state: 'running', progress: 0, message: 'Starting Demucs…' });

  return new Promise((resolvePromise, reject) => {
    const finish = (err: Error | null, stems?: Record<string, string>) => {
      running = false;
      child = null;
      if (err) {
        onProgress({ state: 'error', progress: 0, message: err.message });
        reject(err);
      } else {
        onProgress({ state: 'done', progress: 1 });
        resolvePromise(stems!);
      }
    };

    child = spawn('uv', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';
    let buf = '';
    let stems: Record<string, string> | null = null;

    child.on('error', (e) =>
      finish(
        e.message.includes('ENOENT')
          ? new Error('`uv` not found — install it (https://docs.astral.sh/uv) and run scripts/setup-python.sh')
          : e,
      ),
    );
    child.stderr!.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { type: string; value?: number; stems?: Record<string, string>; message?: string };
          if (msg.type === 'progress') {
            onProgress({ state: 'running', progress: msg.value ?? 0, message: 'Separating stems…' });
          } else if (msg.type === 'status') {
            onProgress({ state: 'running', progress: 0, message: msg.message });
          } else if (msg.type === 'done') {
            stems = msg.stems ?? null;
          } else if (msg.type === 'error') {
            finish(new Error(msg.message ?? 'Demucs failed'));
          }
        } catch {
          /* non-JSON noise on stdout — ignore */
        }
      }
    });
    child.on('close', (code) => {
      if (!running) return; // already finished via error message
      if (code === 0 && stems) finish(null, stems);
      else finish(new Error(`Demucs exited with code ${code}. ${stderrTail.split('\n').slice(-4).join(' ')}`));
    });
  });
}
