// Regenerates the screenshots used by README.md and the landing page.
// See tools/demo-capture/README.md for usage.
import { launchApp, sleep } from './lib.mjs'

/**
 * Mid-session look for the shots that show the countdown: 13:42 into a 25
 * minute focus phase, so they read as a session in progress rather than idle.
 */
const ELAPSED_MS = 822_000

/** Time for a view switch (mini mode also resizes the window) to settle. */
const TRANSITION_MS = 500

const SHOTS = {
  timer: { file: 'shot-timer.png', elapsedMs: ELAPSED_MS },
  settings: { file: 'shot-settings.png', click: '.titlebar__gear' },
  mini: { file: 'shot-mini.png', elapsedMs: ELAPSED_MS, click: '.titlebar__mini' }
}

async function shoot({ file, elapsedMs, click }) {
  const app = await launchApp({ elapsedMs })
  try {
    if (click) {
      await app.page.click(click)
      await sleep(TRANSITION_MS)
    }
    return await app.capture(file)
  } finally {
    await app.close()
  }
}

const requested = process.argv.slice(2)
const names = requested.length > 0 ? requested : Object.keys(SHOTS)

for (const name of names) {
  if (!Object.hasOwn(SHOTS, name)) {
    console.error(`Unknown shot "${name}". Available: ${Object.keys(SHOTS).join(', ')}`)
    process.exitCode = 1
    continue
  }
  console.log(`captured ${await shoot(SHOTS[name])}`)
}
