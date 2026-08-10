import type { Language } from '../types'
import { ja } from './ja'
import { en } from './en'

export type MessageKey = keyof typeof ja

const dictionaries: Record<Language, Record<MessageKey, string>> = { ja, en }

/** Resolve a UI message for the given language. */
export function t(language: Language, key: MessageKey): string {
  return dictionaries[language][key]
}

export { ja, en }
