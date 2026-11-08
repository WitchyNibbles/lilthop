/** Room for the 8 s window at the fastest frame rate the backend produces, with a margin. */
const DEFAULT_CAPACITY = 640;

export type PointVisitor = (tMs: number, hz: number, levelDb: number) => void;

/** Last few seconds of readings in fixed arrays: 46 frames a second allocate nothing. NaN is a gap. */
export class TraceBuffer {
  private readonly times: Float64Array;
  private readonly pitch: Float32Array;
  private readonly level: Float32Array;
  private next = 0;
  private size = 0;
  /** Moves on every change, so a painter can tell whether there is anything new to draw. */
  version = 0;

  constructor(private readonly capacity = DEFAULT_CAPACITY) {
    this.times = new Float64Array(capacity);
    this.pitch = new Float32Array(capacity);
    this.level = new Float32Array(capacity);
  }

  get lastMs(): number | null {
    if (this.size === 0) return null;
    return this.times[(this.next + this.capacity - 1) % this.capacity] ?? null;
  }

  push(tMs: number, hz: number, levelDb: number): void {
    this.times[this.next] = tMs;
    this.pitch[this.next] = hz;
    this.level[this.next] = levelDb;
    this.next = (this.next + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    this.version++;
  }

  clear(): void {
    this.next = 0;
    this.size = 0;
    this.version++;
  }

  /** Oldest first. */
  forEachPoint(visit: PointVisitor): void {
    const start = (this.next + this.capacity - this.size) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      const at = (start + i) % this.capacity;
      visit(
        this.times[at] ?? Number.NaN,
        this.pitch[at] ?? Number.NaN,
        this.level[at] ?? Number.NaN,
      );
    }
  }
}
