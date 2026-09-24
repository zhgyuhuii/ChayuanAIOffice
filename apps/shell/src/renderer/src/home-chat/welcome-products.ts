import type { StringKey } from '../locale'

/** landing product cards + plaza banner: copy lives in strings.ts (zh/en
 * curated, other langs fall back to the English value); chips are '|'-joined
 * single keys to keep the 20-block i18n insertion manageable */

const SITE_URL = 'https://aidooo.com'
const PRODUCTS_URL = `${SITE_URL}/products`

export interface WelcomeProduct {
  id: 'os' | 'office' | 'assistant' | 'pod' | 'cmd'
  nameKey: StringKey
  descKey: StringKey
  chipsKey: StringKey
  /** null on the unbuilt platform card: tapping it shows a toast instead */
  url: string | null
  soon: boolean
}

/** left-to-right order is the signed consensus: OS, Office, assistant, pod, platform */
export const WELCOME_PRODUCTS: readonly WelcomeProduct[] = [
  {
    id: 'os',
    nameKey: 'welcomeOsName',
    descKey: 'welcomeOsDesc',
    chipsKey: 'welcomeOsChips',
    url: `${PRODUCTS_URL}/os`,
    soon: false,
  },
  {
    id: 'office',
    nameKey: 'welcomeOfficeName',
    descKey: 'welcomeOfficeDesc',
    chipsKey: 'welcomeOfficeChips',
    url: `${PRODUCTS_URL}/office`,
    soon: false,
  },
  {
    id: 'assistant',
    nameKey: 'welcomeAssistantName',
    descKey: 'welcomeAssistantDesc',
    chipsKey: 'welcomeAssistantChips',
    url: `${PRODUCTS_URL}/chayuan`,
    soon: false,
  },
  {
    id: 'pod',
    nameKey: 'welcomePodName',
    descKey: 'welcomePodDesc',
    chipsKey: 'welcomePodChips',
    url: PRODUCTS_URL,
    soon: false,
  },
  {
    id: 'cmd',
    nameKey: 'welcomeCmdName',
    descKey: 'welcomeCmdDesc',
    chipsKey: 'welcomeCmdChips',
    url: null,
    soon: true,
  },
] as const

export const WELCOME_PLAZA_URL = SITE_URL
export const WELCOME_PLAZA_NAME_KEY: StringKey = 'welcomePlazaName'
export const WELCOME_PLAZA_DESC_KEY: StringKey = 'welcomePlazaDesc'
export const WELCOME_PLAZA_BADGES_KEY: StringKey = 'welcomePlazaBadges'
export const WELCOME_PLAZA_CTA_KEY: StringKey = 'welcomePlazaCta'
