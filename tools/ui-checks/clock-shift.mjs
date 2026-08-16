// Drives clock mode's shift interaction end to end against the built app.
// Everything here goes through Chromium's real input pipeline — page.mouse.wheel
// and page.keyboard.press — rather than a synthetic dispatchEvent, because half
// of what can break lives outside React: the mini bar's drag region swallowing
// wheel events, the ctrl+wheel zoom guard, focus never reaching the card. The
// expected times, offsets and shift labels are all re-derived here from the zone
// ids and the constants in src/shared, never read back from the app, so a
// display that agrees with itself but not with the world still fails.
// See tools/ui-checks/README.md for usage.
import fs from 'node:fs'
import path from 'node:path'
import { launchApp, repoRoot, sleep } from '../demo-capture/lib.mjs'

/**
 * Read a numeric `export const` out of a source file. The check has to predict
 * the range end, the notch size and the auto-return wait, and hardcoding them here
 * would let the two drift apart silently. It reads the source rather than the
 * bundle, so a run against a stale `out/` compares against the wrong numbers —
 * which is why a fresh `npm run build` is a prerequisite.
 */
function readNumericConstant(relativePath, name) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
  const match = new RegExp(`export const ${name} = ([\\d_]+)`).exec(source)
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

const SHIFT_RESET_MS = readNumericConstant('src/shared/clock.ts', 'SHIFT_RESET_MS')
const SHIFT_HOURS_LIMIT = readNumericConstant('src/shared/clock.ts', 'SHIFT_HOURS_LIMIT')
const WHEEL_STEP_PX = readNumericConstant('src/shared/wheel-steps.ts', 'WHEEL_STEP_PX')

/** Requirement 3.8's budget, from the input to the changed readout. */
const UPDATE_BUDGET_MS = 200

/** Interface language the run is pinned to, so the labels are predictable. */
const LANGUAGE = 'en'

/** Both languages, because 7.2's accessible name is built from localized text. */
const LANGUAGES = ['en', 'ja']

/** `hh:mm`: a minute-granular readout is the quietest thing to poll on. */
const CLOCK_FORMAT = 'hhmm'

/** Whole-hour offset from most home zones — the ordinary case. */
const ZONE_WHOLE_HOUR = 'America/New_York'

/**
 * India is 30 minutes off the hour grid, so an offset check that passes for
 * both zones cannot be quietly hour-quantized.
 */
const ZONE_HALF_HOUR = 'Asia/Kolkata'

/** How many scroll-to-update samples each surface contributes. */
const DELAY_SAMPLES = 5

/** How long a shift is given to appear before the display is called wrong. */
const SHIFT_TIMEOUT_MS = 2000

/** Time for a mode change (mini mode also resizes the window) to settle. */
const TRANSITION_MS = 500

/** Time for a settings change to reach the renderer and be laid out. */
const RENDER_MS = 80

/**
 * A rendered row can be up to one display tick old, plus the round trip that
 * read it. The expected home time is therefore a small set of minutes rather
 * than one, so a read that straddles a minute boundary is not a failure.
 */
const RENDER_LAG_MS = 1500

/**
 * Slack on top of the auto-return wait. setTimeout never fires early, so the
 * measured wait can only run long; this is sized for a loaded machine rather
 * than for the app.
 */
const AUTO_RETURN_SLACK_MS = 5000

/** How far below the nominal wait an auto-return counts as premature. */
const AUTO_RETURN_EARLY_MS = 500

/** Fraction of the wait after which the restart input lands (5.2). */
const RESTART_INPUT_FRACTION = 0.6

/** How far past the original expiry the restarted wait is inspected (5.2). */
const RESTART_PROBE_MS = 1500

/** Above this share of the wait, a window-form switch is too slow to conclude. */
const SWITCH_SAFE_FRACTION = 0.7

const HOUR_MS = 3_600_000
const MINUTES_PER_DAY = 1440

/** The two shift surfaces (3.6), each named by the classes it renders. */
const SURFACES = {
  normal: {
    form: 'normal',
    name: 'normal window',
    area: '.timer__card--clock',
    shift: '.timer__shift',
    time: '.timer__time',
    label: '.timer__row-label'
  },
  mini: {
    form: 'mini',
    name: 'mini bar',
    area: '.mini-bar__clock',
    shift: '.mini-bar__shift',
    time: '.mini-bar__time',
    label: '.mini-bar__cell-label'
  }
}

const HOUR_UNIT = readMessage(LANGUAGE, 'clock.hourUnit')

/**
 * What the shift badge must read, rebuilt here from the sign and the unit
 * rather than imported, so a regression in `formatShiftLabel` shows up as a
 * mismatch instead of cancelling out.
 */
const shiftLabel = (hours) =>
  hours === 0 ? '' : `${hours > 0 ? '+' : '-'}${Math.abs(hours)}${HOUR_UNIT}`

const RANGE_END_LABEL = shiftLabel(SHIFT_HOURS_LIMIT)

const ms = (value) => `${value.toFixed(1)}ms`

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

