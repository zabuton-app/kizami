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
settings control offers, and each of those unshifted and at the shift clamp —
208 cases in about 25 seconds. Per combination it prints the tightest case in
full: the bar's `clientWidth` and `scrollWidth`, the width of the clock area,
the date and the expand button, and the width left over for the progress
blocks.

A case counts as an overflow when the bar's `scrollWidth` passes its
`clientWidth`, when any part of the bar sticks out of its content box, or when
the progress blocks — the only child allowed to shrink, so the first thing to
go — are squeezed under a pixel. Any of those exits non-zero.

Nothing about the budget is hardcoded: the zone list comes from the settings
control, the shift clamp is found by pressing until the amount stops moving,
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
the signed amount, the one-hour notch, the range saturating at both ends, the
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

| Case               | Requirements            | What it drives                               |
| ------------------ | ----------------------- | -------------------------------------------- |
| `normal-scroll`    | 3.1, 3.2, 3.8, 4.1      | Five notches over the card, two zones        |
| `mini-scroll`      | 3.1, 3.2, 3.6, 3.8, 4.4 | The same over the mini bar                   |
| `saturation`       | 3.1, 3.3, 3.4           | Every notch to +24h, then to -24h, then past |
| `form-switch`      | 3.6, 3.7                | Collapse and expand with an amount held      |
| `accessible-names` | 4.4, 7.2                | Both surfaces in both languages              |
| `auto-return`      | 5.1                     | One notch, then nothing for ten seconds      |
| `restart-wait`     | 5.2                     | A second input part-way through the wait     |

Everything is real input through Chromium: `page.mouse.wheel` for the notches
and `page.keyboard.press` for the accessible equivalent, never a synthetic
`dispatchEvent`. That is deliberate — the mini bar's drag region would
swallow wheel events without its `no-drag` opt-out, and a dispatched event
would never notice.

Nothing is asserted against the app's own arithmetic. The expected offset
between the two rows is computed here from the zone id, so a display that
agrees with itself but not with the world still fails; the clamp, the notch
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
clamp, dropping it on collapse, swallowing the auto-return's `setTimeout`,
neutering the `clearTimeout` that restarts it, stripping the accessible name,
announcing the ticking clock text — and names the case and requirement that
must catch it. A fault that goes unnoticed exits non-zero, so the check
cannot quietly stop checking.

## Notes

- Checks run at `--force-device-scale-factor=1`, so a CSS pixel is a device
  pixel and the measurements are reproducible across display scaling
- Each run launches its own instance against a throwaway user-data directory,
  so driving the settings never touches your real configuration
- The harness waits for `document.fonts.ready` before measuring; the bundled
  Zen Maru Gothic loads asynchronously, and the fallback font would measure
  differently
