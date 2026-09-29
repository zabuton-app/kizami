// Runs every UI check in sequence, each in its own Node process, and exits
// non-zero if any of them failed. With --xvfb each check runs on its own
// virtual X server, so the suite needs no desktop session and never puts a
// window on the real screen.
// See tools/ui-checks/README.md for usage.
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CHECKS = ['mini-bar-width', 'clock-shift', 'clock-mode-intact']

/**
 * xvfb-run defaults to a 640x480 screen at 8-bit depth, which is smaller than
 * the popup plus its tray-relative placement and too shallow for the
 * transparent window. A common desktop size keeps the layout the same as on a
 * real display.
 */
const XVFB_SCREEN = '-screen 0 1920x1080x24'

function usage() {
  return `Usage: node tools/ui-checks/run-all.mjs [--xvfb] [--verbose] [check ...]\nChecks: ${CHECKS.join(', ')}`
}

function runCheck(name, { xvfb, verbose }) {
  const script = path.join(__dirname, `${name}.mjs`)
  const nodeArgs = [script, ...(verbose ? ['--verbose'] : [])]
  const [command, args] = xvfb
    ? ['xvfb-run', ['-a', '-s', XVFB_SCREEN, process.execPath, ...nodeArgs]]
    : [process.execPath, nodeArgs]
  const env = xvfb ? { ...process.env, KIZAMI_FORCE_X11: '1' } : process.env

  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    child.once('error', (error) => {
      console.error(`${name}: ${error.message}`)
      resolve(1)
    })
    child.once('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)))
  })
}

async function main() {
  const args = process.argv.slice(2)
  const xvfb = args.includes('--xvfb')
  const verbose = args.includes('--verbose')
  const names = args.filter((arg) => !arg.startsWith('--'))
  const unknownFlag = args.find(
    (arg) => arg.startsWith('--') && arg !== '--xvfb' && arg !== '--verbose'
  )
  const unknownCheck = names.find((name) => !CHECKS.includes(name))
  if (unknownFlag !== undefined || unknownCheck !== undefined) {
    console.error(`Unknown argument "${unknownFlag ?? unknownCheck}".`)
    console.error(usage())
    process.exitCode = 1
    return
  }

  if (xvfb && spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).error !== undefined) {
    console.error('--xvfb needs `xvfb-run` on PATH (Debian/Ubuntu: xvfb, Arch: xorg-server-xvfb).')
    process.exitCode = 1
    return
  }

  const selected = names.length > 0 ? CHECKS.filter((name) => names.includes(name)) : CHECKS
  const results = []
  for (const name of selected) {
    console.log(`\n=== ${name}${xvfb ? ' (xvfb)' : ''} ===`)
    const startedAt = Date.now()
    const code = await runCheck(name, { xvfb, verbose })
    results.push({ name, code, seconds: Math.round((Date.now() - startedAt) / 1000) })
  }

  console.log('\n=== summary ===')
  for (const { name, code, seconds } of results) {
    console.log(`  ${code === 0 ? 'PASS' : 'FAIL'}  ${name} (${seconds}s)`)
  }
  if (results.some(({ code }) => code !== 0)) process.exitCode = 1
}

await main()
