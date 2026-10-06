/** 冒烟脚本入口：用 esbuild 把 scripts/smoke.ts 打到临时文件再跑，验证数据层关键行为。 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const outfile = join(tmpdir(), 'hydropower-smoke.mjs')

await build({
  entryPoints: ['scripts/smoke.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': './src' },
  outfile,
  logLevel: 'silent',
})

await import(pathToFileURL(outfile).href)
