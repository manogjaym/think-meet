/** The fast, local equivalent of the JavaScript CI gate. Never launches services/emulators. */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
const root = fileURLToPath(new URL('../', import.meta.url))
const node = (args, cwd = root) => execFileSync(process.execPath, args, { cwd, stdio: 'inherit' })
node(['scripts/check-shared.mjs', ...process.argv.slice(2)])
// Every test file in a folder runs, so a new test cannot be left out of the gate by accident.
const tests = (directory, suffix = '.test.mjs') => fs.readdirSync(new URL(directory, 'file://' + root)).filter(f => f.endsWith(suffix)).map(f => directory + f).sort()
node(['--test', ...tests('design/test/'), ...tests('contracts/test/')])
// Server unit tests use in-memory fakes only; *.integration.mjs needs real services and stays separate.
node(['--import', 'tsx', '--test', ...tests('server/test/', '.test.ts').map(f => f.slice('server/'.length))], root + 'server/')
node(['--experimental-strip-types', '--test', ...tests('web/test/').map(f => f.slice('web/'.length))], root + 'web/')
node(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], root + 'server/')
node(['node_modules/typescript/bin/tsc', '--noEmit'], root + 'web/')
node(['node_modules/vite/bin/vite.js', 'build'], root + 'web/')
