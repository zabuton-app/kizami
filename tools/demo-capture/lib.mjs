// Shared helpers for the documentation screenshot scripts.
// See tools/demo-capture/README.md for usage.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.resolve(__dirname, '../..')
export const assetsDir = path.join(repoRoot, 'docs/assets')

const require = createRequire(path.join(repoRoot, 'package.json'))
const { _electron } = require('playwright-core')
const electronExecutable = require('electron')

/** Time for the UI to finish laying out and animating before a capture. */
const SETTLE_MS = 900

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Launch the built app against a throwaway user-data dir, so a capture run can
 * click UI that persists settings without disturbing the real configuration.
 *
 * Returns `{ page, capture, close }`; always await `close()` when done.
 */
export async function launchApp({ elapsedMs = 0 } = {}) {
  const mainScript = path.join(repoRoot, 'out/main/index.js')
  if (!fs.existsSync(mainScript)) {
    throw new Error('Built main script not found. Run `npm run build` first.')
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kizami-capture-'))
  // Inherited ELECTRON_RUN_AS_NODE would start the binary as plain Node, which
  // cannot resolve the built-in `electron` module the built main script imports.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  const app = await _electron.launch({
    executablePath: electronExecutable,
    // A fixed scale factor keeps the captures reproducible across machines.
    args: [mainScript, `--user-data-dir=${userDataDir}`, '--force-device-scale-factor=1'],
    env
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // Zen Maru Gothic is bundled and loads asynchronously; capturing earlier
  // would shoot the fallback font.
  await page.evaluate(() => document.fonts.ready)

  if (elapsedMs > 0) {
    // The timer lives in the main process, so it is reached through the
    // dev-only seam in src/main/index.ts rather than the page.
    await app.evaluate((_electronApi, ms) => globalThis.__kizamiSimulateElapsed(ms), elapsedMs)
  }

  await sleep(SETTLE_MS)

  return {
    page,
    /**
     * Write the popup to `docs/assets/<fileName>`. Capturing through the main
     * process keeps the transparent rounded corners the window really has.
     */
    async capture(fileName) {
      const base64 = await app.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].capturePage()
        return image.toPNG().toString('base64')
      })
      const target = path.join(assetsDir, fileName)
      fs.writeFileSync(target, Buffer.from(base64, 'base64'))
      return target
    },
    close: () => app.close()
  }
}