const sleepUntil = (deadline) => sleep(Math.max(0, deadline - Date.now()))

const nextFrame = (page) =>
  page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(resolve)))

const updateSettings = (page, patch) =>
  page.evaluate((next) => globalThis.kizami.updateSettings(next), patch)

// --- independent time arithmetic -------------------------------------------

/** Minutes since midnight in an `hh:mm` or `hh:mm:ss` readout. */
function minuteOfDay(text) {
  const [hours, minutes] = text.split(':')
  return Number(hours) * 60 + Number(minutes)
}

/** Canonical form for a difference of two times of day: (-720, 720]. */
function wrapHalfDay(minutes) {
  return (((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY + 720) % MINUTES_PER_DAY) - 720
}

const zoneFormatters = new Map()

function zoneFormatter(zone) {
  const cached = zoneFormatters.get(zone)
  if (cached !== undefined) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit'
  })
  zoneFormatters.set(zone, formatter)
  return formatter
}

/**
 * Minutes `zone` is ahead of this machine's zone at `instant`, computed from
 * the zone id in this process. It is deliberately not read back from the app:
 * the whole point of 3.2 is that the gap between the rows is the world's
 * offset, not whatever the renderer happened to compute.
 */
function zoneOffsetMinutes(instant, zone) {
  const parts = zoneFormatter(zone).formatToParts(instant)
  const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const there = value('hour') * 60 + value('minute')
  const here = instant.getHours() * 60 + instant.getMinutes()
  return wrapHalfDay(there - here)
}

/**
 * Every home time the display could legitimately be showing for `hours` of
 * shift, given when the reading was taken and how stale a render may be.
 */
function homeMinuteCandidates(reading, hours) {
  const candidates = new Set()
  const last = reading.after + hours * HOUR_MS
  for (let at = reading.before - RENDER_LAG_MS + hours * HOUR_MS; at < last; at += 1000) {
    const moment = new Date(at)
    candidates.add(moment.getHours() * 60 + moment.getMinutes())
  }
  const end = new Date(last)
  candidates.add(end.getHours() * 60 + end.getMinutes())
  return candidates
}

const asClock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

// --- case bookkeeping -------------------------------------------------------

function startCase(id, requirements) {
  return { id, requirements, failures: [], notes: [] }
}

function fail(unit, requirement, message) {
  unit.failures.push({ requirement, message })
}

function note(unit, message) {
  unit.notes.push(message)
}

// --- reading the app --------------------------------------------------------

/**
 * Everything one surface currently says, in a single round trip so both rows
 * come from the same render — which is what makes their difference comparable
 * to a real offset at all.
 */
function readClock(page, surface) {
  return page.evaluate((selectors) => {
    const area = document.querySelector(selectors.area)
    if (area === null) return { present: false }
    const badge = area.querySelector(selectors.shift)
    const liveRoles = ['status', 'alert', 'log', 'timer', 'marquee']
    return {
      present: true,
      ariaLabel: area.getAttribute('aria-label') ?? '',
      shift: badge === null ? null : (badge.textContent ?? ''),
      shiftLive: badge === null ? null : badge.getAttribute('aria-live'),
      // 4.4: the bar carries the amount on the home cell's label line rather
      // than in an element of its own.
      shiftOnLabelLine: badge !== null && badge.closest(selectors.label) !== null,
      times: [...area.querySelectorAll(selectors.time)].map((node) => node.textContent ?? ''),
      labels: [...area.querySelectorAll(selectors.label)].map((node) => {
        // The bar nests the badge inside the home label, so the label text has
        // to be taken without it.
        const copy = node.cloneNode(true)
        for (const nested of copy.querySelectorAll(selectors.shift)) nested.remove()
        return copy.textContent ?? ''
      }),
      // Anything inside the clock that would be announced on its own (7.2).
      live: [...area.querySelectorAll('*')]
        .filter(
          (node) =>
            node.hasAttribute('aria-live') || liveRoles.includes(node.getAttribute('role') ?? '')
        )
        .map((node) => ({
          className: typeof node.className === 'string' ? node.className : '',
          isBadge: node === badge
        }))
    }
  }, surface)
}

async function readClockStamped(page, surface) {
  const before = Date.now()
  const clock = await readClock(page, surface)
  return { ...clock, before, after: Date.now() }
}

const readShiftText = async (page, surface) => (await readClock(page, surface)).shift ?? ''

/**
 * Wait for the badge to read what `hours` implies, and turn a timeout into a
 * failure against the requirement the caller is testing rather than a stack.
 */
async function expectShift(unit, page, surface, hours, requirement, timeout = SHIFT_TIMEOUT_MS) {
  const expected = shiftLabel(hours)
  try {
    await page.waitForFunction(
      (arg) => {
        const badge = document.querySelector(`${arg.area} ${arg.shift}`)
        return badge !== null && (badge.textContent ?? '') === arg.expected
      },
      { area: surface.area, shift: surface.shift, expected },
      { timeout, polling: 50 }
    )
    return true
  } catch {
    const actual = await readShiftText(page, surface)
    const wanted = expected === '' ? 'no shift amount' : `"${expected}"`
    fail(
      unit,
      requirement,
      `the ${surface.name} shows "${actual}" where ${wanted} was expected after ${timeout}ms`
    )
    return false
  }
}

