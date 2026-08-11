import { useCallback, useEffect, useState } from 'react'
import { GITHUB_URL, THIRD_PARTY, type AboutInfo } from '../../shared/about'
import { t, type MessageKey } from '../../shared/i18n'
import {
  SETTINGS_LIMITS,
  type Language,
  type Settings,
  type UpdateCheckResult,
  type UpdateStatus
} from '../../shared/types'

interface SettingsViewProps {
  settings: Settings
  language: Language
  onUpdate: (patch: Partial<Settings>) => void
}

/**
 * Manual check progress. `result` and `error` are separate states on purpose:
 * a failed check must never read as "you're up to date".
 */
type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'result'; result: UpdateCheckResult }
  | { status: 'error' }

interface DurationField {
  key: 'workMinutes' | 'shortBreakMinutes' | 'longBreakMinutes'
  labelKey: MessageKey
}

const DURATION_FIELDS: DurationField[] = [
  { key: 'workMinutes', labelKey: 'settings.workMinutes' },
  { key: 'shortBreakMinutes', labelKey: 'settings.shortBreakMinutes' },
  { key: 'longBreakMinutes', labelKey: 'settings.longBreakMinutes' }
]

function Stepper({
  value,
  min,
  max,
  unit,
  onChange
}: {
  value: number
  min: number
  max: number
  unit: string
  onChange: (next: number) => void
}): React.JSX.Element {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper__btn"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="stepper__value">
        {value}
        {unit}
      </span>
      <button
        type="button"
        className="stepper__btn"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        aria-label="Increase"
      >
        ＋
      </button>
    </div>
  )
}

