// Guards what clock mode already did, now that it has a second row and a
// shiftable display. Every case here is a "nothing else moved" assertion: with
// no comparison zone the clock is still one bare row, the pomodoro timer keeps
// its own schedule across scrolling and across the automatic return, scrolling
// outside clock mode does nothing, the shift is dropped on leaving clock mode
// and on a restart, and the clock, the day-progress blocks and the mini bar's
// date are all right the moment the window comes back.
//
// Nothing is read back from the app to decide what is correct: times, block
// counts and date strings are re-derived here from the wall clock, the zone id
// and the dictionary, so a display that agrees with itself but not with the
// world still fails. The timer is observed only through `getSnapshot()`, which
// reports the main process's own state — the renderer cannot fake it.
// See tools/ui-checks/README.md for usage.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp, repoRoot, sleep } from '../demo-capture/lib.mjs'

const require = createRequire(path.join(repoRoot, 'package.json'))
const { _electron } = require('playwright-core')
const electronExecutable = require('electron')

const mainScript = path.join(repoRoot, 'out/main/index.js')

/**
 * Read a numeric `const` out of a source file, so the check compares against
 * the app's own numbers instead of a copy that can drift. Exported or not: one
 * of the numbers the check needs is module-private to a component. It reads the
 * source while the run drives the bundle, which is why a fresh `npm run build`
 * is a prerequisite: a stale `out/` produces a red with a documented cause.
 */
function readNumericConstant(relativePath, name) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
  const match = new RegExp(`(?:export )?const ${name} = ([\\d_]+)`).exec(source)
  if (match === null) throw new Error(`${name} is not declared in ${relativePath}`)
  return Number(match[1].replaceAll('_', ''))
}

/** Read one dictionary entry, for the same reason the constants are read. */
function readMessage(language, key) {
  const source = fs.readFileSync(path.join(repoRoot, `src/shared/i18n/${language}.ts`), 'utf8')
  const match = new RegExp(`'${key}': '([^']*)'`).exec(source)
  if (match === null) throw new Error(`${key} is not in the ${language} dictionary`)
  return match[1]
}

/**
 * Read one numeric field out of `DEFAULT_SETTINGS`. The phase-change case has
 * to position the timer near a boundary before the app starts, so it needs the
 * work duration a fresh profile comes up with, and reading it beats assuming it.
 */
function readDefaultSetting(name) {
  const source = fs.readFileSync(path.join(repoRoot, 'src/shared/types.ts'), 'utf8')
  const block = /export const DEFAULT_SETTINGS[^{]*\{([\s\S]*?)\n\}/.exec(source)
  if (block === null) throw new Error('DEFAULT_SETTINGS is not declared in src/shared/types.ts')
  const match = new RegExp(`\\n\\s*${name}: (\\d+)`).exec(block[1])
  if (match === null) throw new Error(`${name} is not a number in DEFAULT_SETTINGS`)
  return Number(match[1])
}

const DAY_MS = readNumericConstant('src/shared/clock.ts', 'DAY_MS')
const SHIFT_RESET_MS = readNumericConstant('src/shared/clock.ts', 'SHIFT_RESET_MS')
const SHIFT_HOURS_LIMIT = readNumericConstant('src/shared/clock.ts', 'SHIFT_HOURS_LIMIT')
const WHEEL_STEP_PX = readNumericConstant('src/shared/wheel-steps.ts', 'WHEEL_STEP_PX')
// Two strips, two lengths: the timer's phase strip is ten blocks, while
// clock mode's day strip is twelve so that a block is exactly two hours.
const PROGRESS_BLOCKS = readNumericConstant('src/shared/types.ts', 'PROGRESS_BLOCKS')
const DAY_BLOCKS = readNumericConstant('src/shared/clock.ts', 'DAY_BLOCKS')
const WORK_PHASE_MS = readDefaultSetting('workMinutes') * 60_000

/** Interface language the run is pinned to, so the labels are predictable. */
const LANGUAGE = 'en'

const HOUR_UNIT = readMessage(LANGUAGE, 'clock.hourUnit')

/** Weekday labels in `Date#getDay()` order, the same order the views index. */
const WEEKDAY_LABELS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((day) =>
  readMessage(LANGUAGE, `weekday.${day}`)
)

/**
 * What the notification at the end of the first work phase must say, read from
 * the dictionary rather than copied, so a reworded message is compared against
 * instead of quietly accepted.
 */
const WORK_END_NOTIFICATION = {
  title: readMessage(LANGUAGE, 'notification.workEndShort.title'),
  body: readMessage(LANGUAGE, 'notification.workEndShort.body')
}

/**
 * Seconds are the default here: a stale clock is only visibly stale at second
 * resolution, and every case except the format sweep wants the tightest
 * readout available.
 */
const CLOCK_FORMAT = 'hhmmss'

/** Both formats, because 2.3 is about the presentation in either one. */
const CLOCK_FORMATS = ['hhmm', 'hhmmss']

/**
 * India is 30 minutes off the hour grid, so a comparison row that lands on the
 * expected time cannot have been hour-quantized by accident.
 */
const ZONE = 'Asia/Kolkata'

const HOUR_MS = 3_600_000

/**
 * How long a mini-mode switch takes to be *over*, in the window's own numbers
 * rather than a guess. `applyMiniMode` arms a settle window, re-arms a second
 * one, and then — 100ms after those — reads the renderer's viewport back and
 * corrects a stale one with a nudge that is restored `NUDGE_RESTORE_MS` later.
 * Only after that last step is the window done moving.
 *
 * The check has to wait out the whole sequence, not just the first settle,
 * because that viewport correction gives up the moment the window is not
 * visible (`syncViewportAfterTransition` in src/main/popup-window.ts) and never
 * runs again for that transition. A case that hides the window earlier than
 * this — 6.4 hid it about 500ms after the switch — cancels the app's only
 * recovery from a resize the compositor dropped, and the renderer can be left
 * laid out for the size it no longer has. That is what made the run's last step
 * wait for a `.timer` that a mini-sized renderer will never draw.
 *
 * The constants are read from the main process rather than copied, and the
 * slack covers the IPC round trip the read itself costs.
 */
const TRANSITION_SETTLE_MS = readNumericConstant(
  'src/main/popup-transition-state.ts',
  'TRANSITION_SETTLE_MS'
)
const NUDGE_RESTORE_MS = readNumericConstant(
  'src/main/popup-transition-state.ts',
  'NUDGE_RESTORE_MS'
)
const VIEWPORT_CHECK_DELAY_MS = 100
const TRANSITION_SLACK = 400
const TRANSITION_MS =
  TRANSITION_SETTLE_MS * 2 + VIEWPORT_CHECK_DELAY_MS + NUDGE_RESTORE_MS + TRANSITION_SLACK

/** The height below which the renderer treats the window as mini-sized. */
const MINI_HEIGHT_THRESHOLD = readNumericConstant('src/renderer/App.tsx', 'MINI_HEIGHT_THRESHOLD')

/**
 * How long a form is given to appear. Shorter than Playwright's own default on
 * purpose: a form that is not there in this long is not coming, and the run is
 * more useful reporting what the window and the renderer disagreed about than
 * standing at a selector for half a minute.
 */
const FORM_TIMEOUT_MS = 8000

/** Time for a settings change to reach the renderer and be laid out. */
const RENDER_MS = 120

/** How long a state the check drives to is given to appear before it is wrong. */
const WAIT_MS = 3000

/**
 * How long a single notch is given to reach the display inside a scroll loop.
 * Well past 3.8's 200ms budget, and short enough that a display which stopped
 * answering does not stretch the loop past the phase boundary it is racing.
 */
const ANSWER_MS = 500

/**
 * A rendered row can be up to one display tick old, plus the round trip that
 * read it, so the expected time is a small set rather than one value and a read
 * straddling a second boundary is not a failure.
 */
const RENDER_LAG_MS = 1500

/** Sampling step for that window; under a second, so no second is skipped. */
const SAMPLE_MS = 250

/**
 * `remainingSec` is `ceil(remainingMs / 1000)`, so over a measured window the
 * drop is bounded exactly. One second of slack on each side covers the clock
 * granularity between the harness's stamps and the main process's own read.
 */
const TIMER_DRIFT_SLACK_SEC = 1

/** How far behind the snapshot a rendered timer readout may legitimately be. */
const TIMER_TEXT_LAG_SEC = 2

/** Notches used wherever a case only needs the input to demonstrably land. */
const SCROLL_NOTCHES = 4

/** Hours the shift is taken to when a case just needs a visible amount. */
const SAMPLE_SHIFT_HOURS = 3

/** Safety net for the loops that walk the shift; well past the clamp. */
const MAX_SHIFT_PRESSES = SHIFT_HOURS_LIMIT * 2 + 4

/**
 * Above this share of the auto-return wait, a case that must out-race it can no
 * longer tell "the shift was discarded" from "the shift expired", so it says so
 * instead of claiming a pass.
 */
const RACE_SAFE_FRACTION = 0.7

/** Time for the hide to reach the compositor before the window is judged gone. */
const HIDE_SETTLE_MS = 800

/**
 * How long the renderer's main thread is held while the window is hidden. The
 * window really is hidden for this whole stretch, but hiding alone does not
 * throttle the renderer on this platform (measured: it keeps ticking at 1Hz),
 * so the stall is what actually creates 6.4's condition — a display that
 * accumulated ticks instead of re-deriving from the wall clock comes back this
 * far behind and stays there.
 */
const STALL_MS = 12_000

/** Time for IPC queued during the stall to drain before the probe is read. */
const DRAIN_MS = 300

/** How long the window is given to come back before the case gives up. */
const SHOW_TIMEOUT_MS = 15_000

/** How long a display may lag the wall clock at the first read after a wake. */
const WAKE_LAG_MS = 1500

/** How long before its phase ends the timer used for the transition case is. */
const TRANSITION_LEAD_MS = 12_000

/** Poll interval while waiting for that phase change. */
const TRANSITION_POLL_MS = 250

/**
 * Slack on the observed phase change. The engine only notices the boundary on
 * its own 1s tick, and the poll and the IPC round trip land after that.
 */
const TRANSITION_SLACK_MS = 2500

/** Settle time after a launch this file drives itself, mirroring lib.mjs's. */
const DIRECT_SETTLE_MS = 900

/** Prefix `launchApp()` gives its throwaway profile directories. */
const PROFILE_PREFIX = 'kizami-capture-'

/** The two clock surfaces (3.6), each named by the classes it renders. */
const SURFACES = {
  normal: {
    form: 'normal',
    name: 'normal window',
    // The card holds the rows and the day-progress blocks; there is no date.
    // `formRoot` is what the window form itself renders in either mode, so a
    // case can wait for the form without assuming clock mode is on.
    formRoot: '.timer',
    root: '.timer__card--clock',
    area: '.timer__card--clock',
    rows: '.timer__rows',
    shift: '.timer__shift',
    time: '.timer__time',
    label: '.timer__row-label',
    block: '.timer__blocks .timer__block',
    date: null,
    expand: null,
    pair: 'timer__rows--pair'
  },
  mini: {
    form: 'mini',
    name: 'mini bar',
    // The blocks and the date are siblings of the clock area, so the bar itself
    // is the root everything is read from.
    formRoot: '.mini-bar',
    root: '.mini-bar',
    area: '.mini-bar__clock',
    rows: '.mini-bar__clock',
    shift: '.mini-bar__shift',
    time: '.mini-bar__time',
    label: '.mini-bar__cell-label',
    block: '.mini-bar__blocks .mini-bar__block',
    date: '.mini-bar__date',
    expand: '.mini-bar__icon-btn',
    pair: 'mini-bar__clock--pair'
  }
}

/** What an unfilled day-progress block carries as its inline background. */
const EMPTY_BLOCK = 'var(--empty)'

/**
 * What the shift badge must read, rebuilt from the sign and the unit rather
 * than imported, so a regression in `formatShiftLabel` shows up as a mismatch
 * instead of cancelling out.
 */
const shiftLabel = (hours) =>
  hours === 0 ? '' : `${hours > 0 ? '+' : '-'}${Math.abs(hours)}${HOUR_UNIT}`

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** What a timer view says about the phase, in whichever form it renders it. */
const headerText = (view) => [view.phase, view.session].filter((part) => part !== null).join(' ')

const listed = (values) => [...values].sort().join(' or ')

const nextFrame = (page) =>
  page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)))

