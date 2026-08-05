import { build } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const external = ['gi://*', 'resource://*', 'system', 'cairo', 'gettext']
const common = {
  bundle: true,
  format: 'esm',
  target: 'firefox115',
  platform: 'neutral',
  minify: false,
  sourcemap: true,
  external,
}

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

await build({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' })
if (existsSync('src/prefs.ts')) {
  await build({ ...common, entryPoints: ['src/prefs.ts'], outfile: 'dist/prefs.js' })
}

for (const f of ['metadata.json', 'stylesheet.css']) await cp(f, `dist/${f}`)
await cp('schemas', 'dist/schemas', { recursive: true })
// The session row's agent chip loads these by absolute path at
// <extension.path>/icons/<agent>.svg. A missing file is invisible at runtime —
// the chip just drops its mark — so test/shell/iconAssets.test.ts guards this
// line.
await cp('src/icons', 'dist/icons', { recursive: true })
if (existsSync('hooks')) {
  await cp('hooks', 'dist/hooks', { recursive: true })
}

// ---- landing page (dist-site/, deployed to GitHub Pages; see site/) ----
await rm('dist-site', { recursive: true, force: true })
await mkdir('dist-site', { recursive: true })
await build({
  ...common,
  platform: 'browser',
  external: [],
  minify: true,
  sourcemap: false,
  entryPoints: ['site/demo.ts'],
  outfile: 'dist-site/demo.js',
})
await cp('site/index.html', 'dist-site/index.html')
await cp('site/site.css', 'dist-site/site.css')
await cp('src/icons', 'dist-site/icons', { recursive: true })

console.log('built dist/')
