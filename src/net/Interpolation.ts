/**
 * Snapshot interpolation buffer (README §17.4). Remote entities are rendered
 * slightly in the past (INTERP_DELAY_MS) and blended between the two
 * snapshots that bracket the render time.
 */
export interface Snapshot<T> {
  t: number;
  s: T;
}

export class SnapshotBuffer<T> {
  private buf: Snapshot<T>[] = [];
  constructor(private max = 30) {}

  push(t: number, s: T) {
    // keep ordered; drop out-of-order duplicates
    if (this.buf.length && t <= this.buf[this.buf.length - 1].t) return;
    this.buf.push({ t, s });
    if (this.buf.length > this.max) this.buf.shift();
  }

  get latest(): Snapshot<T> | undefined {
    return this.buf[this.buf.length - 1];
  }

  get size() {
    return this.buf.length;
  }

  /**
   * Returns the two snapshots around `renderTime` and the blend factor.
   * Clamps to the newest snapshot (with a bounded extrapolation factor).
   */
  sample(renderTime: number): { a: T; b: T; k: number } | null {
    const n = this.buf.length;
    if (n === 0) return null;
    if (n === 1 || renderTime <= this.buf[0].t) return { a: this.buf[0].s, b: this.buf[0].s, k: 0 };
    for (let i = n - 1; i > 0; i--) {
      const b = this.buf[i];
      const a = this.buf[i - 1];
      if (renderTime >= a.t && renderTime <= b.t) {
        const k = (renderTime - a.t) / Math.max(1, b.t - a.t);
        return { a: a.s, b: b.s, k };
      }
    }
    // render time is newer than everything we have: extrapolate a little
    const a = this.buf[n - 2];
    const b = this.buf[n - 1];
    const k = Math.min(1.5, (renderTime - a.t) / Math.max(1, b.t - a.t));
    return { a: a.s, b: b.s, k };
  }
}

export function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
