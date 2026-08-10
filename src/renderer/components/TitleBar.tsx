import { t } from '../../shared/i18n'
import type { Language } from '../../shared/types'

/**
 * The title bar only exists in the normal view; mini mode draws its own bar
 * and uses the bar itself as the drag handle.
 */
interface TitleBarProps {
  language: Language
  settingsOpen: boolean
  /** A newer, non-skipped release was detected; marks the gear with a dot. */
  updateAvailable: boolean
  onClose: () => void
  onToggleMini: () => void
  onToggleSettings: () => void
}

function MiniToggleIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  )
}

export function TitleBar({
  language,
  settingsOpen,
  updateAvailable,
  onClose,
  onToggleMini,
  onToggleSettings
}: TitleBarProps): React.JSX.Element {
  return (
    <div className="titlebar">
      <button
        type="button"
        className="titlebar__dot titlebar__dot--close"
        aria-label="Close"
        onClick={onClose}
      />
      <span className="titlebar__dot titlebar__dot--yellow" />
      <span className="titlebar__dot titlebar__dot--green" />
      <span className="titlebar__spacer" />
      {!settingsOpen && (
        <button
          type="button"
          className="titlebar__mini"
          aria-label={t(language, 'titlebar.mini')}
          onClick={onToggleMini}
        >
          <MiniToggleIcon />
        </button>
      )}
      <button
        type="button"
        className="titlebar__gear"
        aria-label={settingsOpen ? 'Back' : 'Settings'}
        onClick={onToggleSettings}
      >
        {settingsOpen ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="m11 18-6-6 6-6" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          >
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.5Z" />
          </svg>
        )}
        {updateAvailable && !settingsOpen && <span className="titlebar__badge" />}
      </button>
    </div>
  )
}