function UpdateSection({ language }: { language: Language }): React.JSX.Element {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [check, setCheck] = useState<CheckState>({ status: 'idle' })

  useEffect(() => {
    let active = true
    void window.kizami.getUpdateStatus().then((next) => {
      if (active) setStatus(next)
    })
    const off = window.kizami.onUpdateChanged((next) => setStatus(next))
    return () => {
      active = false
      off()
    }
  }, [])

  const checkNow = useCallback(() => {
    setCheck({ status: 'checking' })
    void window.kizami
      .checkForUpdate()
      .then((result) => setCheck(result ? { status: 'result', result } : { status: 'error' }))
      .catch(() => setCheck({ status: 'error' }))
  }, [])

  const skip = useCallback((version: string) => {
    void window.kizami.skipUpdateVersion(version).then(() => setCheck({ status: 'idle' }))
  }, [])

  // `check` only drives the one-line outcome message for a manual check. What is
  // actually offered comes solely from `status`, which the main process pushes on
  // every change — so the banner can never disagree with the gear badge, and a
  // stale manual result cannot hide an update found later by the startup check.
  const available = status?.available === true
  const latest = status?.latestVersion ?? null
  const url = status?.url ?? null

  return (
    <div className="settings__card">
      <div className="settings__row">
        <span className="settings__label">{t(language, 'settings.update')}</span>
        <button
          type="button"
          className="update__btn"
          onClick={checkNow}
          disabled={check.status === 'checking'}
        >
          {t(language, 'settings.updateCheckNow')}
        </button>
      </div>

      <div className="settings__row">
        <span className="settings__label">{t(language, 'settings.updateCurrentVersion')}</span>
        <span className="update__version">{status?.currentVersion ?? '—'}</span>
      </div>

      <div className="settings__row">
        <span className="settings__label">{t(language, 'settings.updateAuto')}</span>
        <button
          type="button"
          className={`switch ${status?.autoCheck ? 'switch--on' : ''}`}
          role="switch"
          aria-checked={status?.autoCheck ?? false}
          onClick={() => {
            void window.kizami.setUpdateAutoCheck(!status?.autoCheck).then(setStatus)
          }}
        >
          <span className="switch__knob" />
        </button>
      </div>

      {check.status === 'checking' && (
        <p className="update__note">{t(language, 'update.checking')}</p>
      )}
      {check.status === 'error' && (
        <p className="update__note">{t(language, 'update.checkFailed')}</p>
      )}
      {check.status === 'result' && !check.result.available && (
        <p className="update__note">{t(language, 'update.upToDate')}</p>
      )}

      {available && latest && (
        <div className="update__banner">
          <span className="update__banner-text">
            {t(language, 'update.available')}
            <strong className="update__banner-version">{latest}</strong>
          </span>
          <div className="update__banner-actions">
            {url && (
              <button
                type="button"
                className="update__btn update__btn--primary"
                onClick={() => void window.kizami.openReleasePage(url)}
              >
                {t(language, 'update.view')}
              </button>
            )}
            <button type="button" className="update__btn" onClick={() => skip(latest)}>
              {t(language, 'update.skip')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AboutSection({ language }: { language: Language }): React.JSX.Element {
  const [info, setInfo] = useState<AboutInfo | null>(null)

  useEffect(() => {
    let active = true
    void window.kizami.aboutInfo().then((next) => {
      if (active) setInfo(next)
    })
    return () => {
      active = false
    }
  }, [])

  const open = useCallback((url: string) => {
    void window.kizami.openAboutUrl(url)
  }, [])

  return (
    <div className="settings__card">
      <div className="settings__row">
        <span className="settings__label">{t(language, 'settings.about')}</span>
        <button type="button" className="update__btn" onClick={() => open(GITHUB_URL)}>
          GitHub
        </button>
      </div>

      <div className="about__identity">
        <span className="about__name">刻（kizami）</span>
        {info && (
          <>
            <span className="about__meta">
              {t(language, 'about.version')} {info.version}
            </span>
            <span className="about__meta">
              Electron {info.electron} / Chromium {info.chrome} / Node {info.node}
            </span>
          </>
        )}
      </div>

      <p className="about__meta">
        {t(language, 'about.appLicense')}{' '}
        <button
          type="button"
          className="about__link"
          onClick={() => open(`${GITHUB_URL}/blob/main/LICENSE`)}
        >
          MIT License
        </button>
      </p>

      <div className="about__oss">
        <span className="about__oss-title">{t(language, 'about.ossTitle')}</span>
        <p className="about__meta">{t(language, 'about.ossDesc')}</p>
        <ul className="about__list">
          {THIRD_PARTY.map((entry) => (
            <li key={entry.name} className="about__entry">
              <span className="about__entry-name">
                {entry.name}
                <span className="about__badge">{entry.license}</span>
              </span>
              <span className="about__entry-actions">
                <button
                  type="button"
                  className="about__link"
                  onClick={() => open(entry.licenseUrl)}
                >
                  {t(language, 'about.license')}
                </button>
                <button type="button" className="about__link" onClick={() => open(entry.sourceUrl)}>
                  {t(language, 'about.source')}
                </button>
              </span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="about__link"
          onClick={() => open(`${GITHUB_URL}/blob/main/package.json`)}
        >
          {t(language, 'about.fullDependencies')}
        </button>
      </div>
    </div>
  )
}

export function SettingsView({
  settings,
  language,
  onUpdate
}: SettingsViewProps): React.JSX.Element {
  const unit = t(language, 'settings.minutesUnit')

  // The task name must not be a controlled mirror of `settings`: onUpdate
  // round-trips through IPC and writes the value back asynchronously, which
  // cancels an in-flight IME composition on every keystroke. The input owns
  // its draft locally and only pushes changes outward.
  const [taskDraft, setTaskDraft] = useState(settings.taskName)

  return (
    <div className="settings">
      <h1 className="settings__title">{t(language, 'settings.title')}</h1>

      <div className="settings__card">
        {DURATION_FIELDS.map((field) => (
          <div key={field.key} className="settings__row">
            <span className="settings__label">{t(language, field.labelKey)}</span>
            <Stepper
              value={settings[field.key]}
              min={SETTINGS_LIMITS[field.key].min}
              max={SETTINGS_LIMITS[field.key].max}
              unit={unit}
              onChange={(next) => onUpdate({ [field.key]: next })}
            />
          </div>
        ))}

        <div className="settings__row">
          <span className="settings__label">{t(language, 'settings.autoStart')}</span>
          <button
            type="button"
            className={`switch ${settings.autoStart ? 'switch--on' : ''}`}
            role="switch"
            aria-checked={settings.autoStart}
            onClick={() => onUpdate({ autoStart: !settings.autoStart })}
          >
            <span className="switch__knob" />
          </button>
        </div>

        <div className="settings__row">
          <span className="settings__label">{t(language, 'settings.timeDisplay')}</span>
          <div className="segmented">
            <button
              type="button"
              className={`segmented__option ${settings.timeDisplay === 'remaining' ? 'segmented__option--active' : ''}`}
              onClick={() => onUpdate({ timeDisplay: 'remaining' })}
            >
              {t(language, 'timeDisplay.remaining')}
            </button>
            <button
              type="button"
              className={`segmented__option ${settings.timeDisplay === 'elapsed' ? 'segmented__option--active' : ''}`}
              onClick={() => onUpdate({ timeDisplay: 'elapsed' })}
            >
              {t(language, 'timeDisplay.elapsed')}
            </button>
          </div>
        </div>
      </div>

      <div className="settings__card">
        <div className="settings__row">
          <span className="settings__label">{t(language, 'settings.taskName')}</span>
        </div>
        <input
          type="text"
          className="text-input"
          value={taskDraft}
          maxLength={SETTINGS_LIMITS.taskNameMaxLength}
          placeholder={t(language, 'timer.defaultTask')}
          onChange={(event) => {
            setTaskDraft(event.target.value)
            onUpdate({ taskName: event.target.value })
          }}
        />

        <div className="settings__row">
          <span className="settings__label">{t(language, 'settings.language')}</span>
          <div className="segmented">
            <button
              type="button"
              className={`segmented__option ${settings.language === 'ja' ? 'segmented__option--active' : ''}`}
              onClick={() => onUpdate({ language: 'ja' })}
            >
              日本語
            </button>
            <button
              type="button"
              className={`segmented__option ${settings.language === 'en' ? 'segmented__option--active' : ''}`}
              onClick={() => onUpdate({ language: 'en' })}
            >
              English
            </button>
          </div>
        </div>

        <div className="settings__row">
          <span className="settings__label">{t(language, 'settings.trayIcon')}</span>
          <div className="segmented">
            <button
              type="button"
              className={`segmented__option ${settings.trayIcon === 'kizami' ? 'segmented__option--active' : ''}`}
              onClick={() => onUpdate({ trayIcon: 'kizami' })}
            >
              {t(language, 'trayIcon.kizami')}
            </button>
            <button
              type="button"
              className={`segmented__option ${settings.trayIcon === 'tomato' ? 'segmented__option--active' : ''}`}
              onClick={() => onUpdate({ trayIcon: 'tomato' })}
            >
              {t(language, 'trayIcon.tomato')}
            </button>
          </div>
        </div>
      </div>

      <UpdateSection language={language} />

      <AboutSection language={language} />
    </div>
  )
}