const updateSettings = (page, patch) =>
  page.evaluate((next) => globalThis.kizami.updateSettings(next), patch)

const getSettings = (page) => page.evaluate(() => globalThis.kizami.getSettings())

// --- independent derivations -------------------------------------------------

const pad2 = (value) => String(value).padStart(2, '0')

/** A local time of day in the clock's own notation, built from the parts. */
function localClockText(instant, format) {
  const base = `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}`
  return format === 'hhmmss' ? `${base}:${pad2(instant.getSeconds())}` : base
}

const zoneFormatters = new Map()

function zoneFormatter(zone) {
  const cached = zoneFormatters.get(zone)
  if (cached !== undefined) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  zoneFormatters.set(zone, formatter)
  return formatter
}

/** The same notation for a comparison zone, resolved in this process. */
function zoneClockText(instant, zone, format) {
  const parts = zoneFormatter(zone).formatToParts(instant)
  const value = (type) => pad2(Number(parts.find((part) => part.type === type)?.value ?? 0))
  const base = `${value('hour')}:${value('minute')}`
  return format === 'hhmmss' ? `${base}:${value('second')}` : base
}

/**
 * How many day-progress blocks the strip should have filled: the elapsed
 * fraction of the real 24-hour local day, rounded to the nearest block. Derived
 * from the definition in 6.1 rather than from the app's expression, so the two
 * cannot be wrong together.
 */
function dayBlocksAt(instant) {
  const intoDay =
    ((instant.getHours() * 60 + instant.getMinutes()) * 60 + instant.getSeconds()) * 1000 +
    instant.getMilliseconds()
  const filled = Math.round((intoDay / DAY_MS) * DAY_BLOCKS)
  return Math.min(DAY_BLOCKS, Math.max(0, filled))
}

/** The mini bar's date line, rebuilt in the language's customary order. */
function dateTextAt(instant) {
  const weekday = WEEKDAY_LABELS[instant.getDay()]
  return `${weekday} ${instant.getMonth() + 1}/${instant.getDate()}`
}

/**
 * Everything the display could legitimately be showing for one reading: the
 * home row, the comparison row, the block count and the date, over the window
 * between the oldest render the reading could have caught and the moment it was
 * taken. The clock rows are moved by `hours`; the blocks and the date never
 * are, which is the whole of 6.1 and 6.2.
 */
function displayCandidates(reading, { hours, zone, format, lagMs = RENDER_LAG_MS }) {
  const home = new Set()
  const secondary = new Set()
  const blocks = new Set()
  const dates = new Set()
  const add = (at) => {
    const real = new Date(at)
    blocks.add(dayBlocksAt(real))
    dates.add(dateTextAt(real))
    const shown = new Date(at + hours * HOUR_MS)
    home.add(localClockText(shown, format))
    if (zone !== null) secondary.add(zoneClockText(shown, zone, format))
  }
  for (let at = reading.before - lagMs; at < reading.after; at += SAMPLE_MS) add(at)
  add(reading.after)
  return { home, secondary, blocks, dates }
}

/** The `mm:ss` a timer readout may show for a snapshot taken just after it. */
function timerTextCandidates(snapshot) {
  const texts = new Set()
  for (let extra = 0; extra <= TIMER_TEXT_LAG_SEC; extra += 1) {
    const seconds = Math.min(snapshot.totalSec, snapshot.remainingSec + extra)
    texts.add(`${pad2(Math.floor(seconds / 60))}:${pad2(seconds % 60)}`)
  }
  return texts
}

// --- case bookkeeping --------------------------------------------------------

function startCase(id, requirements) {
  return { id, requirements, failures: [], notes: [] }
}

function fail(unit, requirement, message) {
  unit.failures.push({ requirement, message })
}

function note(unit, message) {
  unit.notes.push(message)
}

// --- reading the app ---------------------------------------------------------

/**
 * Everything one surface currently says, in a single round trip so the rows,
 * the blocks and the date all come from the same render — which is what makes
 * comparing them to one instant meaningful at all.
 */
function readClock(page, surface) {
  return page.evaluate(
    (arg) => {
      const { selectors, emptyBlock } = arg
      const root = document.querySelector(selectors.root)
      if (root === null) return { present: false }
      const box = (element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }
      const badge = root.querySelector(selectors.shift)
      const labels = [...root.querySelectorAll(selectors.label)]
      const blocks = [...root.querySelectorAll(selectors.block)]
      const dateNode = selectors.date === null ? null : root.querySelector(selectors.date)
      return {
        present: true,
        rowsClass: root.querySelector(selectors.rows)?.className ?? '',
        times: [...root.querySelectorAll(selectors.time)].map((node) => node.textContent ?? ''),
        // The bar nests the badge inside the home label, so the label text has
        // to be taken without it.
        labels: labels.map((node) => {
          const copy = node.cloneNode(true)
          for (const nested of copy.querySelectorAll(selectors.shift)) nested.remove()
          return copy.textContent ?? ''
        }),
        labelBoxes: labels.map(box),
        shift: badge === null ? null : (badge.textContent ?? ''),
        shiftBox: badge === null ? null : box(badge),
        blocks: {
          count: blocks.length,
          // React writes the palette token inline, so the filled ones are the
          // ones not carrying the empty token.
          filled: blocks.filter((node) => node.style.background !== emptyBlock).length
        },
        date: dateNode === null ? null : (dateNode.textContent ?? ''),
        hasExpand: selectors.expand === null ? null : root.querySelector(selectors.expand) !== null
      }
    },
    { selectors: surface, emptyBlock: EMPTY_BLOCK }
  )
}

async function readClockStamped(page, surface) {
  const before = Date.now()
  const clock = await readClock(page, surface)
  return { ...clock, before, after: Date.now() }
}

const readShiftText = async (page, surface) => (await readClock(page, surface)).shift ?? ''

/** The timer as the main process reports it, bracketed by the round trip. */
async function readSnapshot(page) {
  const before = Date.now()
  const snapshot = await page.evaluate(() => globalThis.kizami.getSnapshot())
  return { ...snapshot, before, after: Date.now() }
}

