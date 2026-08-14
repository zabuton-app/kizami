<div align="center">

<img src="./logo/app-512.png" width="160" alt="kizami logo">

# 刻（kizami）

**A tray-resident pomodoro timer with a candy-pop look — start a focus session
from the tray, close the window, and let it keep counting.**

[![CI](https://github.com/zabuton-app/kizami/actions/workflows/ci.yml/badge.svg)](https://github.com/zabuton-app/kizami/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/zabuton-app/kizami?include_prereleases)](https://github.com/zabuton-app/kizami/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-ff6b57)

</div>

kizami lives in your system tray / menu bar. Click the tray icon to open a small
frameless popup with the timer; close it and the timer keeps running in the
background. Desktop notifications tell you when it is time to take a break or
get back to focus.

The name **kizami** comes from the Japanese word _刻み_ — "carving something
into small pieces", the way a pomodoro cycle cuts a day into sessions — and the
display name is the single kanji 刻.

Built with **Electron + TypeScript + React**. The timer engine runs on
wall-clock time in the main process, so it survives a hidden window and system
sleep without drifting. There are no native dependencies.

![The kizami timer popup during a focus session](./docs/assets/shot-timer.png)

## Features

- **Classic pomodoro cycle.** Focus (25 min) → short break (5 min) × 4 sessions,
  then a long break (15 min). Every duration and the number of sessions per
  cycle are adjustable.
- **Start / pause / resume / skip.** The whole cycle is driven from the popup,
  and the countdown can read either the time left or the time spent.
- **Tray-resident.** The popup can be closed at any time and the timer keeps
  going; desktop notifications announce every phase change.
- **No drift.** The engine is wall-clock based, so hiding the window or putting
  the machine to sleep does not throw the countdown off.
- **Mini mode.** Shrink the popup to a slim bar with just the countdown and a
  start/stop button.
- **Clock mode.** Turn the popup into a desk clock (hh:mm or hh:mm:ss) with a
  bar showing how much of the day has passed, while the timer keeps running.
- **Five candy themes.** candy, strawberry milk, melon soda, grape gummy, and
  night pudding, switchable from the dots in the popup.
- **Two tray icons.** The 刻 mark or the original tomato.
- **Japanese / English UI.** Auto-detected from the OS locale and switchable in
  the settings.
- **Custom window decoration.** Identical on Linux, macOS, and Windows.

## Screenshots

Durations, sessions per cycle, auto-start, time display, clock format, task
name, language, and the tray icon are all set from the settings view:

![The kizami settings view](./docs/assets/shot-settings.png)

Mini mode shrinks the popup to a slim horizontal bar that stays out of the way:

![kizami mini mode — a slim bar with the countdown](./docs/assets/shot-mini.png)

## Install

Windows users can install kizami from the
[Microsoft Store](https://apps.microsoft.com/detail/9NQLKSMBFKH0).

[![Get it from Microsoft](https://get.microsoft.com/images/en-us%20dark.svg)](https://apps.microsoft.com/detail/9NQLKSMBFKH0)

Prebuilt packages for all platforms are also available:

| Channel                                                             | Platform                | Notes                                            |
| ------------------------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| [Microsoft Store](https://apps.microsoft.com/detail/9NQLKSMBFKH0)   | Windows                 | Installs and updates are managed by the Store    |
| [GitHub Releases](https://github.com/zabuton-app/kizami/releases)   | Linux / macOS / Windows | AppImage, tar.xz, deb, dmg, and installer builds |
| AUR ([`kizami-bin`](https://aur.archlinux.org/packages/kizami-bin)) | Arch Linux              | Binary package built from the released AppImage  |

```bash
yay -S kizami-bin
# or: paru -S kizami-bin
```

The app checks GitHub Releases for a newer version on startup and only tells you
about it — it never downloads or installs anything on its own. Automatic
checking can be turned off in the settings.

## Development

```bash
npm install
npm run dev        # start with HMR (electron-vite)
npm run test       # unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint + Prettier check
npm run format     # Prettier write
npm run build      # production build into out/
npm run dist       # package with electron-builder into release/
```

Requires Node.js 22 or newer.

Development helpers:

- `node tools/demo-capture/shoot-shots.mjs` regenerates the screenshots in
  `docs/assets/` from the built app (see
  [tools/demo-capture/README.md](tools/demo-capture/README.md))
- `scripts/generate-icons.sh` regenerates tray/app icons from
  `logo/kizami-icon.paths.svg` (requires ImageMagick and librsvg)

### Layout

| Path              | Contents                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/`       | Main process: wall-clock timer engine, tray, frameless popup window, settings persistence (electron-store), notifications, IPC |
| `src/preload/`    | Context-isolated bridge exposing a typed `window.kizami` API                                                                   |
| `src/renderer/`   | React UI (timer view / settings view)                                                                                          |
| `src/shared/`     | Pure logic shared by both processes: timer state machine, settings sanitizer, i18n dictionaries — fully unit-tested            |
| `tests/`          | Vitest unit suites                                                                                                             |
| `logo/`, `build/` | Brand assets and packaging icons                                                                                               |

## License

[MIT](./LICENSE) © amgsk

kizami is part of the **zabuton** family of desktop apps.