/** The two row-level truths every reading must satisfy (3.1, 3.2, 3.5). */
function checkRows(unit, reading, { zone, hours, requirement }) {
  if (!reading.present) {
    fail(unit, requirement, 'the clock area is not on screen')
    return false
  }
  if (reading.times.length !== 2) {
    fail(unit, '2.2', `the clock shows ${reading.times.length} rows, expected 2`)
    return false
  }
  let ok = true
  const home = minuteOfDay(reading.times[0])
  const candidates = homeMinuteCandidates(reading, hours)
  if (!candidates.has(home)) {
    ok = false
    const wanted = [...candidates].map(asClock).join(' or ')
    fail(
      unit,
      requirement,
      `at a ${hours}h shift the home row reads ${reading.times[0]}, expected ${wanted}`
    )
  }
  const observed = wrapHalfDay(minuteOfDay(reading.times[1]) - home)
  const midpoint = (reading.before + reading.after) / 2 + hours * HOUR_MS
  const expected = zoneOffsetMinutes(new Date(midpoint), zone)
  if (observed !== expected) {
    ok = false
    fail(
      unit,
      '3.2',
      `${reading.times[0]} against ${reading.times[1]} is a ${observed}min gap, ` +
        `but ${zone} is ${expected}min from here at that moment`
    )
  }
  return ok
}

// --- driving the app --------------------------------------------------------