/** What the timer view is showing, for the case that must see it stand still. */
function readTimerView(page, form) {
  return page.evaluate(
    (arg) => {
      const text = (selector) => document.querySelector(selector)?.textContent ?? null
      const blocks = [...document.querySelectorAll(arg.block)]
      return {
        // The bar has no header: it carries the phase as the dot's accessible
        // name and shows no session count at all, so reading the card's
        // selectors there would compare null against null and assert nothing.
        phase:
          arg.form === 'mini'
            ? (document.querySelector('.mini-bar__dot')?.getAttribute('aria-label') ?? null)
            : text('.timer__phase'),
        session: arg.form === 'mini' ? null : text('.timer__session'),
        time: text(arg.time),
        blocks: {
          count: blocks.length,
          filled: blocks.filter((node) => node.style.background !== arg.emptyBlock).length
        },
        // Anything clock mode would have put on screen. None of it may appear.
        clockCard: document.querySelector('.timer__card--clock') !== null,
        clockCells: document.querySelectorAll('.mini-bar__cell').length,
        shifts: document.querySelectorAll('.timer__shift, .mini-bar__shift').length,
        rowLabels: document.querySelectorAll('.timer__row-label').length,
        scrollY: globalThis.scrollY
      }
    },
    {
      form,
      time: form === 'mini' ? '.mini-bar__time' : '.timer__card .timer__time',
      block: form === 'mini' ? '.mini-bar__block' : '.timer__block',
      emptyBlock: EMPTY_BLOCK
    }
  )
}

// --- assertions --------------------------------------------------------------

/**
 * The display against the world: every row on the shifted instant, the blocks
 * and the date on the real one. Each aspect fails against its own requirement,
 * so a report names the rule that broke rather than the case that noticed.
 */
function checkDisplay(unit, reading, options) {
  const { hours, zone, format, rows, requirements, surface } = options
  if (!reading.present) {
    fail(unit, requirements.clock, `the ${surface.name}'s clock is not on screen`)
    return false
  }
  const wanted = displayCandidates(reading, { hours, zone, format, lagMs: options.lagMs })
  let ok = true
  if (reading.times.length !== rows) {
    fail(unit, requirements.clock, `the clock shows ${reading.times.length} rows, expected ${rows}`)
    ok = false
  } else {
    if (!wanted.home.has(reading.times[0])) {
      fail(
        unit,
        requirements.clock,
        `the home row reads ${reading.times[0]}, expected ${listed(wanted.home)}`
      )
      ok = false
    }
    if (rows === 2 && !wanted.secondary.has(reading.times[1])) {
      fail(
        unit,
        requirements.clock,
        `the ${zone} row reads ${reading.times[1]}, expected ${listed(wanted.secondary)}`
      )
      ok = false
    }
  }
  if (reading.blocks.count !== DAY_BLOCKS) {
    fail(
      unit,
      requirements.blocks,
      `the day-progress strip holds ${reading.blocks.count} blocks, expected ${DAY_BLOCKS}`
    )
    ok = false
  }
  if (!wanted.blocks.has(reading.blocks.filled)) {
    fail(
      unit,
      requirements.blocks,
      `${reading.blocks.filled} day-progress blocks are filled, ` +
        `but the real day is ${listed(wanted.blocks)} blocks in`
    )
    ok = false
  }
  if (reading.date !== null && !wanted.dates.has(reading.date)) {
    fail(
      unit,
      requirements.date,
      `the date reads "${reading.date}", expected "${listed(wanted.dates)}"`
    )
    ok = false
  }
  return ok
}

/**
 * Two snapshots of a timer that nothing was supposed to touch. Every field must
 * be identical except the remaining time, which must have fallen by exactly the
 * wall time that passed between the two reads.
 */
function checkTimerUntouched(unit, requirement, first, second, what) {
  let ok = true
  for (const key of ['phase', 'session', 'running', 'fresh', 'totalSec', 'taskName']) {
    if (first[key] !== second[key]) {
      fail(unit, requirement, `${what} changed the timer's ${key}: ${first[key]} -> ${second[key]}`)
      ok = false
    }
  }
  const minElapsed = Math.max(0, second.before - first.after)
  const maxElapsed = second.after - first.before
  const low = Math.floor(minElapsed / 1000) - TIMER_DRIFT_SLACK_SEC
  const high = Math.ceil(maxElapsed / 1000) + TIMER_DRIFT_SLACK_SEC
  const drop = first.remainingSec - second.remainingSec
  if (drop < low || drop > high) {
    fail(
      unit,
      requirement,
      `${what}: the remaining time fell ${drop}s over ${maxElapsed}ms of wall time, ` +
        `expected ${low}-${high}s`
    )
    ok = false
  }
  return ok
}

/**
 * Wait for the badge to read what `hours` implies. Polled rather than read
 * once: the render lands a few milliseconds after the input, so a bare read
 * straight after a notch reliably catches the previous value.
 */
async function waitForShift(page, surface, hours, timeout) {
  try {
    await page.waitForFunction(
      (arg) => {
        const badge = document.querySelector(`${arg.area} ${arg.shift}`)
        return badge !== null && (badge.textContent ?? '') === arg.expected
      },
      { area: surface.area, shift: surface.shift, expected: shiftLabel(hours) },
      { timeout, polling: 50 }
    )
    return true
  } catch {
    return false
  }
}

/** The same, turning a timeout into a failure against the caller's requirement. */
async function expectShift(unit, page, surface, hours, requirement, timeout = WAIT_MS) {
  if (await waitForShift(page, surface, hours, timeout)) return true
  const expected = shiftLabel(hours)
  const actual = await readShiftText(page, surface)
  const wanted = expected === '' ? 'no shift amount' : `"${expected}"`
  fail(
    unit,
    requirement,
    `the ${surface.name} shows "${actual}" where ${wanted} was expected after ${timeout}ms`
  )
  return false
}

/** How a case that had to out-race the auto-return should describe its timing. */
function describeRace(what, elapsed) {
  return elapsed / SHIFT_RESET_MS > RACE_SAFE_FRACTION
    ? `inconclusive: ${what} took ${elapsed}ms of the ${SHIFT_RESET_MS}ms auto-return wait, ` +
        'so the amount may have expired rather than been discarded'
    : `${what} took ${elapsed}ms, well inside the ${SHIFT_RESET_MS}ms wait`
}

// --- driving the app ---------------------------------------------------------

async function pointAt(page, selector) {
  const handle = await page.waitForSelector(selector)
  const box = await handle.boundingBox()
  if (box === null) throw new Error(`${selector} has no box on screen`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * One mouse-notch-sized wheel event. The DOM reports an upward scroll as a
 * negative deltaY and upward means forward, so the sign is inverted once here —
 * the same single inversion `accumulateWheelSteps` makes on the other side.
 */
const wheelNotch = (page, direction) => page.mouse.wheel(0, -WHEEL_STEP_PX * direction)

/** The accessible equivalent of a notch, used wherever a case needs `n` hours. */
async function pressShift(page, surface, direction, presses) {
  await page.focus(surface.area)
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press(direction > 0 ? 'ArrowUp' : 'ArrowDown')
    await nextFrame(page)
  }
}

/** Walk the shift back to now, so the next case starts from a known state. */
async function resetShift(page, surface) {
  await page.focus(surface.area)
  for (let press = 0; press <= MAX_SHIFT_PRESSES; press += 1) {
    const current = await readShiftText(page, surface)
    if (current === '') return
    await page.keyboard.press(current.startsWith('-') ? 'ArrowUp' : 'ArrowDown')
    await nextFrame(page)
  }
  throw new Error('the shift would not walk back to now')
}

const waitForRows = (page, surface, count) =>
  page.waitForFunction(
    (arg) => document.querySelectorAll(arg.time).length === arg.count,
    { time: surface.time, count },
    { timeout: WAIT_MS, polling: 50 }
  )

/**
 * What the renderer itself thinks it is showing, and at what size. Read on the
 * one path that can otherwise only say "the selector never appeared": the form
 * on screen, the setting that asks for it, and the viewport that decides
 * between them are three different things, and a failure is only actionable
 * when it says which of the three disagreed.
 */
const readFormState = async (page) => ({
  viewport: await page.evaluate(() => ({
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    timer: document.querySelector('.timer') !== null,
    miniBar: document.querySelector('.mini-bar') !== null
  })),
  miniMode: (await getSettings(page)).miniMode
})

/**
 * Switch the window between the normal card and the mini bar, and hand control
 * back only once the switch is over.
 *
 * "Over" is the window's whole transition, not just the form appearing: the
 * next step is free to hide the window, and hiding it mid-transition costs the
 * app its own stale-viewport correction (see TRANSITION_MS). The wait is
 * skipped when the form is already the one asked for, because then no
 * transition is started at all.
 */
async function setForm(ctx, form) {
  const mini = form === 'mini'
  const switching = (await getSettings(ctx.page)).miniMode !== mini
  const startedAt = Date.now()
  await updateSettings(ctx.page, { miniMode: mini })
  // The form's own root, not the clock's: two cases switch forms with clock
  // mode turned off, where no clock area exists to wait for.
  try {
    await ctx.page.waitForSelector(SURFACES[form].formRoot, { timeout: FORM_TIMEOUT_MS })
  } catch (error) {
    const state = await readFormState(ctx.page)
    const miniSized = state.viewport.innerHeight < MINI_HEIGHT_THRESHOLD
    throw new Error(
      `${error.message.split('\n')[0]} — the app has miniMode ${state.miniMode} and the ` +
        `renderer is laid out for ${state.viewport.innerWidth}x${state.viewport.innerHeight}` +
        `${miniSized ? `, under the ${MINI_HEIGHT_THRESHOLD}px the renderer reads as mini-sized` : ''}` +
        ` (.timer ${state.viewport.timer ? 'is' : 'is not'} on screen, .mini-bar ` +
        `${state.viewport.miniBar ? 'is' : 'is not'})`,
      { cause: error }
    )
  }
  if (switching) await sleep(Math.max(0, TRANSITION_MS - (Date.now() - startedAt)))
  ctx.form = form
}

async function setClockMode(page, on) {
  await updateSettings(page, { clockMode: on })
  await sleep(RENDER_MS)
}

// --- instances ---------------------------------------------------------------

const childEnv = () => {
  // Inherited ELECTRON_RUN_AS_NODE would start the binary as plain Node, which
  // cannot resolve the built-in `electron` module the built main script imports.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

const profileNames = () =>
  new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(PROFILE_PREFIX)))

