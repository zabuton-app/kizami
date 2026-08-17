# ui-checks

Scripted checks that drive the built app and assert something about what it
renders. They share the Electron harness in
[demo-capture](../demo-capture/lib.mjs) — same launch, same throwaway
user-data directory — but write nothing and exit non-zero when the app is
wrong. They are not part of `npm test`: the unit suite runs under Node with no
DOM, and these questions can only be answered by real layout.

## Prerequisites

- `npm install` and `npm run build` (the checks launch `out/main/index.js`)
- Linux: an X display. Under a headless session, prefix with `xvfb-run -a`

Only `playwright-core` is needed — no browser download, no extra install step.

## mini-bar-width

Measures clock mode's mini bar against the width the window really gives it.
The bar is a fixed 380x58, and in paired mode it has to hold two clock cells,
the date, ten progress blocks and the expand button. This check re-derives that
budget from the laid-out DOM, so a change to the font, the label text, the zone
catalog or `WINDOW_MINI_SIZE` cannot quietly push the content out of view
(requirement 2.6).

```bash
node tools/ui-checks/mini-bar-width.mjs

# One line per case instead of a per-combination summary
node tools/ui-checks/mini-bar-width.mjs --verbose

# Force an overflow, to check that the check still catches one
node tools/ui-checks/mini-bar-width.mjs --self-check
```

It sweeps both interface languages, both clock formats, every zone the
settings control offers, and each of those unshifted and at the end of the shift range —
208 cases in about 25 seconds. Per combination it prints the tightest case in
full: the bar's `clientWidth` and `scrollWidth`, the width of the clock area,
the date and the expand button, and the width left over for the progress
blocks.

A case counts as an overflow when the bar's `scrollWidth` passes its
`clientWidth`, when any part of the bar sticks out of its content box, or when
the progress blocks — the only child allowed to shrink, so the first thing to
go — are squeezed under a pixel. Any of those exits non-zero.

Nothing about the budget is hardcoded: the zone list comes from the settings
control, the end of the shift range is found by pressing until the amount wraps back to now,
and the padding, gaps and block cap are read back from the computed styles. The
numbers below are what the check reported when it was written, recorded as a
baseline rather than asserted.

| Language | Format   | Tightest case                       | Clock | Date | Blocks left |
| -------- | -------- | ----------------------------------- | ----- | ---- | ----------- |
| `ja`     | `hhmm`   | `America/Mexico_City`, shifted +24h | 143.0 | 59.2 | 91.8        |
| `ja`     | `hhmmss` | `America/Denver`, shifted +24h      | 143.2 | 59.2 | 91.6        |
| `en`     | `hhmm`   | `America/Los_Angeles`, shifted +24h | 105.7 | 44.7 | 143.6       |
| `en`     | `hhmmss` | `America/Denver`, shifted +24h      | 134.0 | 44.7 | 115.3       |

All widths are CSS px inside the bar's 350px of usable width, and the worst
case leaves the blocks well over half the width they want. Which zone comes out
tightest can flip between the closest two or three from run to run: Zen Maru
Gothic ships no `tnum` table, so the rendered time really does change width as
the digits change, by around a pixel. The two `ja` rows land within a pixel of
each other because the Japanese labels are wider than the times underneath
them, so those cells are label-sized in both formats — which is the point of
stacking them.

## clock-shift

Drives clock mode's shift interaction end to end: both rows moving together,
the signed amount, the one-hour notch, the range wrapping back to now past either end, the
scroll working on the card and on the mini bar, the amount surviving a switch
between the two window forms, the ten-second return to now and its restart on
a later input, the scroll-to-update delay, and the accessible names
(requirements 3.1-3.4, 3.6-3.8, 4.1, 4.4, 5.1, 5.2 and 7.2).

```bash
node tools/ui-checks/clock-shift.mjs

# One line per notch, with the times and the measured delay
node tools/ui-checks/clock-shift.mjs --verbose

# Break the app ten ways and confirm each assertion still catches it
node tools/ui-checks/clock-shift.mjs --self-check
node tools/ui-checks/clock-shift.mjs --self-check=never-expire
```

Seven cases in about 45 seconds; the self-check takes about 80 seconds
because it launches a fresh instance per fault.

| Case               | Requirements            | What it drives                                       |
| ------------------ | ----------------------- | ---------------------------------------------------- |
| `normal-scroll`    | 3.1, 3.2, 3.8, 4.1      | Five notches over the card, two zones                |
| `mini-scroll`      | 3.1, 3.2, 3.6, 3.8, 4.4 | The same over the mini bar                           |
| `range-wrap`       | 3.1, 3.3, 3.4           | Every notch to each end, then the wrap to now and on |
| `form-switch`      | 3.6, 3.7                | Collapse and expand with an amount held              |
| `accessible-names` | 4.4, 7.2                | Both surfaces in both languages                      |
| `auto-return`      | 5.1                     | One notch, then nothing for ten seconds              |
| `restart-wait`     | 5.2                     | A second input part-way through the wait             |

