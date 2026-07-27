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
if (existsSync('hooks')) {
  await cp('hooks', 'dist/hooks', { recursive: true })
}
console.log('built dist/')
