import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
if (args.length && (args[0] !== '--changed-files' || args.length !== 2)) throw new Error('Usage: node scripts/check-shared.mjs [--changed-files path-to-newline-list]')
for (const [script, extra] of [['design/scripts/generate.mjs', ['--check']], ['contracts/scripts/generate.mjs', ['--check']], ['contracts/scripts/check.mjs', []], ['features/check.mjs', args]]) {
  execFileSync(process.execPath, [script, ...extra], { cwd: root, stdio: 'inherit' })
}
