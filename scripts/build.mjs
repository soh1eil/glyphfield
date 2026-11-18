#!/usr/bin/env node
// Minify src/glyphfield.js -> dist/glyphfield.min.js and report the gzip size.
// No bundler: the library is one file. Minification is delegated to `terser`
// (a dev-time tool, found on PATH or fetched by npx; it is NOT a dependency).
//
//   node scripts/build.mjs           build + size budget check (6 KB gzipped)
//   node scripts/build.mjs --demo    also refresh the inlined copy in demo/index.html
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {gzipSync, brotliCompressSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET = 6 * 1024;

function terser(code) {
  const args = ['--module', '--compress', 'passes=2,pure_getters=true', '--mangle', '--comments', 'false'];
  for (const [cmd, pre] of [['terser', []], ['npx', ['--no-install', 'terser']], ['npx', ['--yes', 'terser']]]) {
    try { return execFileSync(cmd, [...pre, ...args], {input: code, maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'pipe']}).toString(); }
    catch (e) { if (e.code !== 'ENOENT' && cmd !== 'npx') throw e; }
  }
  throw new Error('terser not found. Install it (npm i -g terser) and retry.');
}

const src = readFileSync(join(root, 'src/glyphfield.js'), 'utf8');
const min = terser(src).trim() + '\n';
mkdirSync(join(root, 'dist'), {recursive: true});
writeFileSync(join(root, 'dist/glyphfield.min.js'), min);

const gz = gzipSync(min, {level: 9}).length, br = brotliCompressSync(min).length;
console.log(`src   ${src.length} B`);
console.log(`min   ${min.length} B`);
console.log(`gzip  ${gz} B (${(gz / 1024).toFixed(2)} KB)   brotli ${br} B   budget ${BUDGET} B`);
if (gz > BUDGET) { console.error('over budget'); process.exit(1); }

if (process.argv.includes('--demo')) {
  // Inline copy for the single-file demo: `export` removed, the entry point exposed as a global.
  const plain = src.replace(/^export default .*$/m, 'globalThis.glyphfield = glyphfield;').replace(/^export (?=function|const)/gm, '');
  const inline = terser(plain).trim();
  const f = join(root, 'demo/index.html'), html = readFileSync(f, 'utf8');
  const re = /(\/\*glyphfield:start\*\/)[\s\S]*?(\/\*glyphfield:end\*\/)/;
  if (!re.test(html)) throw new Error('demo markers not found');
  writeFileSync(f, html.replace(re, () => `/*glyphfield:start*/${inline}\n/*glyphfield:end*/`));
  console.log('demo  inlined');
}
