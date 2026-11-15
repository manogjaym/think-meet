import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
for (const script of ['design/scripts/generate.mjs', 'contracts/scripts/generate.mjs']) execFileSync(process.execPath, [script], { cwd: root, stdio: 'inherit' })