/**
 * `launchApp()` as the other checks use it, plus the throwaway profile it just
 * minted. Two cases need to know that directory: 5.4 brings a second process up
 * on the first one's settings, and 6.4 brings the hidden window back by
 * launching a second instance the way a user would, which the running app
 * answers with `showPopupNear()` through its single-instance lock. The
 * directory is found by diffing the temp dir rather than guessed, and the run
 * refuses to continue if that is ever ambiguous.
 */
async function launchTracked() {
  const before = profileNames()
  const app = await launchApp()
  const added = [...profileNames()].filter((name) => !before.has(name))
  if (added.length !== 1) {
    await app.close()
    throw new Error(
      `expected one new ${PROFILE_PREFIX}* profile under ${os.tmpdir()}, saw ${added.length}`
    )
  }
  const profile = path.join(os.tmpdir(), added[0])
  return {
    page: app.page,
    profile,
    /**
     * The harness never removes its own profile directories and this check
     * launches several instances per run, so each one takes its own with it
     * unless a case still needs the settings inside it.
     */
    async close({ keepProfile = false } = {}) {
      await app.close()
      if (!keepProfile) fs.rmSync(profile, { recursive: true, force: true })
    }
  }
}

/**
 * A launch that keeps the main-process handle, for the two things `launchApp()`
 * cannot do. 5.4 needs a second process on an existing profile — the harness
 * mints a throwaway directory per launch, which is right everywhere else and
 * wrong here, because 5.4 is precisely the question of what survives a restart.
 * 3.9 needs to reach into the main process, both for the elapsed-time seam that
 * arms a phase boundary and for the notification the transition fires. The
 * flags, the font wait and the settle mirror lib.mjs, so an instance from here
 * is the same app under the same conditions.
 */
