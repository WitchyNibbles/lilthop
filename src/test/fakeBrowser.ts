// The browser parts jsdom does not have: a canvas context, matchMedia, ResizeObserver, WebAudio.

/** Counts every canvas call by name, so a test can see what was drawn without any pixels. */
export class FakeCanvasContext {
  readonly counts = new Map<string, number>();
  readonly moves: { x: number; y: number }[] = [];
  readonly lines: { x: number; y: number }[] = [];
  readonly gradientStops: string[] = [];
  readonly transforms: number[][] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  globalAlpha = 1;
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  font = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  private count(name: string): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }

  times(name: string): number {
    return this.counts.get(name) ?? 0;
  }

  reset(): void {
    this.counts.clear();
    this.moves.length = 0;
    this.lines.length = 0;
    this.gradientStops.length = 0;
    this.transforms.length = 0;
  }

  setTransform(...values: number[]): void {
    this.transforms.push(values);
  }
  clearRect(): void {
    this.count("clearRect");
  }
  fillRect(): void {
    this.count("fillRect");
  }
  fillText(): void {
    this.count("fillText");
  }
  beginPath(): void {
    this.count("beginPath");
  }
  stroke(): void {
    this.count("stroke");
  }
  fill(): void {
    this.count("fill");
  }
  arc(): void {
    this.count("arc");
  }
  save(): void {
    this.count("save");
  }
  restore(): void {
    this.count("restore");
  }
  translate(): void {
    this.count("translate");
  }
  scale(): void {
    this.count("scale");
  }
  moveTo(x: number, y: number): void {
    this.moves.push({ x, y });
  }
  lineTo(x: number, y: number): void {
    this.lines.push({ x, y });
  }
  createRadialGradient(): { addColorStop: (at: number, c: string) => void } {
    this.count("createRadialGradient");
    return {
      addColorStop: (_at, colour) => {
        this.gradientStops.push(colour);
      },
    };
  }
}

export const canvasContext = new FakeCanvasContext();

export function installCanvas(): void {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => canvasContext,
  });
}

let reducedMotion = false;
const motionListeners = new Set<() => void>();

export function setReducedMotion(value: boolean): void {
  reducedMotion = value;
  for (const listener of motionListeners) listener();
}

export function installMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return query.includes("reduce") && reducedMotion;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => {
        motionListeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        motionListeners.delete(listener);
      },
    }),
  });
}

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(): void {
    this.callback();
  }
  disconnect(): void {
    return;
  }
}

/** jsdom has the element but not its modal methods. */
export function installDialog(): void {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

export function installResizeObserver(): void {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: FakeResizeObserver,
  });
}

interface FakeNode {
  connect: () => void;
}

/** Records the time of every click the metronome schedules. */
export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  closed = false;
  readonly destination = {};
  readonly clicks: number[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createOscillator(): FakeNode & {
    frequency: { value: number };
    start: (at: number) => void;
    stop: () => void;
  } {
    return {
      connect: () => undefined,
      frequency: { value: 0 },
      start: (at) => {
        this.clicks.push(at);
      },
      stop: () => undefined,
    };
  }

  createGain(): FakeNode & {
    gain: {
      setValueAtTime: () => void;
      exponentialRampToValueAtTime: () => void;
    };
  } {
    return {
      connect: () => undefined,
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: () => undefined,
      },
    };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

export function installAudio(): void {
  FakeAudioContext.instances = [];
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: FakeAudioContext,
  });
}
