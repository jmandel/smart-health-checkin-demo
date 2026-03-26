/**
 * Build script for smart-health-checkin library and demo apps
 * Run with: bun run build.ts
 *
 * Outputs:
 *   dist/                    - Library builds (ES module, IIFE, types)
 *   build/smart-health-checkin-demo/  - Static demo site for GitHub Pages
 */

import { mkdirSync, existsSync, cpSync, rmSync } from 'fs';
import { join } from 'path';

const ROOT = import.meta.dir;
const DIST = join(ROOT, 'dist');
const SRC = join(ROOT, 'src', 'smart-health-checkin.ts');
const BUILD_DIR = join(ROOT, 'build', 'smart-health-checkin-demo');

// Ensure dist directory exists
if (!existsSync(DIST)) {
  mkdirSync(DIST, { recursive: true });
}

console.log('Building smart-health-checkin library...');

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

// Build demo apps for static deployment
// These are React apps in demo/ that get built and output to build/smart-health-checkin-demo/
const DEMO_DIR = join(ROOT, 'demo');
const DEMO_APPS = [
  { dir: 'portal', out: 'portal' },
  { dir: 'kiosk', out: 'kiosk' },
  { dir: 'source-flexpa', out: 'source-flexpa' },
  { dir: 'checkin', out: 'checkin' },
];

console.log('\nBuilding demo apps for static deployment...');

// Clean and create build directory
if (existsSync(BUILD_DIR)) {
  rmSync(BUILD_DIR, { recursive: true });
}
mkdirSync(BUILD_DIR, { recursive: true });

for (const app of DEMO_APPS) {
  const htmlPath = join(DEMO_DIR, app.dir, 'index.html');
  if (!existsSync(htmlPath)) {
    console.log(`  ⚠ Skipping ${app.dir} (index.html not found)`);
    continue;
  }

  const outdir = join(BUILD_DIR, app.out);
  mkdirSync(outdir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [htmlPath],
    outdir,
    target: 'browser',
    minify: true,
  });

  if (result.success) {
    console.log(`  ✓ ${app.out}/`);
  } else {
    console.error(`  ✗ ${app.dir} build failed:`, result.logs);
  }
}

// Copy landing page
if (existsSync(join(DEMO_DIR, 'index.html'))) {
  cpSync(join(DEMO_DIR, 'index.html'), join(BUILD_DIR, 'index.html'));
  console.log('  ✓ index.html (landing page)');
}

// - Library dist files (for CDN-style access)
cpSync(DIST, join(BUILD_DIR, 'dist'), { recursive: true });
console.log('  ✓ dist/ (library files)');

console.log('\nBuild complete!');
console.log(`\nStatic site ready at: build/smart-health-checkin-demo/`);
console.log('Run ./start-static.sh to test locally');