async function pointAt(page, surface) {
  const handle = await page.waitForSelector(surface.area)
  const box = await handle.boundingBox()
  if (box === null) throw new Error(`${surface.area} has no box on screen`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * One mouse-notch-sized wheel event. The DOM reports an upward scroll as a
 * negative deltaY and upward means forward, so the sign is inverted once here
 * — the same single inversion `accumulateWheelSteps` makes on the other side.
 */
async function wheelNotch(page, direction) {
  await page.mouse.wheel(0, -WHEEL_STEP_PX * direction)
  return Date.now()
}

/**
 * The in-page latency probe. It is installed once at launch and before any
 * self-check fault, so a fault that stalls the wheel path is measured rather
 * than measured around: listeners on the same target and phase run in
 * registration order.
 */
function installProbe(page) {
  return page.evaluate(() => {
    const probe = { expect: null, wheelAt: null, updatedAt: null, deltaY: null, deltaMode: null }
    globalThis.__kizamiShiftProbe = probe
    globalThis.addEventListener(
      'wheel',
      (event) => {
        if (probe.expect === null || probe.wheelAt !== null || event.deltaY === 0) return
        probe.wheelAt = globalThis.performance.now()
        probe.deltaY = event.deltaY
        probe.deltaMode = event.deltaMode
      },
      { capture: true }
    )
    // The badge text is unique in the UI, so the first mutation that carries it
    // is the readout catching up with the input and nothing else.
    new globalThis.MutationObserver(() => {
      if (probe.expect === null || probe.wheelAt === null || probe.updatedAt !== null) return
      if (!(document.body.textContent ?? '').includes(probe.expect)) return
      probe.updatedAt = globalThis.performance.now()
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
}

const armProbe = (page, expect) =>
  page.evaluate((wanted) => {
    const probe = globalThis.__kizamiShiftProbe
    probe.expect = wanted
    probe.wheelAt = null
    probe.updatedAt = null
    probe.deltaY = null
    probe.deltaMode = null
  }, expect)

const readProbe = (page) => page.evaluate(() => ({ ...globalThis.__kizamiShiftProbe }))

async function setForm(ctx, form) {
  await updateSettings(ctx.page, { miniMode: form === 'mini' })
  await ctx.page.waitForSelector(SURFACES[form].area)
  await sleep(TRANSITION_MS)
  ctx.form = form
}

/** Walk the shift back to now, so the next case starts from a known state. */
async function resetShift(ctx) {
  const surface = SURFACES[ctx.form]
  await ctx.page.focus(surface.area)
  for (let press = 0; press <= SHIFT_HOURS_LIMIT * 2 + 2; press += 1) {
    const current = await readShiftText(ctx.page, surface)
    if (current === '') return
    await ctx.page.keyboard.press(current.startsWith('-') ? 'ArrowUp' : 'ArrowDown')
    await nextFrame(ctx.page)
  }
  throw new Error('the shift would not walk back to now')
}

/**
 * The zone catalog with its labels, read out of the settings control rather
 * than copied from `timezones.ts` — the same source 5.1's check uses, and a
 * different surface from the clock whose accessible name is under test. The
 * control only exists on the settings screen, so this runs once at startup
 * while that screen is still up.
 */
async function readZoneLabels(page, language) {
  await updateSettings(page, { language })
  await sleep(RENDER_MS)
  const options = await page.$$eval('.tz-select option', (nodes) =>
    nodes.map((node) => [node.value, node.textContent ?? ''])
  )
  const labels = new Map(options.filter(([zone]) => zone !== ''))
  for (const zone of [ZONE_WHOLE_HOUR, ZONE_HALF_HOUR]) {
    if (!labels.has(zone)) throw new Error(`${zone} is not in the ${language} settings catalog`)
  }
  return labels
}

// --- the cases --------------------------------------------------------------

/**
 * One notch, one hour, both rows moving together, on whichever surface it is
 * pointed at — plus the scroll-to-update samples 3.8 is measured from.
 */
async function scrollCase(ctx, form) {
  const surface = SURFACES[form]
  const unit = startCase(
    `${form}-scroll`,
    form === 'mini' ? '3.1, 3.2, 3.6, 3.8, 4.4' : '3.1, 3.2, 3.8, 4.1'
  )
  const badgeRequirement = form === 'mini' ? '4.4' : '4.1'
  const stepRequirement = form === 'mini' ? '3.6' : '3.1'

  for (const zone of [ZONE_WHOLE_HOUR, ZONE_HALF_HOUR]) {
    await updateSettings(ctx.page, { secondaryTimeZone: zone })
    await ctx.page.waitForFunction(
      (arg) => {
        const labels = document.querySelectorAll(arg.label)
        return labels.length === 2 && labels[1].textContent === arg.expected
      },
      { label: surface.label, expected: ctx.labels[LANGUAGE].get(zone) },
      { timeout: SHIFT_TIMEOUT_MS }
    )
    await resetShift(ctx)

    const live = await readClockStamped(ctx.page, surface)
    checkRows(unit, live, { zone, hours: 0, requirement: stepRequirement })
    note(unit, `${zone} live      ${live.labels.join(' / ')}  ${live.times.join(' / ')}`)

    await pointAt(ctx.page, surface)
    for (let step = 1; step <= DELAY_SAMPLES; step += 1) {
      await armProbe(ctx.page, shiftLabel(step))
      const dispatched = await wheelNotch(ctx.page, 1)
      if (!(await expectShift(unit, ctx.page, surface, step, stepRequirement))) return unit
      const roundTrip = Date.now() - dispatched

      const probe = await readProbe(ctx.page)
      if (probe.wheelAt === null) {
        fail(unit, stepRequirement, 'the wheel event never reached the clock area')
        return unit
      }
      if (probe.deltaY !== -WHEEL_STEP_PX || probe.deltaMode !== 0) {
        note(
          unit,
          `harness note: the notch arrived as deltaY ${probe.deltaY} in mode ${probe.deltaMode}, ` +
            `not the ${-WHEEL_STEP_PX}px pixel-mode event that was dispatched`
        )
      }
      if (probe.updatedAt === null) {
        fail(unit, '3.8', `the readout never showed ${shiftLabel(step)} after the scroll`)
        return unit
      }
      const delay = probe.updatedAt - probe.wheelAt
      ctx.delays.push({ surface: surface.name, delay, roundTrip })
      if (delay > UPDATE_BUDGET_MS) {
        fail(
          unit,
          '3.8',
          `the readout took ${ms(delay)} to reflect the scroll, past the ${UPDATE_BUDGET_MS}ms budget`
        )
      }

      const reading = await readClockStamped(ctx.page, surface)
      if (reading.shift !== shiftLabel(step)) {
        fail(
          unit,
          badgeRequirement,
          `the badge reads "${reading.shift}", expected ${shiftLabel(step)}`
        )
      }
      if (form === 'mini' && !reading.shiftOnLabelLine) {
        fail(unit, '4.4', 'the shift amount is not on the home cell label line')
      }
      checkRows(unit, reading, { zone, hours: step, requirement: stepRequirement })
      note(
        unit,
        `${zone} notch ${step}   ${reading.shift.padStart(4)}  ${reading.times.join(' / ')}  ` +
          `update ${ms(delay)} (round trip ${roundTrip}ms)`
      )
    }
    await resetShift(ctx)
  }

  await updateSettings(ctx.page, { secondaryTimeZone: ZONE_WHOLE_HOUR })
  return unit
}

/** The range holds to its ends, then wraps back to now and carries on (3.3, 3.4). */
async function rangeCase(ctx) {
  const surface = SURFACES.normal
  const unit = startCase('range-wrap', '3.1, 3.3, 3.4')
  await resetShift(ctx)
  await pointAt(ctx.page, surface)

  // The backward leg deliberately starts wherever the forward leg left off
  // rather than resetting, so the run walks straight down through zero and out
  // the other side. Wrapping is all sign handling, and a leg that always starts
  // at zero would never cross the sign in one continuous gesture.
  let hours = 0

  for (const direction of [1, -1]) {
    const end = SHIFT_HOURS_LIMIT * direction

    // Every notch on the way is checked, so a step that moves by two hours or
    // by none is caught long before the end is reached (3.1).
    while (hours !== end) {
      await wheelNotch(ctx.page, direction)
      hours += direction
      if (!(await expectShift(unit, ctx.page, surface, hours, '3.3'))) return unit
    }
    note(unit, `${direction > 0 ? 'forward ' : 'backward'}  reached ${shiftLabel(end)}`)

    // One notch past the end returns to now rather than stopping there, and the
    // next ones keep going, so scrolling one way never stalls (3.4).
    await wheelNotch(ctx.page, direction)
    hours = 0
    if (!(await expectShift(unit, ctx.page, surface, hours, '3.4'))) return unit
    note(unit, '          one more notch wrapped it back to now')

    for (let step = 1; step <= 2; step += 1) {
      await wheelNotch(ctx.page, direction)
      hours += direction
      if (!(await expectShift(unit, ctx.page, surface, hours, '3.4'))) return unit
    }
    const after = await readClockStamped(ctx.page, surface)
    checkRows(unit, after, { zone: ZONE_WHOLE_HOUR, hours, requirement: '3.4' })
    note(unit, `          and carried on to ${after.shift}, rows ${after.times.join(' / ')}`)
  }

  await resetShift(ctx)
  return unit
}

/** The shift rides across the swap between the two window forms (3.7). */
async function formSwitchCase(ctx) {
  const unit = startCase('form-switch', '3.6, 3.7')
  await setForm(ctx, 'normal')
  await resetShift(ctx)
  await pointAt(ctx.page, SURFACES.normal)

  const carried = 3
  for (let step = 1; step <= carried; step += 1) await wheelNotch(ctx.page, 1)
  if (!(await expectShift(unit, ctx.page, SURFACES.normal, carried, '3.7'))) return unit

  let lastInput = Date.now()
  await setForm(ctx, 'mini')
  const collapseMs = Date.now() - lastInput
  if (!(await expectShift(unit, ctx.page, SURFACES.mini, carried, '3.7'))) {
    note(unit, describeSwitchTiming('collapse', collapseMs))
    return unit
  }
  const onBar = await readClockStamped(ctx.page, SURFACES.mini)
  checkRows(unit, onBar, { zone: ZONE_WHOLE_HOUR, hours: carried, requirement: '3.7' })
  note(unit, `collapse  ${shiftLabel(carried)} survived, ${collapseMs}ms into the wait`)

  // One notch on the bar: it re-proves the bar's own surface (3.6) and restarts
  // the wait, so the trip back is not racing the auto-return either.
  await pointAt(ctx.page, SURFACES.mini)
  await wheelNotch(ctx.page, 1)
  if (!(await expectShift(unit, ctx.page, SURFACES.mini, carried + 1, '3.6'))) return unit
  lastInput = Date.now()

  await setForm(ctx, 'normal')
  const expandMs = Date.now() - lastInput
  if (!(await expectShift(unit, ctx.page, SURFACES.normal, carried + 1, '3.7'))) {
    note(unit, describeSwitchTiming('expand', expandMs))
    return unit
  }
  note(unit, `expand    ${shiftLabel(carried + 1)} survived, ${expandMs}ms into the wait`)

  await resetShift(ctx)
  return unit
}

function describeSwitchTiming(leg, elapsed) {
  const share = elapsed / SHIFT_RESET_MS
  return share > SWITCH_SAFE_FRACTION
    ? `inconclusive: the ${leg} took ${elapsed}ms of the ${SHIFT_RESET_MS}ms auto-return wait, ` +
        'so the amount may have expired rather than been dropped'
    : `the ${leg} took ${elapsed}ms, well inside the ${SHIFT_RESET_MS}ms wait`
}

/** The display goes back to now on its own (5.1). */
async function autoReturnCase(ctx) {
  const surface = SURFACES.normal
  const unit = startCase('auto-return', '5.1')
  await setForm(ctx, 'normal')
  await resetShift(ctx)
  await pointAt(ctx.page, surface)

  const dispatched = await wheelNotch(ctx.page, 1)
  if (!(await expectShift(unit, ctx.page, surface, 1, '5.1'))) return unit

  const cleared = await expectShift(
    unit,
    ctx.page,
    surface,
    0,
    '5.1',
    SHIFT_RESET_MS + AUTO_RETURN_SLACK_MS
  )
  const elapsed = Date.now() - dispatched
  if (!cleared) return unit
  if (elapsed < SHIFT_RESET_MS - AUTO_RETURN_EARLY_MS) {
    fail(
      unit,
      '5.1',
      `the display returned to now after ${elapsed}ms, before the ${SHIFT_RESET_MS}ms wait`
    )
  }
  note(unit, `returned to now ${elapsed}ms after the scroll (wait ${SHIFT_RESET_MS}ms)`)

  const back = await readClockStamped(ctx.page, surface)
  checkRows(unit, back, { zone: ZONE_WHOLE_HOUR, hours: 0, requirement: '5.1' })
  note(unit, `rows back on the current time: ${back.times.join(' / ')}`)
  return unit
}

/** An input part-way through the wait restarts it (5.2). */
async function restartWaitCase(ctx) {
  const surface = SURFACES.normal
  const unit = startCase('restart-wait', '5.2')
  await setForm(ctx, 'normal')
  await resetShift(ctx)
  await pointAt(ctx.page, surface)

  const first = await wheelNotch(ctx.page, 1)
  if (!(await expectShift(unit, ctx.page, surface, 1, '5.2'))) return unit

  await sleepUntil(first + SHIFT_RESET_MS * RESTART_INPUT_FRACTION)
  const midway = await readShiftText(ctx.page, surface)
  if (midway === '') {
    fail(
      unit,
      '5.1',
      `the display returned to now ${Date.now() - first}ms in, before the ${SHIFT_RESET_MS}ms wait`
    )
    return unit
  }

  // A keypress rather than a second scroll: 5.2 is about any shift input, and
  // this is the accessible one (7.1).
  await ctx.page.focus(surface.area)
  await ctx.page.keyboard.press('ArrowUp')
  const second = Date.now()
  if (!(await expectShift(unit, ctx.page, surface, 2, '5.2'))) return unit
  note(unit, `second input ${second - first}ms in, taking the amount to ${shiftLabel(2)}`)

  // Past the point the untouched wait would have expired.
  await sleepUntil(first + SHIFT_RESET_MS + RESTART_PROBE_MS)
  const held = await readShiftText(ctx.page, surface)
  if (held !== shiftLabel(2)) {
    fail(
      unit,
      '5.2',
      `${Date.now() - first}ms after the first input the amount is "${held}", ` +
        `expected ${shiftLabel(2)} because the second input restarted the wait`
    )
    return unit
  }
  note(
    unit,
    `still ${held} at ${Date.now() - first}ms, past the original ${SHIFT_RESET_MS}ms expiry`
  )

  // And the restarted wait must still expire, or "restarted" would just mean
  // "cancelled".
  const cleared = await expectShift(
    unit,
    ctx.page,
    surface,
    0,
    '5.2',
    second + SHIFT_RESET_MS + AUTO_RETURN_SLACK_MS - Date.now()
  )
  if (cleared) {
    note(unit, `the restarted wait expired ${Date.now() - second}ms after the second input`)
  }
  return unit
}

/** The comparison city and the amount are exposed as text (7.2, 4.4). */
async function accessibleNamesCase(ctx) {
  const unit = startCase('accessible-names', '4.4, 7.2')

  for (const language of LANGUAGES) {
    await updateSettings(ctx.page, { language })
    await sleep(RENDER_MS)
    const city = ctx.labels[language].get(ZONE_WHOLE_HOUR)
    for (const form of ['normal', 'mini']) {
      const surface = SURFACES[form]
      await setForm(ctx, form)
      await resetShift(ctx)

      const live = await readClock(ctx.page, surface)
      if (!live.ariaLabel.includes(city)) {
        fail(unit, '7.2', `${language} ${surface.name}: "${live.ariaLabel}" does not name ${city}`)
      }
      if (live.ariaLabel.includes(shiftLabel(1))) {
        fail(unit, '7.2', `${language} ${surface.name}: an unshifted name carries a shift amount`)
      }

      await pointAt(ctx.page, surface)
      await wheelNotch(ctx.page, 1)
      if (!(await expectShift(unit, ctx.page, surface, 1, '7.2'))) return unit
      const shifted = await readClock(ctx.page, surface)
      if (!shifted.ariaLabel.includes(city)) {
        fail(unit, '7.2', `${language} ${surface.name}: the shifted name drops ${city}`)
      }
      if (!shifted.ariaLabel.includes(shiftLabel(1))) {
        fail(
          unit,
          '7.2',
          `${language} ${surface.name}: "${shifted.ariaLabel}" omits the ${shiftLabel(1)} amount`
        )
      }
      // The amount is the only thing announced as it changes; announcing the
      // clock text would talk over everything once a second (7.2).
      if (shifted.shiftLive === null || shifted.shiftLive === '') {
        fail(unit, '7.2', `${language} ${surface.name}: the shift amount is not a live region`)
      }
      const strays = shifted.live.filter((node) => !node.isBadge)
      if (strays.length > 0) {
        fail(
          unit,
          '7.2',
          `${language} ${surface.name}: ${strays.map((n) => `.${n.className}`).join(', ')} ` +
            'is announced live besides the shift amount'
        )
      }
      if (form === 'mini' && !shifted.shiftOnLabelLine) {
        fail(unit, '4.4', `${language}: the shift amount is not on the home cell label line`)
      }
      note(unit, `${language} ${surface.name.padEnd(13)} "${shifted.ariaLabel}"`)
      await resetShift(ctx)
    }
  }

  await updateSettings(ctx.page, { language: LANGUAGE })
  await setForm(ctx, 'normal')
  return unit
}

const CASES = [
  { id: 'normal-scroll', run: (ctx) => scrollCase(ctx, 'normal'), form: 'normal' },
  { id: 'mini-scroll', run: (ctx) => scrollCase(ctx, 'mini'), form: 'mini' },
  { id: 'range-wrap', run: rangeCase, form: 'normal' },
  { id: 'form-switch', run: formSwitchCase, form: 'normal' },
  { id: 'accessible-names', run: accessibleNamesCase, form: 'normal' },
  { id: 'auto-return', run: autoReturnCase, form: 'normal' },
  { id: 'restart-wait', run: restartWaitCase, form: 'normal' }
]

// --- self-check faults ------------------------------------------------------

/**
 * Each fault breaks the app from inside the page in a way one assertion is
 * supposed to notice, and names the case and requirement that must catch it.
 * The rewriting faults lean on the fact that a MutationObserver callback runs
 * in the microtask checkpoint of the task that mutated the DOM, so no later
 * round trip can ever observe the app's own value.
 */
const FAULTS = [
  {
    id: 'block-wheel',
    why: 'wheel events are stopped before they reach the app',
    breaks: [
      { caseId: 'normal-scroll', requirement: '3.1' },
      { caseId: 'mini-scroll', requirement: '3.6' }
    ],
    install: (page) =>
      page.evaluate(() => {
        globalThis.addEventListener('wheel', (event) => event.stopPropagation(), { capture: true })
      })
  },
  {
    id: 'desync-rows',
    why: 'the comparison row is pinned to a time of its own',
    breaks: [{ caseId: 'normal-scroll', requirement: '3.2' }],
    install: (page) =>
      page.evaluate(() => {
        const rewrite = () => {
          for (const selector of ['.timer__time', '.mini-bar__time']) {
            const rows = document.querySelectorAll(selector)
            if (rows.length > 1 && rows[1].textContent !== '00:00') rows[1].textContent = '00:00'
          }
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
    id: 'slow-update',
    why: 'the wheel path stalls for longer than the update budget',
    breaks: [{ caseId: 'normal-scroll', requirement: '3.8' }],
    install: (page) =>
      page.evaluate((budget) => {
        globalThis.addEventListener(
          'wheel',
          () => {
            const until = globalThis.performance.now() + budget * 1.25
            while (globalThis.performance.now() < until) {
              /* hold the main thread, so the readout really is late */
            }
          },
          { capture: true }
        )
      }, UPDATE_BUDGET_MS)
  },
  {
    id: 'range-drift',
    why: 'the amount settles somewhere other than the end of the range',
    breaks: [{ caseId: 'range-wrap', requirement: '3.3' }],
    install: (page) =>
      page.evaluate(
        (arg) => {
          const rewrite = () => {
            for (const badge of document.querySelectorAll('.timer__shift, .mini-bar__shift')) {
              if (badge.textContent === arg.rangeEnd) badge.textContent = arg.wrong
            }
          }
          new globalThis.MutationObserver(rewrite).observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          })
          rewrite()
        },
        { rangeEnd: RANGE_END_LABEL, wrong: shiftLabel(SHIFT_HOURS_LIMIT + 2) }
      )
  },
  {
    id: 'wrap-stalls',
    why: 'the amount sticks at the end of the range instead of wrapping to now',
    breaks: [{ caseId: 'range-wrap', requirement: '3.4' }],
    install: (page) =>
      page.evaluate(
        (arg) => {
          // Once the end is reached, pin the badge there however far the user
          // scrolls — the pre-wrap behaviour this check now rejects.
          let atEnd = false
          const pin = () => {
            for (const badge of document.querySelectorAll('.timer__shift, .mini-bar__shift')) {
              if (badge.textContent === arg.rangeEnd) atEnd = true
              else if (atEnd) badge.textContent = arg.rangeEnd
            }
          }
          new globalThis.MutationObserver(pin).observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          })
          pin()
        },
        { rangeEnd: RANGE_END_LABEL }
      )
  },
  {
    id: 'wrap-stalls-backward',
    why: 'the backward end sticks instead of wrapping, which the forward fault cannot reach',
    breaks: [{ caseId: 'range-wrap', requirement: '3.4' }],
    install: (page) =>
      page.evaluate(
        (arg) => {
          // Once the end is reached, pin the badge there however far the user
          // scrolls — the pre-wrap behaviour this check now rejects.
          let atEnd = false
          const pin = () => {
            for (const badge of document.querySelectorAll('.timer__shift, .mini-bar__shift')) {
              if (badge.textContent === arg.rangeEnd) atEnd = true
              else if (atEnd) badge.textContent = arg.rangeEnd
            }
          }
          new globalThis.MutationObserver(pin).observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          })
          pin()
        },
        { rangeEnd: shiftLabel(-SHIFT_HOURS_LIMIT) }
      )
  },
  {
    id: 'drop-on-collapse',
    why: 'the mini bar forgets the amount it was handed',
    breaks: [{ caseId: 'form-switch', requirement: '3.7' }],
    install: (page) =>
      page.evaluate(() => {
        const clear = () => {
          for (const badge of document.querySelectorAll('.mini-bar__shift')) {
            if (badge.textContent !== '') badge.textContent = ''
          }
        }
        new globalThis.MutationObserver(clear).observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true
        })
        clear()
      })
  },
  {
    id: 'never-expire',
    why: 'the auto-return is never scheduled',
    breaks: [{ caseId: 'auto-return', requirement: '5.1' }],
    install: (page) =>
      page.evaluate((wait) => {
        const original = globalThis.setTimeout
        globalThis.setTimeout = (fn, delay, ...rest) =>
          delay === wait ? 0 : original(fn, delay, ...rest)
      }, SHIFT_RESET_MS)
  },
  {
    id: 'no-restart',
    why: 'a later input cannot cancel the wait the first one started',
    breaks: [{ caseId: 'restart-wait', requirement: '5.2' }],
    install: (page) =>
      page.evaluate(() => {
        globalThis.clearTimeout = () => {}
      })
  },
  {
    id: 'drop-aria-label',
    why: 'the clock area has no accessible name',
    breaks: [{ caseId: 'accessible-names', requirement: '7.2' }],
    install: (page) =>
      page.evaluate(() => {
        const strip = () => {
          for (const area of document.querySelectorAll('.timer__card--clock, .mini-bar__clock')) {
            area.removeAttribute('aria-label')
          }
        }
        new globalThis.MutationObserver(strip).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true
        })
        strip()
      })
  },
  {
    id: 'live-clock-text',
    why: 'the ticking clock text is announced as well as the amount',
    breaks: [{ caseId: 'accessible-names', requirement: '7.2' }],
    install: (page) =>
      page.evaluate(() => {
        const mark = () => {
          for (const time of document.querySelectorAll('.timer__time, .mini-bar__time')) {
            if (!time.hasAttribute('aria-live')) time.setAttribute('aria-live', 'polite')
          }
        }
        new globalThis.MutationObserver(mark).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true
        })
        mark()
      })
  }
]