Everything is real input through Chromium: `page.mouse.wheel` for the notches
and `page.keyboard.press` for the accessible equivalent, never a synthetic
`dispatchEvent`. That is deliberate — the mini bar's drag region would
swallow wheel events without its `no-drag` opt-out, and a dispatched event
would never notice.

Nothing is asserted against the app's own arithmetic. The expected offset
between the two rows is computed here from the zone id, so a display that
agrees with itself but not with the world still fails; the range end, the notch
size, the auto-return wait and the hour unit are read out of `src/shared` at
startup rather than hardcoded, so a change there is compared against, not
silently accepted. Because those come from the source and the run drives the
bundle, a stale `out/` compares against the wrong numbers — build first.

The scroll-to-update delay (3.8) is measured inside the page, between a
capture-phase `wheel` listener and the `MutationObserver` record that carries
the new amount, so the harness round trip is excluded from the budget and
reported separately. The numbers below are what the check reported when it
was written, recorded as a baseline rather than asserted.

| Measurement                        | Observed  | Budget or wait |
| ---------------------------------- | --------- | -------------- |
| Scroll to updated readout, in page | 0.2-0.6ms | 200ms          |
| The same including the round trip  | 50-52ms   | not asserted   |
| Auto-return after the last input   | 10059ms   | 10000ms        |
| Restarted wait after the second    | 10002ms   | 10000ms        |
| Window-form switch                 | 504ms     | 10000ms        |

Timing tolerances are deliberately lopsided, because `setTimeout` never fires
early: an auto-return is allowed 500ms below the nominal wait and 5000ms
above it, and every wait polls to a deadline rather than sleeping a fixed
amount. The one place a slow machine could confuse the result is
`form-switch`, where a switch slower than 70% of the wait would race the
auto-return; that case prints how much of the wait each leg consumed and says
so explicitly if it ever gets close.

Each self-check fault sabotages the running page — stopping wheel events
before they reach the app, pinning the comparison row to a time of its own,
stalling the wheel path past the budget, letting the amount creep past the
end of the range, pinning it there instead of wrapping to now, dropping it on
collapse, swallowing the auto-return's `setTimeout`,
neutering the `clearTimeout` that restarts it, stripping the accessible name,
announcing the ticking clock text — and names the case and requirement that
must catch it. A fault that goes unnoticed exits non-zero, so the check
cannot quietly stop checking.

## clock-mode-intact

Guards what clock mode already did, now that it has a second row and a
shiftable display. Every case is a "nothing else moved" assertion: with no
comparison zone the clock is still one bare row, the pomodoro timer keeps its
own schedule across scrolling and across the automatic return, scrolling
outside clock mode does nothing, the shift is dropped on leaving clock mode and
on a restart, and the clock, the day-progress blocks and the mini bar's date
are all right the moment the window comes back (requirements 2.3, 3.9, 3.10,
5.3, 5.4, 5.5, 6.1, 6.2 and 6.4, and through them 007's FR-005, FR-006 and
FR-007).

```bash
node tools/ui-checks/clock-mode-intact.mjs

# One line per case, with the times, block counts and dates that were read
node tools/ui-checks/clock-mode-intact.mjs --verbose

# Break the app twelve ways and confirm each assertion still catches it
node tools/ui-checks/clock-mode-intact.mjs --self-check
node tools/ui-checks/clock-mode-intact.mjs --self-check=stale-clock
```

Nine cases in about 90 seconds, most of it spent waiting out the ten-second
return, the two twelve-second stalls and the window's own mini-mode
transitions; the self-check takes about 135 seconds, because it launches a
fresh instance per fault but runs only the cases that fault claims to break.
Measured on Linux/X11: seven consecutive green runs, five on a desktop
display (88-89s) and two under `xvfb-run -a` (91-92s), against an unmodified
build.

Every form switch hands control back only once the window's transition is
over, which is why a run costs more than the assertions themselves do.
`applyMiniMode` in `src/main/popup-window.ts` reads the renderer's viewport
back one second after the switch and corrects a stale one, and that correction
is abandoned the moment the window is not visible. A case that hid the window
sooner than that — `hide-and-show` used to hide it about 500ms after the
switch — cancelled the app's only recovery from a resize the compositor
dropped, and a renderer left laid out for the mini height never draws the
normal window again. The wait is derived from the main process's own settle
constants rather than guessed.

