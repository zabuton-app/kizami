import { t, type MessageKey } from '../../shared/i18n'
import {
  isCuratedZone,
  TIMEZONE_OPTIONS,
  TIMEZONE_REGIONS,
  type SecondaryTimeZone,
  type TimezoneOption,
  type TimezoneRegion
} from '../../shared/timezones'
import type { Language } from '../../shared/types'

interface TimezoneSelectProps {
  language: Language
  value: SecondaryTimeZone
  onSelect: (zone: SecondaryTimeZone) => void
}

/** One rendered `optgroup`: a region and the catalog entries listed under it. */
export interface TimezoneGroup {
  readonly region: TimezoneRegion
  readonly options: readonly TimezoneOption[]
}

/**
 * Split the catalog into the select's groups, in `TIMEZONE_REGIONS` order.
 * Derived rather than hand-written so a city added to the catalog cannot be
 * missing from the control. Regions with no entries are dropped, because an
 * empty `optgroup` renders as a heading with nothing under it.
 */
export function groupByRegion(options: readonly TimezoneOption[]): readonly TimezoneGroup[] {
  return TIMEZONE_REGIONS.map((region) => ({
    region,
    options: options.filter((option) => option.region === region)
  })).filter((group) => group.options.length > 0)
}

// The catalog is a module constant, so the grouping is computed once rather
// than on every settings render.
const GROUPS = groupByRegion(TIMEZONE_OPTIONS)

/** Value of the leading "not set" option; the empty string maps back to `null`. */
const NONE_VALUE = ''

/**
 * The comparison-timezone control. A native `select` on purpose: keyboard
 * navigation, type-ahead and the announcement of the current selection come
 * from the platform, which a custom listbox would have to rebuild, and the
 * settings screen already hosts a native `input` for the task name.
 *
 * The "not set" option maps to `null`, never `undefined`: a settings patch
 * reads an omitted key as "leave this alone", so `undefined` would keep the
 * previously chosen city instead of clearing it.
 */
export function TimezoneSelect({
  language,
  value,
  onSelect
}: TimezoneSelectProps): React.JSX.Element {
  return (
    <select
      className="tz-select"
      value={value ?? NONE_VALUE}
      // The visible row label is a plain span, as on every other settings row,
      // so the control names itself here rather than relying on proximity.
      aria-label={t(language, 'settings.secondaryTimeZone')}
      onChange={(event) => {
        const next = event.target.value
        onSelect(isCuratedZone(next) ? next : null)
      }}
    >
      <option value={NONE_VALUE}>{t(language, 'timezone.none')}</option>
      {GROUPS.map((group) => (
        <optgroup
          key={group.region}
          label={t(language, `timezone.region.${group.region}` as MessageKey)}
        >
          {group.options.map((option) => (
            <option key={option.zone} value={option.zone}>
              {t(language, option.labelKey)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
