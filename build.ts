/**
 * Build script for smart-health-checkin library
 * Run with: bun run build.ts
 */

import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = import.meta.dir;
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src', 'smart-health-checkin.ts');

// Ensure dist directory exists
if (!existsSync(DIST)) {
  mkdirSync(DIST, { recursive: true });
}

console.log('Building smart-health-checkin...');

// Build ES module
const esmResult = await Bun.build({
  entrypoints: [SRC],
  outdir: DIST,
  naming: 'smart-health-checkin.js',
  format: 'esm',
  target: 'browser',
  minify: false,
});

if (!esmResult.success) {
  console.error('ESM build failed:', esmResult.logs);
  process.exit(1);
}
console.log('  ✓ ES module: dist/smart-health-checkin.js');

// Build IIFE for <script> tag usage
const iifeResult = await Bun.build({
  entrypoints: [SRC],
  outdir: DIST,
  naming: 'smart-health-checkin.iife.js',
  format: 'iife',
  target: 'browser',
  minify: false,
});

if (!iifeResult.success) {
  console.error('IIFE build failed:', iifeResult.logs);
  process.exit(1);
}
console.log('  ✓ IIFE bundle: dist/smart-health-checkin.iife.js');

// Build minified IIFE
const iifeMinResult = await Bun.build({
  entrypoints: [SRC],
  outdir: DIST,
  naming: 'smart-health-checkin.iife.min.js',
  format: 'iife',
  target: 'browser',
  minify: true,
});

if (!iifeMinResult.success) {
  console.error('Minified IIFE build failed:', iifeMinResult.logs);
  process.exit(1);
}
console.log('  ✓ IIFE minified: dist/smart-health-checkin.iife.min.js');

// Generate TypeScript declarations using tsc
const tscResult = Bun.spawnSync(['bunx', 'tsc', '-p', 'tsconfig.json', '--emitDeclarationOnly'], {
  cwd: ROOT,
  stdout: 'inherit',
  stderr: 'inherit',
});

if (tscResult.exitCode === 0) {
  console.log('  ✓ Type declarations: dist/smart-health-checkin.d.ts');
} else {
  console.warn('  ⚠ Type declarations failed (tsc not available or error)');
}

// Copy IIFE to target directories for demo apps
const TARGET_DIRS = ['requester', 'checkin', 'source-flexpa'];
const IIFE_SRC = join(DIST, 'smart-health-checkin.iife.js');

console.log('\nCopying to demo directories...');
for (const dir of TARGET_DIRS) {
  const targetDir = join(ROOT, dir);
  if (existsSync(targetDir)) {
    const targetFile = join(targetDir, 'shl.js');
    copyFileSync(IIFE_SRC, targetFile);
    console.log(`  ✓ ${dir}/shl.js`);
  }
}

// Copy config.js to target directories
const CONFIG_SRC = join(ROOT, 'config.js');
if (existsSync(CONFIG_SRC)) {
  console.log('\nCopying config.js...');
  for (const dir of TARGET_DIRS) {
    const targetDir = join(ROOT, dir);
    if (existsSync(targetDir)) {
      const targetFile = join(targetDir, 'config.js');
      copyFileSync(CONFIG_SRC, targetFile);
      console.log(`  ✓ ${dir}/config.js`);
    }
  }
}

console.log('\nBuild complete!');