async function launchDirect({ profile = null, elapsedMs = 0 } = {}) {
  const dir = profile ?? fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX))
  const app = await _electron.launch({
    executablePath: electronExecutable,
    args: [mainScript, `--user-data-dir=${dir}`, '--force-device-scale-factor=1'],
    env: childEnv()
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // Zen Maru Gothic is bundled and loads asynchronously, same as in lib.mjs.
  await page.evaluate(() => document.fonts.ready)
  if (elapsedMs > 0) {
    // The timer lives in the main process, so it is reached through the
    // dev-only seam in src/main/index.ts rather than the page.
    await app.evaluate((_electronApi, ms) => globalThis.__kizamiSimulateElapsed(ms), elapsedMs)
  }
  await sleep(DIRECT_SETTLE_MS)
  return {
    page,
    profile: dir,
    evaluate: (fn, arg) => app.evaluate(fn, arg),
    async close({ keepProfile = false } = {}) {
      await app.close()
      if (!keepProfile) fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Record every desktop notification the app shows, from inside the main
 * process. `notifyTransition` is called synchronously from the engine's
 * `transition` event, so a recorded notification is direct evidence that the
 * phase-change notification really fired — the half of 3.9 that cannot be seen
 * from the page at all. The prototype is patched rather than the class: the
 * built main script imported the binding at load, so replacing `Notification`
 * itself would change nothing, while wrapping `show()` reaches every instance
 * and still calls through to the real implementation.
 *
 * Returns false where the platform has no notification server, in which case
 * there is genuinely nothing to observe and the case says so.
 */
const recordNotifications = (instance) =>
  instance.evaluate(({ Notification }) => {
    globalThis.__kizamiNotifications = []
    if (!Notification.isSupported()) return false
    const show = Notification.prototype.show
    Notification.prototype.show = function record() {
      globalThis.__kizamiNotifications.push({
        title: this.title,
        body: this.body,
        at: Date.now()
      })
      return show.call(this)
    }
    return true
  })

const readNotifications = (instance) =>
  instance.evaluate(() => [...globalThis.__kizamiNotifications])

/**
 * Show a hidden window the way the product does: a second launch on the same
 * profile loses the single-instance lock and quits, and the running instance
 * answers the `second-instance` event with `showPopupNear()`. Resolves with the
 * spawned process's exit code, which must be 0 — anything else means it took
 * the lock instead, and the window was never asked to come back.
 */
function showWindowAgain(profile) {
  const child = spawn(electronExecutable, [mainScript, `--user-data-dir=${profile}`], {
    env: childEnv(),
    stdio: 'ignore'
  })
  return new Promise((resolve, reject) => {
    const guard = globalThis.setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('the second instance never exited; it may have taken the lock'))
    }, SHOW_TIMEOUT_MS)
    child.once('error', (error) => {
      globalThis.clearTimeout(guard)
      reject(error)
    })
    child.once('exit', (code) => {
      globalThis.clearTimeout(guard)
      resolve(code)
    })
  })
}

/**
 * Counters the wake case reads. `ticks` shows how starved the renderer was
 * while the window was away, and `snapshots` is the honest witness that the
 * window really went: the main process only pushes a snapshot while the popup
 * is visible, so the count standing still is the hide, and it moving again is
 * the show.
 */
const installWakeProbe = (page) =>
  page.evaluate(() => {
    const probe = { ticks: 0, snapshots: 0, visibility: [] }
    globalThis.__kizamiWakeProbe = probe
    globalThis.setInterval(() => {
      probe.ticks += 1
    }, 1000)
    globalThis.kizami.onSnapshot(() => {
      probe.snapshots += 1
    })
    document.addEventListener('visibilitychange', () =>
      probe.visibility.push(document.visibilityState)
    )
  })

const readWakeProbe = (page) => page.evaluate(() => ({ ...globalThis.__kizamiWakeProbe }))

/** Hold the renderer's main thread, so nothing in the page can keep up. */
const stallRenderer = (page, ms) =>
  page.evaluate((budget) => {
    const until = globalThis.performance.now() + budget
    while (globalThis.performance.now() < until) {
      /* starve the page the way a suspended or throttled renderer would */
    }
  }, ms)

const installFault = async (ctx, page) => {
  if (ctx.fault !== null && ctx.fault.install !== undefined) await ctx.fault.install(page)
}

/**
 * The same, for a fault that has to break the main process rather than the
 * page. Installed after the notification recorder, so a fault that swallows a
 * notification really does hide it from the recorder too.
 */
const installMainFault = async (ctx, instance) => {
  if (ctx.fault !== null && ctx.fault.installMain !== undefined)
    await ctx.fault.installMain(instance)
}

// --- the cases ---------------------------------------------------------------

/**
 * With no comparison zone the clock is still 007's: one bare row, no label, no
 * shift indication, the day-progress strip and the mini bar's date intact, and
 * the control back to the normal window still there (2.3). Tasks 4.1 and 4.2
 * measured this against a pre-feature build during development; what is pinned
 * here is the structure that made those measurements come out equal.
 */
async function singleRowCase(ctx, unit) {
  await updateSettings(ctx.page, { secondaryTimeZone: null })

  for (const format of CLOCK_FORMATS) {
    await updateSettings(ctx.page, { clockFormat: format })
    for (const form of ['normal', 'mini']) {
      const surface = SURFACES[form]
      await setForm(ctx, form)
      await waitForRows(ctx.page, surface, 1)
      await sleep(RENDER_MS)

      const reading = await readClockStamped(ctx.page, surface)
      checkDisplay(unit, reading, {
        hours: 0,
        zone: null,
        format,
        rows: 1,
        surface,
        requirements: { clock: '2.3', blocks: '2.3', date: '2.3' }
      })

      if (reading.rowsClass.includes(surface.pair)) {
        fail(unit, '2.3', `${format} ${surface.name}: the rows carry the paired treatment`)
      }
      if (reading.rowsClass.includes('--shifted')) {
        fail(unit, '2.3', `${format} ${surface.name}: the rows carry the shifted treatment`)
      }
      // The card only renders a label when there is a second row to tell apart;
      // the bar always renders the label line, so there it must be empty and
      // take no space at all, which is what keeps the bar 007's.
      const labelText = reading.labels.join('')
      if (form === 'normal' && reading.labels.length !== 0) {
        fail(unit, '2.3', `${format} ${surface.name}: the lone row is labelled "${labelText}"`)
      }
      if (form === 'mini') {
        if (reading.labels.length !== 1 || labelText !== '') {
          fail(unit, '2.3', `${format} ${surface.name}: the lone cell is labelled "${labelText}"`)
        }
        const box = reading.labelBoxes[0]
        if (box !== undefined && (box.width !== 0 || box.height !== 0)) {
          fail(
            unit,
            '2.3',
            `${format} ${surface.name}: the empty label line takes ` +
              `${box.width}x${box.height}px instead of collapsing`
          )
        }
        if (reading.hasExpand !== true) {
          fail(unit, '2.3', `${format} ${surface.name}: the expand button is gone`)
        }
      }
      if (reading.shift !== '') {
        fail(unit, '2.3', `${format} ${surface.name}: an unshifted clock reads "${reading.shift}"`)
      }
      if (reading.shiftBox !== null && reading.shiftBox.width !== 0) {
        fail(
          unit,
          '2.3',
          `${format} ${surface.name}: the empty shift indication is ` +
            `${reading.shiftBox.width}px wide instead of collapsing`
        )
      }
      note(
        unit,
        `${format} ${surface.name.padEnd(13)} ${reading.times.join(' / ').padEnd(9)} ` +
          `${reading.blocks.filled}/${reading.blocks.count} blocks` +
          `${reading.date === null ? '' : `  ${reading.date}`}`
      )
    }
  }
}

/**
 * Scrolling the clock is a display action: the timer in the main process keeps
 * its phase, its session, its running state and its countdown across a burst of
 * input on either surface (3.9).
 */
async function scrollIsolationCase(ctx, unit) {
  const before = await readSnapshot(ctx.page)
  if (!before.running) {
    fail(unit, '3.9', 'the timer is not running, so there is nothing to leave alone')
    return
  }

  for (const form of ['normal', 'mini']) {
    const surface = SURFACES[form]
    await setForm(ctx, form)
    await pointAt(ctx.page, surface.area)
    for (let notch = 1; notch <= SCROLL_NOTCHES; notch += 1) await wheelNotch(ctx.page, 1)
    // The input has to demonstrably land, or "the timer did not move" is a
    // statement about nothing.
    if (!(await expectShift(unit, ctx.page, surface, SCROLL_NOTCHES, '3.9'))) return
    await resetShift(ctx.page, surface)
    note(
      unit,
      `${surface.name.padEnd(13)} ${SCROLL_NOTCHES} notches took the display to ` +
        `${shiftLabel(SCROLL_NOTCHES)} and back`
    )
  }

  await setForm(ctx, 'normal')
  const after = await readSnapshot(ctx.page)
  checkTimerUntouched(unit, '3.9', before, after, 'scrolling the clock')
  note(
    unit,
    `timer ${before.phase} ${before.session}, ${before.remainingSec}s -> ` +
      `${after.remainingSec}s over ${after.after - before.before}ms`
  )
}

/**
 * The schedule itself, not just the counters: a phase that is about to end ends
 * on time, and fires its notification, while the clock is being scrolled
 * continuously. `notifyTransition` runs synchronously off the engine's
 * `transition` event in the main process, so the recorded notification is 3.9's
 * "notification schedule" observed directly rather than inferred.
 */
async function phaseAdvanceCase(ctx, unit) {
  const surface = SURFACES.normal
  // A dedicated instance: the timer can only be put near a phase boundary at
  // launch, through the dev-only elapsed-time seam in the main process.
  const armed = await launchDirect({ elapsedMs: WORK_PHASE_MS - TRANSITION_LEAD_MS })
  try {
    const { page } = armed
    await updateSettings(page, {
      language: LANGUAGE,
      clockMode: true,
      clockFormat: CLOCK_FORMAT,
      miniMode: false,
      secondaryTimeZone: ZONE
    })
    await waitForRows(page, surface, 2)
    const notifications = await recordNotifications(armed)
    await installFault(ctx, page)
    await installMainFault(ctx, armed)

    const start = await readSnapshot(page)
    if (!start.running || start.phase !== 'work') {
      fail(unit, '3.9', `the armed timer is ${start.phase}, running=${start.running}`)
      return
    }
    if (start.totalSec * 1000 !== WORK_PHASE_MS) {
      fail(
        unit,
        '3.9',
        `the work phase is ${start.totalSec}s, but DEFAULT_SETTINGS says ${WORK_PHASE_MS / 1000}s`
      )
      return
    }
    // `remainingSec` is rounded up, so the true boundary sits inside this window.
    const boundaryFrom = start.before + (start.remainingSec - 1) * 1000
    const boundaryTo = start.after + start.remainingSec * 1000
    if (boundaryTo - Date.now() > TRANSITION_LEAD_MS + WAIT_MS) {
      fail(
        unit,
        '3.9',
        `the armed phase still has ${start.remainingSec}s to run, ` +
          `expected about ${TRANSITION_LEAD_MS / 1000}s`
      )
      return
    }

    await pointAt(page, surface.area)
    let scrolls = 0
    let answered = 0
    let hours = 0
    let observed = null
    const deadline = boundaryTo + 1000 + TRANSITION_SLACK_MS
    while (observed === null && Date.now() < deadline) {
      // Alternating, so the clamp is never reached and every step is a real
      // input the display has to answer.
      const direction = scrolls % 2 === 0 ? 1 : -1
      await wheelNotch(page, direction)
      hours += direction
      scrolls += 1
      // Every notch is confirmed on the display as it goes, so "the timer was
      // untouched while the clock was scrolled" is a statement about a clock
      // that was demonstrably being scrolled the whole time.
      if (await waitForShift(page, surface, hours, ANSWER_MS)) answered += 1
      const snapshot = await readSnapshot(page)
      if (snapshot.phase !== 'work') observed = snapshot
      else await sleep(TRANSITION_POLL_MS)
    }

    if (observed === null) {
      const stuck = await readSnapshot(page)
      fail(
        unit,
        '3.9',
        `the phase was still ${stuck.phase} with ${stuck.remainingSec}s left ` +
          `${Date.now() - boundaryTo}ms past its boundary, after ${scrolls} scroll steps`
      )
      return
    }
    if (observed.phase !== 'shortBreak' || observed.session !== start.session) {
      fail(
        unit,
        '3.9',
        `the timer went to ${observed.phase} session ${observed.session}, ` +
          `expected shortBreak session ${start.session}`
      )
    }
    const late = observed.after - boundaryTo
    const early = boundaryFrom - observed.before
    if (early > 0) {
      fail(unit, '3.9', `the phase changed ${early}ms before its boundary`)
    }
    if (late > 1000 + TRANSITION_SLACK_MS) {
      fail(unit, '3.9', `the phase changed ${late}ms after its boundary, past the allowed slack`)
    }
    if (answered !== scrolls) {
      fail(
        unit,
        '3.9',
        `the display answered ${answered} of ${scrolls} scroll steps, so the phase did not ` +
          'run out under continuous scrolling after all'
      )
    }
    note(
      unit,
      `work -> ${observed.phase} session ${observed.session} within ${late}ms of its boundary, ` +
        `under ${scrolls} scroll steps (${answered} answered on the display)`
    )

    // The notification is read only after the transition was seen, and
    // `notifyTransition` runs inside the very event that changed the phase, so
    // anything the transition fired is already recorded.
    if (notifications !== true) {
      note(unit, 'no notification server here, so the schedule rests on the phase change alone')
      return
    }
    const shown = await readNotifications(armed)
    if (shown.length !== 1) {
      fail(
        unit,
        '3.9',
        `the phase change fired ${plural(shown.length, 'notification')} while the clock was ` +
          'being scrolled, expected exactly 1'
      )
      return
    }
    const [fired] = shown
    if (fired.title !== WORK_END_NOTIFICATION.title || fired.body !== WORK_END_NOTIFICATION.body) {
      fail(
        unit,
        '3.9',
        `the notification read "${fired.title}" / "${fired.body}", expected ` +
          `"${WORK_END_NOTIFICATION.title}" / "${WORK_END_NOTIFICATION.body}"`
      )
    }
    if (fired.at < boundaryFrom || fired.at > boundaryTo + 1000 + TRANSITION_SLACK_MS) {
      fail(
        unit,
        '3.9',
        `the notification fired ${fired.at - boundaryTo}ms from the phase boundary, ` +
          'outside the window the schedule allows'
      )
    }
    note(
      unit,
      `notified "${fired.title}" / "${fired.body}" ${fired.at - boundaryTo}ms from that boundary`
    )
  } finally {
    await armed.close()
  }
}

/**
 * The other half of the timer's isolation: the display going back to now on its
 * own is a display action too, so the timer is unchanged across it (5.5).
 */
async function returnIsolationCase(ctx, unit) {
  const surface = SURFACES.normal
  await pointAt(ctx.page, surface.area)

  const before = await readSnapshot(ctx.page)
  if (!before.running) {
    fail(unit, '5.5', 'the timer is not running, so there is nothing to leave alone')
    return
  }
  await wheelNotch(ctx.page, 1)
  if (!(await expectShift(unit, ctx.page, surface, 1, '5.5'))) return
  const shiftedAt = Date.now()
  // Give the wait its full run; the point is that expiry itself is inert.
  if (!(await expectShift(unit, ctx.page, surface, 0, '5.5', SHIFT_RESET_MS + WAIT_MS * 2))) {
    return
  }
  const returned = Date.now() - shiftedAt

  const after = await readSnapshot(ctx.page)
  checkTimerUntouched(unit, '5.5', before, after, 'the automatic return')
  note(
    unit,
    `the display returned to now ${returned}ms after the scroll; timer ` +
      `${before.remainingSec}s -> ${after.remainingSec}s over ${after.after - before.before}ms`
  )
}

/**
 * Outside clock mode there is nothing to shift, so a scroll over the timer must
 * leave both the view and the timer exactly where they were (3.10).
 */
async function timerModeScrollCase(ctx, unit) {
  await setClockMode(ctx.page, false)

  for (const form of ['normal', 'mini']) {
    await setForm(ctx, form)
    const target = form === 'mini' ? '.mini-bar__time' : '.timer__card'
    await ctx.page.waitForSelector(target)
    await sleep(RENDER_MS)

    const before = await readTimerView(ctx.page, form)
    const beforeSnapshot = await readSnapshot(ctx.page)
    await pointAt(ctx.page, target)
    for (let notch = 1; notch <= SCROLL_NOTCHES; notch += 1) {
      await wheelNotch(ctx.page, notch % 2 === 0 ? -1 : 1)
    }
    await sleep(RENDER_MS)
    const after = await readTimerView(ctx.page, form)
    const afterSnapshot = await readSnapshot(ctx.page)

    const where = form === 'mini' ? 'the mini timer bar' : 'the timer card'
    if (after.clockCard || after.clockCells > 0) {
      fail(unit, '3.10', `scrolling ${where} put a clock on screen`)
    }
    if (after.shifts > 0 || after.rowLabels > 0) {
      fail(
        unit,
        '3.10',
        `scrolling ${where} produced ${after.shifts} shift indications and ` +
          `${after.rowLabels} row labels`
      )
    }
    if (after.phase !== before.phase || after.session !== before.session) {
      fail(
        unit,
        '3.10',
        `scrolling ${where} changed what it says about the phase, from ` +
          `"${headerText(before)}" to "${headerText(after)}"`
      )
    }
    if (after.scrollY !== 0) {
      fail(unit, '3.10', `scrolling ${where} scrolled the window to ${after.scrollY}`)
    }
    const wanted = timerTextCandidates(afterSnapshot)
    if (after.time === null || !wanted.has(after.time)) {
      fail(
        unit,
        '3.10',
        `${where} reads ${after.time} after the scroll, but the timer says ${listed(wanted)}`
      )
    }
    // Exactly what the timer says, not "within one": the session strip is ten
    // blocks wide, so a block of slack is a tenth of the phase, and early in a
    // work phase both numbers are 0 — a tolerance there compares nothing with
    // nothing. The one legitimate difference is a block boundary falling
    // between the two reads, which the snapshots either side of the scroll
    // make visible rather than assumed.
    if (after.blocks.count !== PROGRESS_BLOCKS) {
      fail(
        unit,
        '3.10',
        `${where} shows a ${after.blocks.count}-block session strip, expected ${PROGRESS_BLOCKS}`
      )
    }
    const crossed = beforeSnapshot.filledBlocks !== afterSnapshot.filledBlocks
    if (after.blocks.filled !== afterSnapshot.filledBlocks && !crossed) {
      fail(
        unit,
        '3.10',
        `${where} shows ${after.blocks.filled} filled blocks, ` +
          `but the timer says ${afterSnapshot.filledBlocks}`
      )
    } else if (crossed) {
      note(
        unit,
        `${where.padEnd(19)} crossed a block boundary during the scroll ` +
          `(${beforeSnapshot.filledBlocks} -> ${afterSnapshot.filledBlocks}), so the strip's ` +
          `${after.blocks.filled} filled is compared only for the count`
      )
    }
    checkTimerUntouched(unit, '3.10', beforeSnapshot, afterSnapshot, `scrolling ${where}`)
    note(
      unit,
      `${where.padEnd(19)} ${before.time} -> ${after.time}, ` +
        `${after.blocks.filled}/${after.blocks.count} blocks, phase "${headerText(after)}"`
    )
  }

  await setForm(ctx, 'normal')
  await setClockMode(ctx.page, true)
  await waitForRows(ctx.page, SURFACES.normal, 2)
}

/** Leaving clock mode discards the shift, so coming back shows now (5.3). */
async function leaveClockModeCase(ctx, unit) {
  for (const form of ['normal', 'mini']) {
    const surface = SURFACES[form]
    await setForm(ctx, form)
    await resetShift(ctx.page, surface)
    await pressShift(ctx.page, surface, 1, SAMPLE_SHIFT_HOURS)
    if (!(await expectShift(unit, ctx.page, surface, SAMPLE_SHIFT_HOURS, '5.3'))) return
    const shiftedAt = Date.now()

    await setClockMode(ctx.page, false)
    // The clock area, not the form's root: the bar itself stays on screen in
    // timer mode, and only what clock mode draws inside it goes away.
    await ctx.page.waitForSelector(surface.area, { state: 'detached', timeout: WAIT_MS })
    await setClockMode(ctx.page, true)
    await waitForRows(ctx.page, surface, 2)
    const elapsed = Date.now() - shiftedAt

    const reading = await readClockStamped(ctx.page, surface)
    if (reading.shift !== '') {
      fail(unit, '5.3', `${surface.name}: re-entering clock mode still shows "${reading.shift}"`)
    }
    if (reading.rowsClass.includes('--shifted')) {
      fail(unit, '5.3', `${surface.name}: re-entering clock mode kept the shifted treatment`)
    }
    checkDisplay(unit, reading, {
      hours: 0,
      zone: ZONE,
      format: CLOCK_FORMAT,
      rows: 2,
      surface,
      requirements: { clock: '5.3', blocks: '5.3', date: '5.3' }
    })
    note(
      unit,
      `${surface.name.padEnd(13)} ${describeRace('the round trip out of clock mode', elapsed)}`
    )
    note(unit, `${''.padEnd(13)} back on ${reading.times.join(' / ')} with no shift amount`)
  }

  await setForm(ctx, 'normal')
}

/**
 * A restart starts unshifted (5.4). The comparison zone has to survive it and
 * the shift has to not, so both are read back from the process that comes up on
 * the first one's profile.
 */
async function restartCase(ctx, unit) {
  const surface = SURFACES.normal
  const instance = await launchTracked()
  let closed = false
  try {
    await updateSettings(instance.page, {
      language: LANGUAGE,
      clockMode: true,
      clockFormat: CLOCK_FORMAT,
      miniMode: false,
      secondaryTimeZone: ZONE
    })
    await waitForRows(instance.page, surface, 2)
    await pressShift(instance.page, surface, 1, SAMPLE_SHIFT_HOURS)
    if (!(await expectShift(unit, instance.page, surface, SAMPLE_SHIFT_HOURS, '5.4'))) return
    const shiftedAt = Date.now()
    const stored = await getSettings(instance.page)

    // Go down with the shift still showing, so what comes back can only be a
    // restored one.
    await instance.close({ keepProfile: true })
    closed = true

    const restarted = await launchDirect({ profile: instance.profile })
    try {
      await installFault(ctx, restarted.page)
      await waitForRows(restarted.page, surface, 2)
      await sleep(RENDER_MS)
      const settings = await getSettings(restarted.page)
      if (settings.secondaryTimeZone !== stored.secondaryTimeZone) {
        fail(
          unit,
          '5.4',
          `the comparison zone did not survive the restart: ` +
            `${stored.secondaryTimeZone} -> ${settings.secondaryTimeZone}`
        )
      }
      const reading = await readClockStamped(restarted.page, surface)
      if (reading.shift !== '') {
        fail(unit, '5.4', `the restarted app comes up showing "${reading.shift}"`)
      }
      if (reading.rowsClass.includes('--shifted')) {
        fail(unit, '5.4', 'the restarted app comes up with the shifted treatment')
      }
      checkDisplay(unit, reading, {
        hours: 0,
        zone: ZONE,
        format: CLOCK_FORMAT,
        rows: 2,
        surface,
        requirements: { clock: '5.4', blocks: '5.4', date: '5.4' }
      })
      note(unit, describeRace('the restart', Date.now() - shiftedAt))
      note(
        unit,
        `${settings.secondaryTimeZone} survived; the ${shiftLabel(SAMPLE_SHIFT_HOURS)} did not, ` +
          `rows ${reading.times.join(' / ')}`
      )
    } finally {
      // The relaunch shares the first instance's profile, so closing it takes
      // the directory the first one left behind with it.
      await restarted.close()
    }
  } finally {
    if (!closed) await instance.close()
  }
}

/**
 * The window is tray-resident, so it spends most of its life away. Hide it,
 * starve the renderer for long enough that a display which accumulated ticks
 * would come back visibly behind, bring it back the way the product does, and
 * read everything at once (6.4).
 */
async function hideAndShowCase(ctx, unit) {
  for (const form of ['normal', 'mini']) {
    const surface = SURFACES[form]
    await setForm(ctx, form)
    await resetShift(ctx.page, surface)
    await waitForRows(ctx.page, surface, 2)

    const before = await readClockStamped(ctx.page, surface)
    checkDisplay(unit, before, {
      hours: 0,
      zone: ZONE,
      format: CLOCK_FORMAT,
      rows: 2,
      surface,
      requirements: { clock: '6.4', blocks: '6.4', date: '6.4' }
    })

    const atHide = await readWakeProbe(ctx.page)
    await ctx.page.evaluate(() => globalThis.kizami.hideWindow())
    const hiddenAt = Date.now()
    await sleep(HIDE_SETTLE_MS)
    await stallRenderer(ctx.page, STALL_MS)
    await sleep(DRAIN_MS)
    const stalled = await readWakeProbe(ctx.page)

    let exitCode
    try {
      exitCode = await showWindowAgain(ctx.profile)
    } catch (error) {
      fail(unit, '6.4', `the window could not be brought back: ${error.message}`)
      return
    }
    if (exitCode !== 0) {
      fail(unit, '6.4', `the second instance exited with ${exitCode} instead of handing off`)
      return
    }
    try {
      await ctx.page.waitForFunction(
        (seen) => globalThis.__kizamiWakeProbe.snapshots > seen,
        stalled.snapshots,
        { timeout: SHOW_TIMEOUT_MS, polling: 20 }
      )
    } catch {
      fail(unit, '6.4', 'the window never started receiving updates again after the show')
      return
    }
    const hiddenMs = Date.now() - hiddenAt

    const after = await readClockStamped(ctx.page, surface)
    checkDisplay(unit, after, {
      hours: 0,
      zone: ZONE,
      format: CLOCK_FORMAT,
      rows: 2,
      surface,
      lagMs: WAKE_LAG_MS,
      requirements: { clock: '6.4', blocks: '6.4', date: '6.4' }
    })

    // The main process pushes a snapshot only while the popup is visible, so a
    // count that kept growing means the window never actually went away and the
    // reading above proves nothing.
    if (stalled.snapshots !== atHide.snapshots) {
      fail(
        unit,
        '6.4',
        `the window kept receiving updates while it was supposed to be hidden ` +
          `(${stalled.snapshots - atHide.snapshots} in ${hiddenMs}ms), so it never went away`
      )
    }
    const ticks = stalled.ticks - atHide.ticks
    const starved = Math.round(hiddenMs / 1000) - ticks
    note(
      unit,
      `${surface.name.padEnd(13)} hidden ${hiddenMs}ms, the renderer ticked ` +
        `${plural(ticks, 'time')} (${starved}s of ticks missed)`
    )
    note(
      unit,
      `${''.padEnd(13)} back on ${after.times.join(' / ')}, ` +
        `${after.blocks.filled}/${after.blocks.count} blocks` +
        `${after.date === null ? '' : `, ${after.date}`}`
    )
  }

  await setForm(ctx, 'normal')
}

/**
 * The day-progress bar and the date describe the real present, so shifting the
 * rows past midnight in either direction must leave both where they were
 * (6.1, 6.2).
 */
async function shiftedAnchorsCase(ctx, unit) {
  for (const form of ['normal', 'mini']) {
    const surface = SURFACES[form]
    await setForm(ctx, form)
    await waitForRows(ctx.page, surface, 2)

    for (const direction of [1, -1]) {
      await resetShift(ctx.page, surface)
      // The smallest shift that takes the displayed row over midnight, so the
      // rows are on another date while the anchors must not be.
      const hour = new Date().getHours()
      const hours = direction > 0 ? 24 - hour : -(hour + 1)
      if (Math.abs(hours) > SHIFT_HOURS_LIMIT) {
        fail(
          unit,
          '6.1',
          `crossing midnight needs ${hours}h, past the +/-${SHIFT_HOURS_LIMIT} clamp`
        )
        return
      }
      await pressShift(ctx.page, surface, direction, Math.abs(hours))
      if (!(await expectShift(unit, ctx.page, surface, hours, '6.1'))) return

      const reading = await readClockStamped(ctx.page, surface)
      checkDisplay(unit, reading, {
        hours,
        zone: ZONE,
        format: CLOCK_FORMAT,
        rows: 2,
        surface,
        requirements: { clock: '6.1', blocks: '6.1', date: '6.2' }
      })
      // The reading is only about a shifted display if it was still shifted.
      if (reading.shift !== shiftLabel(hours)) {
        fail(unit, '6.1', `the amount read "${reading.shift}" at the moment of the measurement`)
      }
      note(
        unit,
        `${surface.name.padEnd(13)} ${shiftLabel(hours).padStart(4)}  ` +
          `${reading.times.join(' / ').padEnd(19)} ` +
          `${reading.blocks.filled}/${reading.blocks.count} blocks` +
          `${reading.date === null ? '' : `  ${reading.date}`}`
      )
    }
    await resetShift(ctx.page, surface)
  }

  await setForm(ctx, 'normal')
}

const CASES = [
  { id: 'single-row', requirements: '2.3', run: singleRowCase },
  { id: 'scroll-isolation', requirements: '3.9', run: scrollIsolationCase },
  { id: 'phase-advance', requirements: '3.9', run: phaseAdvanceCase, ownsInstance: true },
  { id: 'return-isolation', requirements: '5.5', run: returnIsolationCase },
  { id: 'timer-mode-scroll', requirements: '3.10', run: timerModeScrollCase },
  { id: 'leave-clock-mode', requirements: '5.3', run: leaveClockModeCase },
  { id: 'restart', requirements: '5.4', run: restartCase, ownsInstance: true },
  { id: 'shifted-anchors', requirements: '6.1, 6.2', run: shiftedAnchorsCase },
  { id: 'hide-and-show', requirements: '6.4', run: hideAndShowCase }
]

// --- self-check faults -------------------------------------------------------

/**
 * Each fault breaks the app in a way one assertion is supposed to notice, and
 * names the case and requirement that must catch it. All but one work from
 * inside the page; `silent-transition` has to work from the main process,
 * because a notification never reaches the page at all. The four that call back
 * into `window.kizami` are the honest ones: they make the app really do the
 * forbidden thing rather than only look as if it had. The rewriting faults lean
 * on a MutationObserver callback running in the microtask checkpoint of the
 * task that mutated the DOM, so no later round trip can ever observe the app's
 * own value.
 *
 * A rewriting fault must settle on a fixed value: its own write wakes the
 * observer again, and a rewrite derived from what the element currently reads
 * therefore spins in microtasks and wedges the renderer — where `page.evaluate`
 * has no timeout and the run hangs instead of failing anything.
 */
const FAULTS = [
  {
    id: 'phantom-label',
    why: 'the lone row is labelled as if a comparison zone were set',
    breaks: [{ caseId: 'single-row', requirement: '2.3' }],
    install: (page) =>
      page.evaluate(() => {
        const label = () => {
          const rows = document.querySelector('.timer__rows')
          if (rows !== null && rows.querySelector('.timer__row-label') === null) {
            const span = document.createElement('span')
            span.className = 'timer__row-label'
            span.textContent = 'Home'
            rows.prepend(span)
          }
          for (const line of document.querySelectorAll('.mini-bar__cell-label')) {
            if (line.firstChild === null) line.prepend(document.createTextNode('Home'))
          }
        }
        new globalThis.MutationObserver(label).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        })
        label()
      })
  },
  {
    id: 'uncollapsed-badge',
    why: 'the empty shift indication still takes space',
    breaks: [{ caseId: 'single-row', requirement: '2.3' }],
    install: (page) =>
      page.addStyleTag({
        content:
          '.timer__shift:empty { padding: 4px 8px } .mini-bar__shift:empty { padding-left: 8px }'
      })
  },
  {
    id: 'scroll-skips-phase',
    why: 'scrolling the clock also skips the pomodoro phase',
    breaks: [{ caseId: 'scroll-isolation', requirement: '3.9' }],
    install: (page) =>
      page.evaluate(() => {
        let spent = false
        globalThis.addEventListener(
          'wheel',
          () => {
            if (spent) return
            spent = true
            void globalThis.kizami.skip()
          },
          { capture: true }
        )
      })
  },
  {
    id: 'scroll-pauses-timer',
    why: 'scrolling the clock also pauses the pomodoro timer',
    breaks: [
      { caseId: 'scroll-isolation', requirement: '3.9' },
      { caseId: 'phase-advance', requirement: '3.9' }
    ],
    install: (page) =>
      page.evaluate(() => {
        let spent = false
        globalThis.addEventListener(
          'wheel',
          () => {
            if (spent) return
            spent = true
            void globalThis.kizami.toggle()
          },
          { capture: true }
        )
      })
  },
  {
    id: 'return-pauses-timer',
    why: 'the automatic return also pauses the pomodoro timer',
    breaks: [{ caseId: 'return-isolation', requirement: '5.5' }],
    install: (page) =>
      page.evaluate(() => {
        let seenShift = false
        let spent = false
        const watch = () => {
          const badge = document.querySelector('.timer__shift, .mini-bar__shift')
          if (badge === null) return
          if ((badge.textContent ?? '') !== '') {
            seenShift = true
            return
          }
          if (!seenShift || spent) return
          spent = true
          void globalThis.kizami.toggle()
        }
        new globalThis.MutationObserver(watch).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        })
      })
  },
  {
    id: 'silent-transition',
    why: 'the phase change happens on time but fires no notification',
    breaks: [{ caseId: 'phase-advance', requirement: '3.9' }],
    // The only fault that has to break the main process: the notification never
    // reaches the page, so nothing the page could do would hide it.
    installMain: (instance) =>
      instance.evaluate(({ Notification }) => {
        Notification.prototype.show = function swallow() {}
      })
  },
  {
    id: 'scroll-enters-clock-mode',
    why: 'a scroll in timer mode switches the view to the clock',
    breaks: [{ caseId: 'timer-mode-scroll', requirement: '3.10' }],
    install: (page) =>
      page.evaluate(() => {
        let spent = false
        globalThis.addEventListener(
          'wheel',
          () => {
            if (spent) return
            spent = true
            void globalThis.kizami.updateSettings({ clockMode: true })
          },
          { capture: true }
        )
      })
  },
  {
    id: 'keep-shift-on-return',
    why: 'the shift outlives a trip out of clock mode',
    breaks: [{ caseId: 'leave-clock-mode', requirement: '5.3' }],
    install: (page) =>
      page.evaluate(() => {
        let everInClock = false
        let leftAfterClock = false
        let lastShift = ''
        const watch = () => {
          const inClock = document.querySelector('.timer__card--clock, .mini-bar__clock') !== null
          const badge = document.querySelector('.timer__shift, .mini-bar__shift')
          if (!inClock) {
            if (everInClock) leftAfterClock = true
            return
          }
          everInClock = true
          if (badge === null) return
          if (!leftAfterClock) {
            lastShift = badge.textContent ?? ''
            return
          }
          if ((badge.textContent ?? '') !== lastShift) badge.textContent = lastShift
        }
        new globalThis.MutationObserver(watch).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        })
        watch()
      })
  },
  {
    id: 'restore-shift-on-restart',
    why: 'the restarted app comes up still shifted',
    breaks: [{ caseId: 'restart', requirement: '5.4' }],
    install: (page) =>
      page.evaluate(() => {
        const restore = () => {
          for (const badge of document.querySelectorAll('.timer__shift, .mini-bar__shift')) {
            if ((badge.textContent ?? '') === '') badge.textContent = '+3h'
          }
        }
        new globalThis.MutationObserver(restore).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        })
        restore()
      })
  },
  {
    id: 'stale-clock',
    why: 'the clock keeps showing what it showed before the renderer was starved',
    breaks: [{ caseId: 'hide-and-show', requirement: '6.4' }],
    install: (page) =>
      page.evaluate(() => {
        // Exactly the regression 6.4 forbids: a display that accumulates ticks
        // instead of re-deriving comes back holding the moment it went away.
        let last = Date.now()
        let frozen = null
        globalThis.setInterval(() => {
          const now = Date.now()
          if (frozen === null && now - last > 2000) frozen = new Date(last)
          last = now
        }, 250)
        const pad = (value) => String(value).padStart(2, '0')
        const rewrite = () => {
          if (frozen === null) return
          const row = document.querySelector('.timer__time, .mini-bar__time')
          if (row === null) return
          const withSeconds = (row.textContent ?? '').split(':').length === 3
          const base = `${pad(frozen.getHours())}:${pad(frozen.getMinutes())}`
          const stale = withSeconds ? `${base}:${pad(frozen.getSeconds())}` : base
          if (row.textContent !== stale) row.textContent = stale
        }
        new globalThis.MutationObserver(rewrite).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        })
      })
  },
  {
    id: 'date-follows-shift',
    why: 'the mini bar date moves with the shifted rows',
    breaks: [{ caseId: 'shifted-anchors', requirement: '6.2' }],
    install: (page) =>
      page.evaluate(() => {
        // The moved date is derived from the last unshifted one, never from
        // whatever the element currently reads: a fault that re-moves its own
        // output moves the date again on the mutation it just caused, and the
        // resulting microtask loop wedges the renderer instead of failing a
        // case. The same trap waits for any fault whose rewrite is relative.
        let real = null
        const rewrite = () => {
          const badge = document.querySelector('.mini-bar__shift')
          const date = document.querySelector('.mini-bar__date')
          if (badge === null || date === null) return
          const current = date.textContent ?? ''
          // Captured the first time the bar is on screen, which is before this
          // fault has ever written to it.
          if (real === null) real = current
          if ((badge.textContent ?? '') === '') return
          const moved = real.replace(
            /(\d+)\/(\d+)/,
            (_match, month, day) => `${month}/${Number(day) + 1}`
          )
          if (current !== moved) date.textContent = moved
        }
        new globalThis.MutationObserver(rewrite).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        })
        rewrite()
      })
  },
  {
    id: 'blocks-follow-shift',
    why:
      'the day-progress strip loses a block while the display is shifted ' +
      '(invisible for the first few minutes of the day, when no block is filled yet)',
    breaks: [{ caseId: 'shifted-anchors', requirement: '6.1' }],
    install: (page) =>
      page.evaluate((emptyBlock) => {
        const rewrite = () => {
          const badge = document.querySelector('.timer__shift, .mini-bar__shift')
          if (badge === null || (badge.textContent ?? '') === '') return
          const first = document.querySelector('.timer__block, .mini-bar__block')
          if (first !== null && first.style.background !== emptyBlock) {
            first.style.background = emptyBlock
          }
        }
        new globalThis.MutationObserver(rewrite).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true
        })
        rewrite()
      }, EMPTY_BLOCK)
  }
]

