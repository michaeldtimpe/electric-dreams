/**
 * Adaptive degradation: rolling mean frame time > 15ms steps quality down
 * (styles reduce sim res / particle counts); 5s of headroom steps back up.
 */
export class Governor {
  quality: 0 | 1 | 2 = 0;
  private ring = new Float32Array(60);
  private idx = 0;
  private filled = 0;
  private calmSince = 0;
  private lastChange = 0;

  /** Returns the new quality if it changed, else null. */
  push(frameMs: number, now: number): 0 | 1 | 2 | null {
    this.ring[this.idx] = frameMs;
    this.idx = (this.idx + 1) % this.ring.length;
    if (this.filled < this.ring.length) {
      this.filled++;
      return null;
    }
    let sum = 0;
    for (let i = 0; i < this.ring.length; i++) sum += this.ring[i];
    const mean = sum / this.ring.length;

    if (now - this.lastChange < 2) return null; // settle time after any change

    if (mean > 15 && this.quality < 2) {
      this.quality = (this.quality + 1) as 0 | 1 | 2;
      this.lastChange = now;
      this.calmSince = now;
      return this.quality;
    }
    if (mean < 12) {
      if (this.calmSince === 0) this.calmSince = now;
      if (now - this.calmSince > 5 && this.quality > 0) {
        this.quality = (this.quality - 1) as 0 | 1 | 2;
        this.lastChange = now;
        this.calmSince = now;
        return this.quality;
      }
    } else {
      this.calmSince = 0;
    }
    return null;
  }
}
