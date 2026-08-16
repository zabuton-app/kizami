// Measures clock mode's mini bar against the width the window really gives it.
// The bar is a fixed 380x58, so the two clock cells, the date, the progress
// blocks and the expand button share a budget that a wider font, a longer city
// label or a smaller mini window would quietly blow. Everything below is
// re-derived from the rendered DOM on every run, so the check keeps telling the
// truth after the design changes rather than pinning yesterday's numbers.
// See tools/ui-checks/README.md for usage.
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, repoRoot, sleep } from '../demo-capture/lib.mjs'

/** The four combinations requirement 2.6 is about. */
const LANGUAGES = ['ja', 'en']
const CLOCK_FORMATS = ['hhmm', 'hhmmss']

/** Layout rounds, and a fraction of a pixel is not an overflow. */
const TOLERANCE_PX = 0.5

/**
 * A progress block thinner than this is not drawn at all. The blocks are the
 * bar's only flexible child, so they are what collapses first when the fixed
 * content grows — losing them would contradict 007's FR-005 just as much as
 * spilling out of the window would.
 */
const MIN_BLOCK_PX = 1

/**
 * Safety net for the two shift loops. They press until the UI stops answering
 * differently rather than assuming the range end's value, so a changed limit still
 * lands them on the widest label line.
 */
const MAX_SHIFT_PRESSES = 100

/** Time for a mode change (mini mode also resizes the window) to settle. */
const TRANSITION_MS = 500

/** Time for a settings change to reach the renderer and be laid out. */
const RENDER_MS = 80

/**
 * How many overflowing cases a combination lists beyond its tightest one. A
 * real regression trips a handful; a broken layout trips all of them, and
 * printing every one buries the summary.
 */
const MAX_LISTED_OVERFLOWS = 10

const px = (value) => value.toFixed(1)

const nextFrame = (page) =>
  page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)))

const updateSettings = (page, patch) =>
  page.evaluate((next) => globalThis.kizami.updateSettings(next), patch)

const readShift = (page) => page.$eval('.mini-bar__shift', (element) => element.textContent ?? '')

/**
 * The zone catalog, read out of the settings control rather than copied from
 * `timezones.ts`: a city added to the catalog is then covered by this check
 * without anyone remembering to add it here. Also yields each label in the
 * current language, which is what the per-zone waits below key on.
 */
async function readZoneCatalog(page, language) {
  await updateSettings(page, { language })
  await sleep(TRANSITION_MS)
  const options = await page.$$eval('.tz-select option', (nodes) =>
    nodes.map((node) => ({ zone: node.value, label: node.textContent ?? '' }))
  )
  // The leading option is the "not set" choice, whose value is the empty string.
  return options.filter((option) => option.zone !== '')
}

/** Select a comparison zone and wait for the bar to actually be showing it. */
async function selectZone(page, zone, label) {
  await updateSettings(page, { secondaryTimeZone: zone })
  await page.waitForFunction((expected) => {
    const labels = document.querySelectorAll('.mini-bar__cell-label')
    return labels.length === 2 && labels[1].textContent === expected
  }, label)
  // Two cities can share a label between the languages, in which case the wait
  // above is already satisfied by the outgoing render; settle before measuring.
  await sleep(RENDER_MS)
}

/**
 * Press ArrowUp to the far end of the range and return the label it reads
 * there. The end is read off the UI instead of hardcoded: the range wraps back
 * to now one step past it, so the wrap is the sentinel — the label seen just
 * before the amount goes empty is the end, and the presses that reached it are
 * counted so it can be climbed again. An empty first reading means the presses
 * never landed on the clock area at all.
 */
async function shiftToRangeEnd(page) {
  await page.focus('.mini-bar__clock')
  let previous = await readShift(page)
  for (let press = 0; press < MAX_SHIFT_PRESSES; press += 1) {
    await page.keyboard.press('ArrowUp')
    await nextFrame(page)
    const current = await readShift(page)
    if (current === '') {
      if (previous === '') throw new Error('the clock area never took the keyboard shift')
      // The wrap landed on now; climb back to the end it wrapped from.
      for (let back = 0; back < press; back += 1) {
        await page.keyboard.press('ArrowUp')
        await nextFrame(page)
      }
      const settled = await readShift(page)
      if (settled !== previous) {
        throw new Error(`climbing back reached ${settled}, expected ${previous}`)
      }
      return previous
    }
    previous = current
  }
  throw new Error(
    `the shift did not reach the end of its range within ${MAX_SHIFT_PRESSES} presses`
  )
}

