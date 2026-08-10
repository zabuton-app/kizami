/** Version info for the About section, produced by the main process. */
export interface AboutInfo {
  version: string
  electron: string
  chrome: string
  node: string
}

export const GITHUB_URL = 'https://github.com/zabuton-app/kizami'

export interface ThirdPartyEntry {
  name: string
  license: string
  licenseUrl: string
  /** Where to obtain the software / its source code. */
  sourceUrl: string
}

// Notices for software bundled in the distributed app (not mere build
// tooling). The full dependency list lives in package.json on GitHub.
export const THIRD_PARTY: ThirdPartyEntry[] = [
  // The font files are bundled with the renderer, and the OFL text ships in
  // the distribution as licenses/Zen-Maru-Gothic-OFL.txt.
  {
    name: 'Zen Maru Gothic (bundled font)',
    license: 'OFL-1.1',
    licenseUrl: 'https://openfontlicense.org/open-font-license-official-text/',
    sourceUrl: 'https://fonts.google.com/specimen/Zen+Maru+Gothic'
  },
  {
    name: 'Electron (Chromium / Node.js)',
    license: 'MIT',
    licenseUrl: 'https://github.com/electron/electron/blob/main/LICENSE',
    sourceUrl: 'https://github.com/electron/electron'
  },
  {
    name: 'React',
    license: 'MIT',
    licenseUrl: 'https://github.com/facebook/react/blob/main/LICENSE',
    sourceUrl: 'https://github.com/facebook/react'
  },
  {
    name: 'electron-store',
    license: 'MIT',
    licenseUrl: 'https://github.com/sindresorhus/electron-store/blob/main/license',
    sourceUrl: 'https://github.com/sindresorhus/electron-store'
  }
]

/**
 * Every URL the About section is allowed to open, closed over at build time.
 * The IPC handler matches against this exact set, so the renderer can never
 * turn the About links into a general "open any site" gate.
 */
export const ABOUT_URLS: ReadonlySet<string> = new Set([
  GITHUB_URL,
  `${GITHUB_URL}/blob/main/LICENSE`,
  `${GITHUB_URL}/blob/main/package.json`,
  ...THIRD_PARTY.flatMap((entry) => [entry.licenseUrl, entry.sourceUrl])
])