// --- running ----------------------------------------------------------------

/**
 * Bring a fresh instance to clock mode with a comparison zone set, and read the
 * city labels while the settings screen is still reachable.
 */
async function prepare(app) {
  const { page } = app
  await installProbe(page)
  await updateSettings(page, {
    language: LANGUAGE,
    clockMode: true,
    clockFormat: CLOCK_FORMAT,
    miniMode: false,
    secondaryTimeZone: ZONE_WHOLE_HOUR
  })
  // The catalog lives behind the settings screen, so every language's labels
  // are collected while it is open and carried into the cases.
  await page.click('.titlebar__gear')
  await page.waitForSelector('.tz-select')
  const labels = {}
  for (const language of LANGUAGES) {
    labels[language] = await readZoneLabels(page, language)
  }
  await updateSettings(page, { language: LANGUAGE })
  await page.click('.titlebar__gear')
  await page.waitForSelector(SURFACES.normal.area)
  await sleep(TRANSITION_MS)
  return { page, form: 'normal', labels, delays: [] }
}

async function runCase(ctx, entry) {
  await setForm(ctx, entry.form)
  try {
    return await entry.run(ctx)
  } catch (error) {
    const unit = startCase(entry.id, 'n/a')
    fail(unit, 'n/a', `the case could not be driven to a verdict: ${error.message}`)
    return unit
  }
}

