/** The fast, local equivalent of the JavaScript CI gate. Never launches services/emulators. */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
const root = fileURLToPath(new URL('../', import.meta.url))
const node = (args, cwd = root) => execFileSync(process.execPath, args, { cwd, stdio: 'inherit' })
node(['scripts/check-shared.mjs', ...process.argv.slice(2)])
const tests = directory => fs.readdirSync(new URL(directory, 'file://' + root)).filter(f => f.endsWith('.test.mjs')).map(f => directory + f)
node(['--test', ...tests('design/test/'), ...tests('contracts/test/')])
node(['--import', 'tsx', '--test', 'test/feature-policy.test.ts', 'test/feature-gating.test.ts'], root + 'server/')
node(['--experimental-strip-types', '--test', 'test/features.test.mjs'], root + 'web/')
node(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], root + 'server/')
node(['node_modules/typescript/bin/tsc', '--noEmit'], root + 'web/')
node(['node_modules/vite/bin/vite.js', 'build'], root + 'web/')
