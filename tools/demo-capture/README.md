# demo-capture

Scripts that (re)generate the screenshots in `docs/assets/` used by
[README.md](../../README.md) and the landing page. They launch the built app
with Playwright's Electron driver, drive it the way a user would, and capture
the popup through the main process so the transparent rounded corners survive.

## Prerequisites

- `npm install` and `npm run build` (the scripts launch `out/main/index.js`)
- Linux: an X display. Under a headless session, prefix with `xvfb-run -a`

Only `playwright-core` is needed — no browser download, no extra install step.

## Usage

```bash
# All four shots, straight into docs/assets/
node tools/demo-capture/shoot-shots.mjs

# Or just the ones you need
node tools/demo-capture/shoot-shots.mjs timer settings mini clock
```

| Shot       | File                | What it captures                                    |
| ---------- | ------------------- | --------------------------------------------------- |
| `timer`    | `shot-timer.png`    | Timer view, 13:42 into a focus phase                |
| `settings` | `shot-settings.png` | Settings view, via the gear button                  |
| `mini`     | `shot-mini.png`     | Mini mode bar, via the title bar button             |
| `clock`    | `shot-clock.png`    | Clock mode with a comparison city and timer presets |

Each shot launches its own instance against a throwaway user-data directory, so
a run never touches your real settings even though it clicks UI that persists
them.

## How the timer is fast-forwarded

The countdown lives in the main process, out of reach of both the page and the
UI. `src/main/index.ts` therefore exposes a single dev-only global,
`__kizamiSimulateElapsed(ms)`, which the capture scripts call through
Playwright's main-process bridge. It is guarded by `app.isPackaged === false`,
so a packaged release never defines it.

## Notes

- Captures run at `--force-device-scale-factor=1` to stay reproducible across
  machines with different display scaling
- The scripts wait for `document.fonts.ready` before shooting; the bundled Zen
  Maru Gothic loads asynchronously and a capture taken too early shows the
  fallback font
- `lib.mjs` is shared with [ui-checks](../ui-checks/README.md), which drives the
  same built app to assert about layout instead of capturing it
