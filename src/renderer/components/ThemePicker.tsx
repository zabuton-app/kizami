import { t, type MessageKey } from '../../shared/i18n'
import { THEME_IDS, THEMES, type ThemeId } from '../../shared/themes'
import type { Language } from '../../shared/types'

interface ThemePickerProps {
  language: Language
  theme: ThemeId
  onSelect: (theme: ThemeId) => void
}

export function ThemePicker({ language, theme, onSelect }: ThemePickerProps): React.JSX.Element {
  return (
    <div className="theme-picker">
      {THEME_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className={`theme-picker__dot ${id === theme ? 'theme-picker__dot--active' : ''}`}
          title={t(language, `theme.${id}` as MessageKey)}
          aria-label={t(language, `theme.${id}` as MessageKey)}
          aria-pressed={id === theme}
          style={{ background: THEMES[id].dot }}
          onClick={() => onSelect(id)}
        />
      ))}
    </div>
  )
}
