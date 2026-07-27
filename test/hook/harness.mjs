// Runs inside `dbus-run-session`, so the stub service below owns
// org.dasbo.Island on a private bus and never touches the user's real one.
//
// Starts the stub, then runs hooks/dasbo-hook the way an agent does: as a child
// process with piped stdio. Node's `stdio: 'pipe'` is a socketpair, which is
// exactly what Claude Code hands its hooks — the case that broke reading stdin
// through /dev/stdin. Prints one JSON line describing what the stub received.

import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const outPath = process.env.DASBO_STUB_OUT
const mode = process.argv[2] ?? 'notify'
const event = process.argv[3] ?? 'SessionStart'
const payload = readFileSync(0, 'utf8')

function finish(result) {
  console.log(JSON.stringify(result))
  process.exit(0)
}

const stub = spawn('gjs', ['-m', join(here, 'stubService.js'), outPath], {
  stdio: ['ignore', 'pipe', 'inherit'],
})

let stubOut = ''
stub.stdout.on('data', (chunk) => {
  stubOut += chunk
  if (!stubOut.includes('ready')) return
  stubOut = ''
  runHook()
})

const giveUp = setTimeout(() => {
  stub.kill()
  finish({ error: 'timed out waiting for the stub or the hook' })
}, 20_000)

function runHook() {
  const hook = spawn(join(repo, 'hooks', 'dasbo-hook'), ['claude', mode, event], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  hook.stdout.on('data', (c) => { stdout += c })
  hook.stderr.on('data', (c) => { stderr += c })
  hook.stdin.end(payload)

  hook.on('close', (code) => {
    clearTimeout(giveUp)
    let received = null
    try {
      received = JSON.parse(readFileSync(outPath, 'utf8'))
    } catch {
      // The hook never reached the service; `received` stays null.
    }
    rmSync(outPath, { force: true })
    stub.kill()
    finish({ code, stdout, stderr, received })
  })
}
