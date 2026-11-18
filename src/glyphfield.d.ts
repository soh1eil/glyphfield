export interface GlyphfieldOptions {
  /** Particle count. Default 9000 (4500 below 600px wide; 2D fallback caps at 2500). */
  count?: number;
  /** Any CSS colours. Particles are spread along the gradient between them. */
  colors?: string[];
  /** Font family list for Latin text. */
  font?: string;
  /** Font family list for text containing Arabic-script or Hebrew letters. */
  rtlFont?: string;
  /** Font weight used for sampling. Default 800. */
  weight?: number | string;
  /** Fraction of the canvas [width, height] the word may occupy. Default [0.8, 0.5]. */
  fill?: [number, number];
  /** Cap on devicePixelRatio. Default 2. */
  maxDpr?: number;
  /** 'add' glows on dark backgrounds, 'normal' for light ones. */
  blend?: 'add' | 'normal';
  /** Pointer repulsion and lens. Default true. */
  interact?: boolean;
  /** How far scatter(1) throws particles, as a fraction of the larger side. Default 0.7. */
  spread?: number;
  /** Translator lens: the alternate word revealed under the pointer. */
  lens?: {alt: Record<string, string> | ((word: string) => string | undefined); radius?: number};
}

export interface Glyphfield {
  morph(text: string, opts?: {snap?: boolean}): Promise<void>;
  cycle(words: string[], ms?: number): Glyphfield;
  scatter(): number;
  scatter(amount: number): Glyphfield;
  readonly renderer: 'webgl' | '2d' | 'none';
  readonly word: string;
  destroy(): void;
}

export function glyphfield(canvas: HTMLCanvasElement, options?: GlyphfieldOptions): Glyphfield;
export default glyphfield;

export function smoothstep(e0: number, e1: number, x: number): number;
export function hasRTL(s: string): boolean;
export function isRTL(s: string): boolean;
export function samplePoints(rgba: ArrayLike<number>, W: number, H: number, step?: number, thr?: number): {pts: Float32Array; box: number[]; m: number};
export function layoutScale(box: number[], view: {w: number; h: number}, fill?: [number, number]): number;
export function toWorld(pts: Float32Array, box: number[], s: number, oy?: number): Float32Array;
export function assign(M: number, N: number, rand?: () => number): Uint32Array;
export function step(state: object, dt: number, opts: object): void;
export function createCycle(words: string[], ms: number, apply: (word: string, i: number) => void, timers?: {setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout}): {start(): void; stop(): void; pause(v: boolean): void; readonly index: number; readonly running: boolean};