// --- running -----------------------------------------------------------------

/**
 * Bring an instance to clock mode with a comparison zone and a running timer.
 * The timer is started here rather than left idle because most of what this
 * check protects is a statement about a *running* session.
 */
async function prepare(instance, fault) {
  const { page } = instance
  await installWakeProbe(page)
  await updateSettings(page, {
    language: LANGUAGE,
    clockMode: true,
    clockFormat: CLOCK_FORMAT,
    miniMode: false,
    secondaryTimeZone: ZONE
  })
  await waitForRows(page, SURFACES.normal, 2)
  const snapshot = await page.evaluate(() => globalThis.kizami.toggle())
  if (!snapshot.running) throw new Error('the timer would not start')
  const ctx = { page, profile: instance.profile, form: 'normal', fault: fault ?? null }
  await installFault(ctx, page)
  return ctx
}

/** Put the shared instance back to a known state before the next case. */
async function reset(ctx) {
  await updateSettings(ctx.page, {
    language: LANGUAGE,
    clockMode: true,
    clockFormat: CLOCK_FORMAT,
    miniMode: false,
    secondaryTimeZone: ZONE
  })
  ctx.form = 'normal'
  await ctx.page.waitForSelector(SURFACES.normal.root)
  await sleep(TRANSITION_MS)
  await waitForRows(ctx.page, SURFACES.normal, 2)
  await resetShift(ctx.page, SURFACES.normal)
}

