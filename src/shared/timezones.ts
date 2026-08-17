import type { MessageKey } from './i18n'

/**
 * Region a curated zone belongs to. Used only to group the settings select,
 * so the buckets are coarse enough that no group is a single stray city.
 */
export type TimezoneRegion = 'asia' | 'europe' | 'americas' | 'oceania' | 'utc'

/** One selectable comparison timezone: the IANA zone plus how to present it. */
export interface TimezoneOption {
  /** IANA zone id, passed straight to `Intl` as a `timeZone`. */
  readonly zone: string
  /** Dictionary key for the city name, so labels follow the interface language. */
  readonly labelKey: MessageKey
  /** Group this option is listed under in the select. */
  readonly region: TimezoneRegion
}

/** Display order of the region groups in the settings select. */
export const TIMEZONE_REGIONS: readonly TimezoneRegion[] = [
  'asia',
  'europe',
  'americas',
  'oceania',
  'utc'
]

/**
 * The curated comparison timezones, in select order and grouped by region.
 * A deliberately short list of major cities rather than the full IANA
 * database: the choice is a dropdown, not a search box, and a stored value
 * is only valid if it appears here. Entries pair a city with the zone that
 * keeps its time, which is not always the same name — Delhi is served by
 * `Asia/Kolkata`.
 *
 * `as const satisfies` (not a plain annotation) is what keeps `CuratedZone`
 * a union of the literal zone ids instead of widening it to `string`.
 */
export const TIMEZONE_OPTIONS = [
  { zone: 'Asia/Tokyo', labelKey: 'timezone.tokyo', region: 'asia' },
  { zone: 'Asia/Seoul', labelKey: 'timezone.seoul', region: 'asia' },
  { zone: 'Asia/Shanghai', labelKey: 'timezone.shanghai', region: 'asia' },
  { zone: 'Asia/Taipei', labelKey: 'timezone.taipei', region: 'asia' },
  { zone: 'Asia/Hong_Kong', labelKey: 'timezone.hongKong', region: 'asia' },
  { zone: 'Asia/Singapore', labelKey: 'timezone.singapore', region: 'asia' },
  { zone: 'Asia/Bangkok', labelKey: 'timezone.bangkok', region: 'asia' },
  { zone: 'Asia/Jakarta', labelKey: 'timezone.jakarta', region: 'asia' },
  { zone: 'Asia/Kolkata', labelKey: 'timezone.delhi', region: 'asia' },
  { zone: 'Asia/Dubai', labelKey: 'timezone.dubai', region: 'asia' },
  { zone: 'Europe/London', labelKey: 'timezone.london', region: 'europe' },
  { zone: 'Europe/Paris', labelKey: 'timezone.paris', region: 'europe' },
  { zone: 'Europe/Berlin', labelKey: 'timezone.berlin', region: 'europe' },
  { zone: 'Europe/Madrid', labelKey: 'timezone.madrid', region: 'europe' },
  { zone: 'Europe/Moscow', labelKey: 'timezone.moscow', region: 'europe' },
  { zone: 'America/New_York', labelKey: 'timezone.newYork', region: 'americas' },
  { zone: 'America/Toronto', labelKey: 'timezone.toronto', region: 'americas' },
  { zone: 'America/Chicago', labelKey: 'timezone.chicago', region: 'americas' },
  { zone: 'America/Denver', labelKey: 'timezone.denver', region: 'americas' },
  { zone: 'America/Los_Angeles', labelKey: 'timezone.losAngeles', region: 'americas' },
  { zone: 'America/Mexico_City', labelKey: 'timezone.mexicoCity', region: 'americas' },
  { zone: 'America/Sao_Paulo', labelKey: 'timezone.saoPaulo', region: 'americas' },
  { zone: 'Australia/Sydney', labelKey: 'timezone.sydney', region: 'oceania' },
  { zone: 'Pacific/Auckland', labelKey: 'timezone.auckland', region: 'oceania' },
  { zone: 'Pacific/Honolulu', labelKey: 'timezone.honolulu', region: 'oceania' },
  { zone: 'UTC', labelKey: 'timezone.utc', region: 'utc' }
] as const satisfies readonly TimezoneOption[]

/** A zone id that the catalog offers. */
export type CuratedZone = (typeof TIMEZONE_OPTIONS)[number]['zone']

/** The user's comparison timezone; `null` is the explicit "not set" choice. */
export type SecondaryTimeZone = CuratedZone | null

const CURATED_ZONES: ReadonlySet<string> = new Set(TIMEZONE_OPTIONS.map((option) => option.zone))

/**
 * Whether an arbitrary value — a persisted setting, an IPC payload — is one
 * of the curated zones. A zone that is valid IANA but absent from the
 * catalog is rejected, because nothing in the UI could select it back.
 */
export function isCuratedZone(value: unknown): value is CuratedZone {
  return typeof value === 'string' && CURATED_ZONES.has(value)
}
