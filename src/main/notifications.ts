import { Notification } from 'electron'
import { t, type MessageKey } from '../shared/i18n'
import type { PhaseTransition } from '../shared/timer-logic'
import type { Settings } from '../shared/types'
import appIcon from '../../resources/icon.png?asset'

function messageKeysFor(transition: PhaseTransition): { title: MessageKey; body: MessageKey } {
  if (transition.from === 'work') {
    return transition.to === 'longBreak'
      ? { title: 'notification.workEndLong.title', body: 'notification.workEndLong.body' }
      : { title: 'notification.workEndShort.title', body: 'notification.workEndShort.body' }
  }
  return { title: 'notification.breakEnd.title', body: 'notification.breakEnd.body' }
}

/** Show a desktop notification for a phase transition, in the configured language. */
export function notifyTransition(transition: PhaseTransition, settings: Settings): void {
  if (!Notification.isSupported()) return
  const keys = messageKeysFor(transition)
  new Notification({
    title: t(settings.language, keys.title),
    body: t(settings.language, keys.body),
    icon: appIcon,
    silent: false
  }).show()
}

/** Show a desktop notification for a finished clock-mode timer. */
export function notifyClockTimerDone(settings: Settings): void {
  if (!Notification.isSupported()) return
  new Notification({
    title: t(settings.language, 'notification.clockTimerDone.title'),
    body: t(settings.language, 'notification.clockTimerDone.body'),
    icon: appIcon,
    silent: false
  }).show()
}