/**
 * Run one case against its own report. The report is minted here rather than
 * inside the case, so a case that cannot be driven to the end still hands back
 * everything it found on the way: a sabotaged app can break the setup of a
 * later step, and losing the failure that came before it would read as a pass.
 */
async function runCase(ctx, entry) {
  const unit = startCase(entry.id, entry.requirements)
  try {
    if (entry.ownsInstance !== true) await reset(ctx)
    await entry.run(ctx, unit)
  } catch (error) {
    fail(unit, 'n/a', `the case could not be driven to a verdict: ${error.message}`)
  }
  return unit
}

function reportCase(unit, verbose) {
  const verdict = unit.failures.length === 0 ? 'PASS' : 'FAIL'
  console.log(`\n${unit.id.padEnd(18)} ${unit.requirements.padEnd(10)} ${verdict}`)
  if (verbose || unit.failures.length > 0) {
    for (const line of unit.notes) console.log(`    ${line}`)
  }
  for (const failure of unit.failures) {
    console.log(`    FAIL ${failure.requirement.padEnd(5)} ${failure.message}`)
  }
}

async function runAll(instance, verbose) {
  const ctx = await prepare(instance)
  console.log(
    `clock mode intact check: ${CASES.length} cases, ${LANGUAGE}/${CLOCK_FORMAT}, ` +
      `comparison ${ZONE}, one notch = ${WHEEL_STEP_PX}px, auto-return ${SHIFT_RESET_MS}ms, ` +
      `${STALL_MS}ms renderer stall behind each hide`
  )
  let failing = 0
  for (const entry of CASES) {
    const unit = await runCase(ctx, entry)
    reportCase(unit, verbose)
    if (unit.failures.length > 0) failing += 1
  }
  console.log(`\n${CASES.length} cases, ${failing} failing`)
  return failing === 0
}

