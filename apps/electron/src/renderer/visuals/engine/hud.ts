/** Perf HUD: frame-time sparkline + counters. Toggle with `D`. */
export class Hud {
  private el: HTMLDivElement;
  private text: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private samples = new Float32Array(120);
  private idx = 0;
  private acc = 0;
  visible = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;top:8px;left:8px;z-index:10;background:rgba(0,0,0,.65);color:#9fe8a9;' +
      'font:11px/1.5 ui-monospace,monospace;padding:8px 10px;border-radius:6px;display:none;pointer-events:none;';
    this.text = document.createElement('div');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 240;
    this.canvas.height = 36;
    this.canvas.style.cssText = 'display:block;margin-top:4px;';
    this.el.append(this.text, this.canvas);
    document.body.appendChild(this.el);
    this.g = this.canvas.getContext('2d')!;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  push(frameMs: number, fps: number, info: { calls: number; quality: number; mode: string }): void {
    this.samples[this.idx] = frameMs;
    this.idx = (this.idx + 1) % this.samples.length;
    this.acc += frameMs;
    if (this.acc < 250 || !this.visible) return; // redraw at 4Hz
    this.acc = 0;

    this.text.textContent = `${fps.toFixed(0)} fps  ${frameMs.toFixed(1)} ms  draws:${info.calls}  q${info.quality}  ${info.mode}`;
    const g = this.g;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.08)';
    g.fillRect(0, 0, w, h);
    // 16.7ms line
    const yBudget = h - (16.7 / 33.3) * h;
    g.strokeStyle = 'rgba(255,255,0,.4)';
    g.beginPath();
    g.moveTo(0, yBudget);
    g.lineTo(w, yBudget);
    g.stroke();
    g.fillStyle = '#9fe8a9';
    const n = this.samples.length;
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const v = this.samples[(this.idx + i) % n];
      const bh = Math.min(h, (v / 33.3) * h);
      g.fillStyle = v > 16.9 ? '#ff7a7a' : '#9fe8a9';
      g.fillRect(i * bw, h - bh, bw, bh);
    }
  }
}
