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

## Notes

- Checks run at `--force-device-scale-factor=1`, so a CSS pixel is a device
  pixel and the measurements are reproducible across display scaling
- Each run launches its own instance against a throwaway user-data directory,
  so driving the settings never touches your real configuration
- The harness waits for `document.fonts.ready` before measuring; the bundled
  Zen Maru Gothic loads asynchronously, and the fallback font would measure
  differently
