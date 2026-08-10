/// <reference types="vite/client" />
import type { KizamiApi } from '../shared/types'

declare global {
  interface Window {
    kizami: KizamiApi
  }
}

export {}