function reportCase(unit, verbose) {
  const verdict = unit.failures.length === 0 ? 'PASS' : 'FAIL'
  console.log(`\n${unit.id.padEnd(18)} ${unit.requirements.padEnd(24)} ${verdict}`)
  if (verbose || unit.failures.length > 0) {
    for (const line of unit.notes) console.log(`    ${line}`)
  }
  for (const failure of unit.failures) {
    console.log(`    FAIL ${failure.requirement.padEnd(5)} ${failure.message}`)
  }
}

function reportDelays(delays) {
  if (delays.length === 0) return
  const of = (key) => delays.map((sample) => sample[key])
  const span = (values) => `${ms(Math.min(...values))}-${ms(Math.max(...values))}`
  console.log(
    `\nscroll to update: ${delays.length} samples, ${span(of('delay'))} in page ` +
      `(budget ${UPDATE_BUDGET_MS}ms), ${span(of('roundTrip'))} including the harness round trip`
  )
}

async function runAll(app, verbose) {
  const ctx = await prepare(app)
  console.log(
    `clock shift check: ${CASES.length} cases, ${LANGUAGE}/${CLOCK_FORMAT}, ` +
      `one notch = ${WHEEL_STEP_PX}px, range +/-${SHIFT_HOURS_LIMIT}h wrapping to now, ` +
      `auto-return ${SHIFT_RESET_MS}ms`
  )
  let failing = 0
  for (const entry of CASES) {
    const unit = await runCase(ctx, entry)
    reportCase(unit, verbose)
    if (unit.failures.length > 0) failing += 1
  }
  reportDelays(ctx.delays)
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
    const app = await launchApp()
    try {
      const ctx = await prepare(app)
      await fault.install(app.page)
      console.log(`\n--- ${fault.id}: ${fault.why}`)
      for (const expectation of fault.breaks) {
        const entry = CASES.find((candidate) => candidate.id === expectation.caseId)
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
      await app.close()
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
  const mainScript = path.join(repoRoot, 'out/main/index.js')
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
    if (!(await runAll(app, verbose))) process.exitCode = 1
  } finally {
    await app.close()
  }
}

await main()