/**
 * Prove the assertions still bite. Each fault gets its own instance, so no
 * sabotage leaks into the next one, and only the cases it claims to break are
 * run — a fault that goes unnoticed is itself a failure.
 */
async function runSelfCheck(only, verbose) {
  const faults = only === null ? FAULTS : FAULTS.filter((fault) => fault.id === only)
  if (faults.length === 0) {
    console.error(`Unknown fault "${only}". Known: ${FAULTS.map((f) => f.id).join(', ')}`)
    return false
  }
  console.log(`--self-check: ${plural(faults.length, 'fault')}, each against a fresh instance`)

  let missed = 0
  for (const fault of faults) {
    console.log(`\n--- ${fault.id}: ${fault.why}`)
    // Cases that launch their own instances need no shared one, so it is only
    // brought up when a case actually asks for it — and it is kept in its own
    // variable, so a case that owns an instance cannot leave a later shared
    // case running against a context with no page.
    let instance = null
    let shared = null
    try {
      for (const expectation of fault.breaks) {
        const entry = CASES.find((candidate) => candidate.id === expectation.caseId)
        let ctx
        if (entry.ownsInstance === true) {
          ctx = { page: null, profile: null, form: 'normal', fault }
        } else {
          if (instance === null) {
            instance = await launchTracked()
            shared = await prepare(instance, fault)
          }
          ctx = shared
        }
        const unit = await runCase(ctx, entry)
        const caught = unit.failures.some(
          (failure) => failure.requirement === expectation.requirement
        )
        console.log(
          `    ${expectation.caseId.padEnd(18)} ${expectation.requirement.padEnd(5)} ` +
            `${caught ? 'caught' : 'MISSED'}`
        )
        if (verbose || !caught) {
          for (const failure of unit.failures) {
            console.log(`      reported ${failure.requirement}: ${failure.message}`)
          }
        }
        if (!caught) missed += 1
      }
    } finally {
      if (instance !== null) await instance.close()
    }
  }
  console.log(`\n${plural(faults.length, 'fault')} exercised, ${missed} not caught`)
  return missed === 0
}

async function main() {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const selfCheckArg = args.find((arg) => arg === '--self-check' || arg.startsWith('--self-check='))
  const unknown = args.filter((arg) => arg !== '--verbose' && arg !== selfCheckArg)
  if (unknown.length > 0) {
    console.error(`Unknown argument "${unknown[0]}". Usage: [--verbose] [--self-check[=fault]]`)
    process.exitCode = 1
    return
  }

  // Checked here as well as inside launchApp(), so the commonest mistake gets
  // the fix rather than a launch failure's stack.
  if (!fs.existsSync(mainScript)) {
    console.error(`${mainScript} is missing.`)
    console.error('This check drives the built app, so run `npm run build` first.')
    process.exitCode = 1
    return
  }

  if (selfCheckArg !== undefined) {
    const only = selfCheckArg.includes('=') ? selfCheckArg.split('=')[1] : null
    try {
      if (!(await runSelfCheck(only, verbose))) process.exitCode = 1
    } catch (error) {
      console.error(error.message)
      console.error('If this session has no X display, prefix the command with `xvfb-run -a`.')
      process.exitCode = 1
    }
    return
  }

  let instance
  try {
    instance = await launchTracked()
  } catch (error) {
    console.error(error.message)
    console.error('If this session has no X display, prefix the command with `xvfb-run -a`.')
    process.exitCode = 1
    return
  }

  try {
    if (!(await runAll(instance, verbose))) process.exitCode = 1
  } finally {
    await instance.close()
  }
}

await main()
