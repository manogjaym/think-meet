/** PR-only gate input, with immutable old-client baselines protected against accidental editing. */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
if (!event.pull_request) throw new Error('This script requires a pull_request event')
const base = event.pull_request.base.sha, head = event.pull_request.head.sha
if (![base, head].every(s => /^[a-f0-9]{40,64}$/.test(s))) throw new Error('Invalid commit identifier')
const names = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMRD', base + '...' + head], { encoding: 'utf8' })
for (const file of names.split('\n').filter(f => /^contracts\/compatibility\/v\d+\.json$/.test(f))) {
  const present = execFileSync('git', ['ls-tree', '--name-only', base, '--', file], { encoding: 'utf8' }).trim()
  if (present) throw new Error(`Old-client compatibility baseline is immutable: ${file}. Use a new versioned endpoint/contract.`)
}
fs.writeFileSync('changed-files.txt', names)
