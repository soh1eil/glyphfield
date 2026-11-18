# glyphfield

Text as a living particle field. Morph between words, scatter them to dust, and reveal an alternate-script word under the cursor with a "translator lens".

- **~4.8 KB gzipped**, one ES module, **zero dependencies**, no build step needed
- **Persian, Arabic and Hebrew are shaped correctly**: the text is drawn by the browser's own canvas text engine (joining, ligatures, bidi), then sampled
- Hand-written **WebGL** point renderer, with a **2D canvas fallback** and, below that, an accessible label
- Respects `prefers-reduced-motion`, **pauses** when the tab is hidden or the canvas is offscreen, handles **resize and devicePixelRatio**
- Pure parts (sampling math, spring physics, scheduler) are exported and tested with `node --test`

> **GIF placeholder:** record `demo/index.html` (hero, moving the cursor over a word, then scrolling to scatter) and save it as `docs/demo.gif`, then replace this note with `![glyphfield demo](docs/demo.gif)`.

## Install

```sh
npm i glyphfield        # once published
```

Or copy `src/glyphfield.js` (readable) or `dist/glyphfield.min.js` (minified) into your project. No bundler required:

```html
<canvas id="c" style="width:100%;height:60vh"></canvas>
<script type="module">
  import glyphfield from './glyphfield.min.js';
  const f = glyphfield(document.getElementById('c'));
  f.cycle(['Hello', 'سلام', 'مرحبا'], 3800);
</script>
```

The canvas must have a CSS size. glyphfield sets the drawing-buffer size itself.

## API

### `glyphfield(canvas, options?) -> Glyphfield`

| option | default | meaning |
|---|---|---|
| `count` | `9000` (`4500` under 600px wide, `2500` max on the 2D fallback) | number of particles |
| `colors` | `['#7c8cff','#4fe0d0','#ffd479']` | any CSS colours; particles are spread along the gradient between them |
| `font` | `system-ui, sans-serif` | font-family list for Latin text |
| `rtlFont` | `Vazirmatn, "Noto Naskh Arabic", "Segoe UI", Tahoma, sans-serif` | font-family list used when the text contains Arabic-script or Hebrew letters |
| `weight` | `800` | font weight used for sampling |
| `fill` | `[0.8, 0.5]` | the fraction of the canvas width and height a word may occupy |
| `maxDpr` | `2` | cap on `devicePixelRatio` |
| `blend` | `'add'` | `'add'` glows on dark backgrounds; use `'normal'` on light ones |
| `interact` | `true` | pointer repulsion and the lens |
| `spread` | `0.7` | how far `scatter(1)` throws particles, as a fraction of the larger canvas side |
| `lens` | none | `{alt, radius}`, see [the lens](#the-translator-lens) |

### Methods

- **`f.morph(text, {snap?}) -> Promise<void>`** morphs to `text`. It waits for the needed web font (via `document.fonts.load`) before sampling, so the first word is never drawn in a fallback face. `snap: true` jumps instead of flying. Calling it again supersedes a pending call.
- **`f.cycle(words, ms = 3800) -> f`** shows each word in turn. Pass an empty list to stop. The timer is cancelled while the tab is hidden or the canvas is offscreen. Under reduced motion it shows the first word only.
- **`f.scatter(amount) -> f`** where `0` is assembled and `1` is fully dispersed and faded. `f.scatter()` reads the value. Cheap enough to drive from scroll every frame.
- **`f.destroy()`** stops the loop, removes every listener and observer, and releases the WebGL context.
- **`f.renderer`** is `'webgl'`, `'2d'` or `'none'`. **`f.word`** is the current word.

The canvas gets `role="img"` and an `aria-label` that always carries the current word, so screen readers are served even when nothing can be drawn.

### The translator lens

```js
const f = glyphfield(canvas, {
  lens: {
    alt: {Hello: 'سلام', 'سلام': 'Hello'},   // or a function: word => alternate | undefined
    radius: 160                              // px, optional
  }
});
```

Move the pointer across a word and the part under it dissolves into the alternate word. Particles whose alternate position falls inside the disc fly there, those whose own position is inside shrink away, and everything snaps back when the pointer leaves. Words with no alternate fall back to plain repulsion.

## Recipes

**Disperse on scroll**

```js
addEventListener('scroll', () => f.scatter(Math.min(1, scrollY / innerHeight)), {passive: true});
```

**Persian name, with a Latin counterpart under the lens**

```js
const f = glyphfield(canvas, {
  rtlFont: 'Vazirmatn, sans-serif',
  lens: {alt: w => ({'سهیل': 'Soheil', Soheil: 'سهیل'})[w]}
});
f.morph('سهیل');
```

**Light background**

```js
glyphfield(canvas, {blend: 'normal', colors: ['#1d1b4f', '#7a3cff']});
```

**Live input** (re-morph while typing)

```js
input.addEventListener('input', () => f.morph(input.value.trim() || ' '));
```

**Self-hosted fonts.** The sampler can only draw what the browser has loaded. Declare your `@font-face` as usual and pass the family names; `morph` awaits the font load for you. Do not add letter-spacing to Arabic-script text: it breaks letter joining, which is why glyphfield never does.

**Tear down in a SPA**

```js
useEffect(() => { const f = glyphfield(ref.current); f.cycle(words); return () => f.destroy(); }, []);
```

## Behaviour notes

- **Reduced motion:** no flying, no idle shimmer, no loop. Words snap into place and the canvas is redrawn only when something changes. `cycle()` shows only the first word. `scatter()` still fades the field but does not move it. The preference is watched live.
- **Hidden / offscreen:** the animation frame loop and the cycle timer are both cancelled, not merely skipped. Nothing wakes up.
- **Resize / DPR:** a `ResizeObserver` resizes the buffer immediately and re-samples after 100 ms. Rasterised words are cached, so a resize does not re-rasterise.
- **No WebGL:** falls back to a smaller 2D-canvas particle field; with no canvas context at all, the accessible label remains. WebGL context loss and restore are handled.
- **Multiple fields** on one page are independent.

## Performance

Measured shape of the cost, not benchmarks of your machine:

- Per frame: one JS spring loop over `count` particles (typed arrays, no allocation), one `bufferSubData` of `count * 12` bytes, one `drawArrays(POINTS)`. Colours and sizes are static GPU buffers.
- Per morph: one offscreen 1400x420 canvas draw and `getImageData`, sampled every second pixel; cached per word and font. No per-frame GC.
- Defaults (9000 particles, DPR capped at 2) are comfortable on integrated GPUs. Lower `count` first if you need headroom: the dot size adapts, so the word keeps its density feel.
- Several fields on one page multiply the cost: each one pauses itself when offscreen, so only visible ones run.
- The 2D fallback is CPU-bound, hence the 2500 cap.

Bundle: `node scripts/build.mjs` prints the gzip size and fails if it exceeds the 6 KB budget (currently about 4.8 KB gzipped, about 4.4 KB brotli).

## Development

```sh
node --test              # pure parts: sampling, layout, assignment, physics, scheduler
node scripts/build.mjs   # minify to dist/, check the size budget
npm run build            # same, and refresh the copy inlined in demo/index.html
```

The minifier is `terser`, used only as a dev tool (found on `PATH` or via `npx`); it is not a dependency of the package.

`demo/index.html` is a single self-contained page with the library inlined. Its only external requests are optional web fonts; without them it falls back to system fonts.

## Browser support

Any evergreen browser (ES2020, `AbortController`, `ResizeObserver`, `IntersectionObserver`). Older engines without the observers fall back to window resize and always-on animation.

## License

MIT (c) Soheil Tahmasbi
