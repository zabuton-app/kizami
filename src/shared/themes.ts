export type ThemeId = 'candy' | 'strawberryMilk' | 'melonSoda' | 'grapeGummy' | 'nightPudding'

/**
 * Color tokens for one theme. Token names mirror the confirmed design file
 * (`Pomodoro Candy v2.dc.html`) so values can be diffed against it directly.
 */
export interface ThemeTokens {
  /** Window background */
  bg: string
  /** Text, borders and hard shadows */
  ink: string
  /** Card and secondary-button background */
  card: string
  /** Session badge background */
  badge: string
  /** Primary button background */
  primary: string
  /** Primary button text */
  primaryText: string
  /** Progress block fill colors, cycled by index */
  palette: [string, string, string]
  /** Unfilled progress block */
  empty: string
  /** Muted text (task name, picker label) */
  sub: string
  /** Theme picker dot */
  dot: string
}

export const DEFAULT_THEME: ThemeId = 'candy'

/** Display order of the theme picker dots (matches the design). */
export const THEME_IDS: readonly ThemeId[] = [
  'candy',
  'strawberryMilk',
  'melonSoda',
  'grapeGummy',
  'nightPudding'
]

export const THEMES: Record<ThemeId, ThemeTokens> = {
  candy: {
    bg: '#fff6e9',
    ink: '#2d2a26',
    card: '#ffffff',
    badge: '#21b8a6',
    primary: '#ff6b57',
    primaryText: '#ffffff',
    palette: ['#ff6b57', '#ffc53d', '#21b8a6'],
    empty: 'rgba(45,42,38,.12)',
    sub: 'rgba(45,42,38,.55)',
    dot: '#ff6b57'
  },
  strawberryMilk: {
    bg: '#fdedf3',
    ink: '#5a2e3d',
    card: '#ffffff',
    badge: '#e8659a',
    primary: '#ec6a9c',
    primaryText: '#ffffff',
    palette: ['#ec6a9c', '#ffc2d4', '#8fd6c3'],
    empty: 'rgba(90,46,61,.12)',
    sub: 'rgba(90,46,61,.55)',
    dot: '#ec6a9c'
  },
  melonSoda: {
    bg: '#e7f6f4',
    ink: '#1e4d46',
    card: '#ffffff',
    badge: '#ff8a5c',
    primary: '#2bbba5',
    primaryText: '#ffffff',
    palette: ['#2bbba5', '#7fe0d0', '#ffd166'],
    empty: 'rgba(30,77,70,.12)',
    sub: 'rgba(30,77,70,.55)',
    dot: '#2bbba5'
  },
  grapeGummy: {
    bg: '#f3eefb',
    ink: '#43306b',
    card: '#ffffff',
    badge: '#ffab3d',
    primary: '#8f6fd8',
    primaryText: '#ffffff',
    palette: ['#8f6fd8', '#c9b1f2', '#ffc53d'],
    empty: 'rgba(67,48,107,.12)',
    sub: 'rgba(67,48,107,.55)',
    dot: '#8f6fd8'
  },
  nightPudding: {
    bg: '#2b2547',
    ink: '#ffe9a8',
    card: '#211c3c',
    badge: '#ff8fab',
    primary: '#ffc53d',
    primaryText: '#2b2547',
    palette: ['#ffc53d', '#ff8fab', '#7cd8c9'],
    empty: 'rgba(255,233,168,.15)',
    sub: 'rgba(255,233,168,.6)',
    dot: '#ffc53d'
  }
}

/** Coerce an arbitrary value into a valid ThemeId. */
export function asThemeId(value: unknown, fallback: ThemeId): ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)
    ? (value as ThemeId)
    : fallback
}