/**
 * Two presses between zones, down and back up. The amount ends where it
 * started, but the input restarts the ten-second auto-return that would
 * otherwise drop the sweep back to now halfway through. The order matters:
 * pressing up first would wrap off the end to now, and the following press
 * down would then land an hour the wrong side of it.
 */
async function holdAtRangeEnd(page, endLabel) {
  await page.focus('.mini-bar__clock')
  await page.keyboard.press('ArrowDown')
  await nextFrame(page)
  await page.keyboard.press('ArrowUp')
  await nextFrame(page)
  if ((await readShift(page)) === endLabel) return
  // The auto-return beat us to it; climb back up and carry on.
  const recovered = await shiftToRangeEnd(page)
  if (recovered !== endLabel) {
    throw new Error(`the shift came back as ${recovered}, expected ${endLabel}`)
  }
}

/** Walk the shift back down to now, so the next pass starts unshifted. */
async function releaseShift(page) {
  await page.focus('.mini-bar__clock')
  for (let press = 0; press < MAX_SHIFT_PRESSES; press += 1) {
    if ((await readShift(page)) === '') return
    await page.keyboard.press('ArrowDown')
    await nextFrame(page)
  }
  throw new Error(`the shift did not return to now within ${MAX_SHIFT_PRESSES} presses`)
}

/**
 * Every width the bar's budget is made of, straight from the laid-out DOM.
 * `children` is walked generically as well as by name, so a part added to the
 * bar later is still checked against the content box.
 */
function measure(page) {
  return page.evaluate(() => {
    const styleOf = (element) => globalThis.getComputedStyle(element)

    const bar = document.querySelector('.mini-bar')
    if (bar === null) throw new Error('the mini bar is not on screen')

    const barStyle = styleOf(bar)
    const barBox = bar.getBoundingClientRect()
    const paddingLeft = parseFloat(barStyle.paddingLeft)
    const paddingRight = parseFloat(barStyle.paddingRight)
    // getBoundingClientRect() spans the border box; clientWidth stops at it.
    const contentLeft = barBox.left + parseFloat(barStyle.borderLeftWidth) + paddingLeft
    const contentWidth = bar.clientWidth - paddingLeft - paddingRight

    const boxOf = (selector) => {
      const element = bar.querySelector(selector)
      if (element === null) throw new Error(`the mini bar has no ${selector}`)
      return element.getBoundingClientRect().width
    }

    const strip = bar.querySelector('.mini-bar__blocks')
    if (strip === null) throw new Error('the mini bar has no .mini-bar__blocks')
    const blockElements = [...strip.children]
    if (blockElements.length === 0) throw new Error('the progress strip holds no blocks')
    const blockCap = parseFloat(styleOf(blockElements[0]).maxWidth)
    const blockGap = parseFloat(styleOf(strip).columnGap)

    return {
      clientWidth: bar.clientWidth,
      scrollWidth: bar.scrollWidth,
      contentWidth,
      paddingLeft,
      paddingRight,
      gap: parseFloat(barStyle.columnGap),
      parts: {
        clock: boxOf('.mini-bar__clock'),
        blocks: boxOf('.mini-bar__blocks'),
        date: boxOf('.mini-bar__date'),
        expand: boxOf('.mini-bar__icon-btn')
      },
      children: [...bar.children].map((element) => {
        const box = element.getBoundingClientRect()
        return {
          name: element.className.split(' ')[0].replace('mini-bar__', ''),
          width: box.width,
          start: box.left - contentLeft,
          end: box.right - contentLeft
        }
      }),
      blocks: {
        count: blockElements.length,
        width: blockElements[0].getBoundingClientRect().width,
        cap: Number.isNaN(blockCap) ? null : blockCap,
        // What the strip would take with every block at its design cap.
        designWidth: Number.isNaN(blockCap)
          ? null
          : blockElements.length * blockCap + (blockElements.length - 1) * blockGap
      },
      cells: [...bar.querySelectorAll('.mini-bar__cell')].map((cell) => ({
        label: cell.querySelector('.mini-bar__cell-label')?.textContent ?? '',
        time: cell.querySelector('.mini-bar__time')?.textContent ?? '',
        width: cell.getBoundingClientRect().width
      })),
      shift: bar.querySelector('.mini-bar__shift')?.textContent ?? '',
      date: bar.querySelector('.mini-bar__date')?.textContent ?? ''
    }
  })
}