| Case                | Requirements | What it drives                                       |
| ------------------- | ------------ | ---------------------------------------------------- |
| `single-row`        | 2.3          | No zone set, both formats, both window forms         |
| `scroll-isolation`  | 3.9          | Four notches on each surface, timer read either side |
| `phase-advance`     | 3.9          | A phase boundary reached under continuous scrolling  |
| `return-isolation`  | 5.5          | The ten-second expiry, timer read either side        |
| `timer-mode-scroll` | 3.10         | Scrolling the timer card and the mini timer bar      |
| `leave-clock-mode`  | 5.3          | Out of clock mode and back with a shift held         |
| `restart`           | 5.4          | A second process on the first one's profile          |
| `shifted-anchors`   | 6.1, 6.2     | Shifted over midnight, forward and backward          |
| `hide-and-show`     | 6.4          | Hidden, the renderer starved, then brought back      |

The timer is only ever observed through `getSnapshot()`, which reports the main
process's own state, so the renderer cannot flatter it: a case scrolls, reads
the snapshot either side, and requires every field to be identical except the
remaining time, which must have fallen by exactly the wall time that passed.
Nothing else is read back from the app either — times, block counts and date
strings are re-derived here from the wall clock, the zone id and the
dictionary, so a display that agrees with itself but not with the world still
fails.

`phase-advance` is the one case that reaches into the main process. It launches
an instance armed twelve seconds before its first phase boundary through the
dev-only elapsed-time seam, wraps `Notification.prototype.show` so every
desktop notification is recorded, and then scrolls the clock continuously until
the phase runs out. The phase change and the notification it fires are both
required to land within a window derived from the armed snapshot, which is
3.9's "notification schedule" observed directly rather than inferred. Where a
platform reports no notification support the case says so and rests on the
phase change alone.

`hide-and-show` is what 6.4 needs and the harness cannot do on its own. The
window is hidden through `hideWindow()`, the renderer's main thread is then
held for twelve seconds — hiding alone does not throttle it on this platform,
so the stall is what actually creates the condition — and the window is brought
back the way a user does it: a second launch on the same profile loses the
single-instance lock and quits, and the running instance answers with
`showPopupNear()`. The count of snapshots the page received is the witness that
the window really went away, so a hide that silently did nothing cannot pass.

Two cases bring up instances of their own, and a third has to know where the
shared instance keeps its settings — none of which `launchApp()` offers, since
it mints a throwaway profile per launch and hands back only the page.
`restart` relaunches a second process on the first one's profile,
`phase-advance` needs the main-process handle, and `hide-and-show` passes the
shared profile's path to the second launch that brings the window back. That
path is found by diffing the temp directory around a launch, and the run
refuses to continue if it is ever ambiguous — so nothing else may be launching
the app at the same time. Every profile this check creates is removed when its
instance closes, which the shared harness does not do.

The numbers below are what the check reported when it was written, recorded as
a baseline rather than asserted.

| Measurement                               | Observed       | Budget or wait |
| ----------------------------------------- | -------------- | -------------- |
| Phase change after its boundary           | 115-173ms      | 3500ms         |
| Notification against that boundary        | 65-2ms early   | 3500ms late    |
| Scroll steps landed while a phase ran out | 41-49 of 41-49 | not asserted   |
| Automatic return after the last input     | 10007ms        | 10000ms        |
| Window hidden with the renderer stalled   | 13.3s          | not asserted   |
| Renderer ticks during that stall          | 1-3 of 13      | not asserted   |

Each self-check fault sabotages the app — labelling the lone row, letting the
empty shift indication take space, skipping or pausing the timer on a scroll,
pausing it on the automatic return, swallowing the phase-change notification,
entering clock mode on a scroll in timer mode, carrying the shift back into
clock mode, restoring it after a restart, freezing the clock at the moment the
renderer was starved, moving the date with the shifted rows, dropping a
day-progress block while shifted — and names the case and requirement that must
catch it. Eleven of them break the page; `silent-transition` breaks the main
process, because a notification never reaches the page at all. A fault that
goes unnoticed exits non-zero, so the check cannot quietly stop checking.

## Notes

- Checks run at `--force-device-scale-factor=1`, so a CSS pixel is a device
  pixel and the measurements are reproducible across display scaling
- Each run launches its own instance against a throwaway user-data directory,
  so driving the settings never touches your real configuration
- The harness waits for `document.fonts.ready` before measuring; the bundled
  Zen Maru Gothic loads asynchronously, and the fallback font would measure
  differently
