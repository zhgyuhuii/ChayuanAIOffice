import { defineStrings } from '@chaoffice/i18n'
import { zh } from './ai/zh'
import { en } from './ai/en'
import { ja } from './ai/ja'
import { ko } from './ai/ko'
import { fr } from './ai/fr'
import { de } from './ai/de'
import { es } from './ai/es'
import { th } from './ai/th'
import { id } from './ai/id'
import { ru } from './ai/ru'
import { ar } from './ai/ar'
import { pt } from './ai/pt'
import { it } from './ai/it'
import { pl } from './ai/pl'
import { cs } from './ai/cs'
import { nl } from './ai/nl'
import { ms } from './ai/ms'
import { he } from './ai/he'
import { hi } from './ai/hi'
import { zhTW } from './ai/zh-TW'
// LOCAL(2026-09-21, d8201ad0): 多会话词条物理分离(B 区,制度 §3.1);C 区仅此一行 import + 下方 spread
import { localStrings } from './local/ai-local'
import { vi } from './ai/vi'
import { tr } from './ai/tr'
import { hu } from './ai/hu'

/** User-visible strings for the AI panel and tool feedback (LLM prompts are not here) */
export const aiStrings = defineStrings({
  zh: { ...zh, ...localStrings.zh },
  en: { ...en, ...localStrings.en },
  ja: { ...ja, ...localStrings.ja },
  ko: { ...ko, ...localStrings.ko },
  fr: { ...fr, ...localStrings.fr },
  de: { ...de, ...localStrings.de },
  es: { ...es, ...localStrings.es },
  th: { ...th, ...localStrings.th },
  id: { ...id, ...localStrings.id },
  ru: { ...ru, ...localStrings.ru },
  ar: { ...ar, ...localStrings.ar },
  pt: { ...pt, ...localStrings.pt },
  it: { ...it, ...localStrings.it },
  pl: { ...pl, ...localStrings.pl },
  cs: { ...cs, ...localStrings.cs },
  nl: { ...nl, ...localStrings.nl },
  ms: { ...ms, ...localStrings.ms },
  he: { ...he, ...localStrings.he },
  hi: { ...hi, ...localStrings.hi },
  'zh-TW': { ...zhTW, ...localStrings['zh-TW'] },
  vi: { ...vi, ...localStrings.vi },
  tr: { ...tr, ...localStrings.zh },
  zh,
  en,
  ja,
  ko,
  fr,
  de,
  es,
  th,
  id,
  ru,
  ar,
  pt,
  it,
  pl,
  cs,
  nl,
  ms,
  he,
  hi,
  'zh-TW': zhTW,
  vi,
  tr,
  hu,
})