/** Width the bar cannot give back: everything except the flexible strip. */
function fixedWidth(measurement) {
  const gaps = measurement.gap * (measurement.children.length - 1)
  return measurement.parts.clock + measurement.parts.date + measurement.parts.expand + gaps
}

/** Every way this measurement says the content did not fit, in plain words. */
function overflowReasons(measurement) {
  const reasons = []
  if (measurement.scrollWidth > measurement.clientWidth + TOLERANCE_PX) {
    reasons.push(
      `scrollWidth ${px(measurement.scrollWidth)} exceeds clientWidth ${px(measurement.clientWidth)}`
    )
  }
  for (const child of measurement.children) {
    if (child.start < -TOLERANCE_PX) {
      reasons.push(`${child.name} starts ${px(-child.start)}px left of the content box`)
    }
    if (child.end > measurement.contentWidth + TOLERANCE_PX) {
      reasons.push(`${child.name} ends ${px(child.end - measurement.contentWidth)}px past it`)
    }
  }
  if (measurement.blocks.width < MIN_BLOCK_PX) {
    reasons.push(
      `the progress blocks are down to ${px(measurement.blocks.width)}px, ` +
        `under the ${MIN_BLOCK_PX}px it takes to draw one`
    )
  }
  return reasons
}

function caseLine(result) {
  const { measurement: m } = result
  const state = m.shift === '' ? 'now' : m.shift
  const verdict = result.reasons.length === 0 ? 'fits' : 'OVERFLOWS'
  return (
    `${result.zone.padEnd(20)} ${state.padStart(5)}  ` +
    `clock ${px(m.parts.clock).padStart(6)}  date ${px(m.parts.date).padStart(5)}  ` +
    `expand ${px(m.parts.expand).padStart(5)}  blocks ${px(m.parts.blocks).padStart(6)} ` +
    `(${px(m.blocks.width)}/block)  ${verdict}`
  )
}

function describeTightest(result) {
  const { measurement: m } = result
  const gaps = m.gap * (m.children.length - 1)
  const cells = m.cells.map((cell) => `"${cell.label}" ${cell.time} @${px(cell.width)}`).join(' | ')
  const design =
    m.blocks.designWidth === null
      ? ''
      : ` of ${px(m.blocks.designWidth)} at the ${px(m.blocks.cap)} design cap`
  const lines = [
    `  tightest: ${result.zone}, ${m.shift === '' ? 'unshifted' : `shifted ${m.shift}`}`,
    `    bar        clientWidth ${px(m.clientWidth)}, scrollWidth ${px(m.scrollWidth)}, ` +
      `${px(m.contentWidth)} usable inside ${px(m.paddingLeft)}+${px(m.paddingRight)} padding`,
    `    clock      ${px(m.parts.clock).padStart(6)}   ${cells}`,
    `    date       ${px(m.parts.date).padStart(6)}   "${m.date}"`,
    `    expand     ${px(m.parts.expand).padStart(6)}`,
    `    gaps       ${px(gaps).padStart(6)}   ${m.children.length - 1} x ${px(m.gap)}`,
    `    fixed      ${px(fixedWidth(m)).padStart(6)}   of ${px(m.contentWidth)} usable`,
    `    blocks     ${px(m.parts.blocks).padStart(6)}   left over, ` +
      `${px(m.blocks.width)} per block across ${m.blocks.count}${design}`
  ]
  if (result.reasons.length === 0) {
    lines.push(`    verdict    fits, ${px(m.parts.blocks)}px of slack in the flexible strip`)
  } else {
    for (const reason of result.reasons) lines.push(`    OVERFLOW   ${reason}`)
  }
  return lines.join('\n')
}

/** One (language, format) combination, swept across the whole catalog. */
async function sweepCombination(page, { language, format, zones, verbose }) {
  const results = []

  const record = async (zone) => {
    const measurement = await measure(page)
    results.push({ zone, measurement, reasons: overflowReasons(measurement) })
  }

  await updateSettings(page, { language, clockFormat: format })
  await sleep(RENDER_MS)

  for (const { zone, label } of zones) {
    await selectZone(page, zone, label)
    await record(zone)
  }

  const endLabel = await shiftToRangeEnd(page)
  for (const { zone, label } of zones) {
    await selectZone(page, zone, label)
    await holdAtRangeEnd(page, endLabel)
    await record(zone)
  }
  await releaseShift(page)

  // The bar's fixed content is what eats the budget, so the case with the most
  // of it is the one the width has to survive.
  const tightest = results.reduce((worst, result) =>
    fixedWidth(result.measurement) > fixedWidth(worst.measurement) ? result : worst
  )
  const overflowing = results.filter((result) => result.reasons.length > 0)

  console.log(`\n${language} / ${format}`)
  if (verbose) {
    for (const result of results) console.log(`  ${caseLine(result)}`)
  }
  console.log(describeTightest(tightest))
  if (!verbose) {
    const listed = overflowing.filter((result) => result !== tightest)
    for (const result of listed.slice(0, MAX_LISTED_OVERFLOWS)) {
      console.log(`  ${caseLine(result)}`)
    }
    if (listed.length > MAX_LISTED_OVERFLOWS) {
      console.log(`  ... and ${listed.length - MAX_LISTED_OVERFLOWS} more overflowing cases`)
    }
  }
  console.log(
    `  ${results.length} cases (${zones.length} zones, unshifted and at ${endLabel}), ` +
      `${overflowing.length} overflowing`
  )

  return results
}

async function main() {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const selfCheck = args.includes('--self-check')
  const unknown = args.filter((arg) => arg !== '--verbose' && arg !== '--self-check')
  if (unknown.length > 0) {
    console.error(`Unknown argument "${unknown[0]}". Usage: [--verbose] [--self-check]`)
    process.exitCode = 1
    return
  }

  // Checked here as well as inside launchApp(), so the commonest mistake gets
  // the fix rather than a launch failure's stack.
  const mainScript = path.join(repoRoot, 'out/main/index.js')
  if (!fs.existsSync(mainScript)) {
    console.error(`${mainScript} is missing.`)
    console.error('This check drives the built app, so run `npm run build` first.')
    process.exitCode = 1
    return
  }

  let app
  try {
    app = await launchApp()
  } catch (error) {
    console.error(error.message)
    console.error('If this session has no X display, prefix the command with `xvfb-run -a`.')
    process.exitCode = 1
    return
  }

  try {
    const { page } = app

    // The catalog lives behind the settings screen, so read it before the
    // window shrinks to the bar.
    await page.click('.titlebar__gear')
    await sleep(TRANSITION_MS)
    const catalog = {}
    for (const language of LANGUAGES) {
      catalog[language] = await readZoneCatalog(page, language)
    }

    await updateSettings(page, { clockMode: true, miniMode: true })
    await page.waitForSelector('.mini-bar__clock')
    await sleep(TRANSITION_MS)

    if (selfCheck) {
      // Deliberately blow the budget, to prove the measurement below can see it.
      await page.addStyleTag({ content: '.mini-bar__date { font-size: 48px }' })
      await sleep(RENDER_MS)
      console.log('--self-check: the date is forced oversized, so every case must overflow')
    }

    const zoneCount = catalog[LANGUAGES[0]].length
    console.log(
      `mini bar width check: ${LANGUAGES.length} languages x ${CLOCK_FORMATS.length} formats ` +
        `x ${zoneCount} zones x 2 shift states`
    )

    const results = []
    for (const language of LANGUAGES) {
      for (const format of CLOCK_FORMATS) {
        results.push(
          ...(await sweepCombination(page, { language, format, zones: catalog[language], verbose }))
        )
      }
    }

    const overflowing = results.filter((result) => result.reasons.length > 0)
    console.log(`\n${results.length} cases measured, ${overflowing.length} overflowing`)
    if (overflowing.length > 0) process.exitCode = 1
  } finally {
    await app.close()
  }
}

await main()
