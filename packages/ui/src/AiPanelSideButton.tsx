import React, { useState } from 'react'
import type { Lang } from '@chatoffice/i18n'
import type { AiPanelPrefs, AiPanelSide } from './ai-panel-prefs'
import { applyAiPanelPrefs, useAiPanelPrefs } from './ai-panel-prefs-store'

// Shared by every editor's AI header; each label names the destination side.
const LABELS: Record<Lang, Record<AiPanelSide, string>> = {
  zh: { left: '将 AI 面板移到左侧', right: '将 AI 面板移到右侧' },
  en: { left: 'Move AI panel to the left', right: 'Move AI panel to the right' },
  ja: { left: 'AI パネルを左側に移動', right: 'AI パネルを右側に移動' },
  ko: { left: 'AI 패널을 왼쪽으로 이동', right: 'AI 패널을 오른쪽으로 이동' },
  fr: { left: 'Déplacer le panneau IA à gauche', right: 'Déplacer le panneau IA à droite' },
  de: { left: 'KI-Panel nach links verschieben', right: 'KI-Panel nach rechts verschieben' },
  es: { left: 'Mover el panel de IA a la izquierda', right: 'Mover el panel de IA a la derecha' },
  th: { left: 'ย้ายแผง AI ไปด้านซ้าย', right: 'ย้ายแผง AI ไปด้านขวา' },
  id: { left: 'Pindahkan panel AI ke kiri', right: 'Pindahkan panel AI ke kanan' },
  ru: { left: 'Переместить панель ИИ влево', right: 'Переместить панель ИИ вправо' },
  ar: {
    left: 'نقل لوحة الذكاء الاصطناعي إلى اليسار',
    right: 'نقل لوحة الذكاء الاصطناعي إلى اليمين',
  },
  pt: {
    left: 'Mover o painel de IA para a esquerda',
    right: 'Mover o painel de IA para a direita',
  },
  it: { left: 'Sposta il pannello IA a sinistra', right: 'Sposta il pannello IA a destra' },
  pl: { left: 'Przenieś panel AI na lewo', right: 'Przenieś panel AI na prawo' },
  cs: { left: 'Přesunout panel AI doleva', right: 'Přesunout panel AI doprava' },
  nl: { left: 'AI-paneel naar links verplaatsen', right: 'AI-paneel naar rechts verplaatsen' },
  ms: { left: 'Alihkan panel AI ke kiri', right: 'Alihkan panel AI ke kanan' },
  he: { left: 'העברת חלונית הבינה המלאכותית לשמאל', right: 'העברת חלונית הבינה המלאכותית לימין' },
  hi: { left: 'AI पैनल को बाईं ओर ले जाएँ', right: 'AI पैनल को दाईं ओर ले जाएँ' },
  'zh-TW': { left: '將 AI 面板移到左側', right: '將 AI 面板移到右側' },
}

export function AiPanelSideButton({
  lang,
  onMove,
}: {
  lang: Lang
  onMove: (side: AiPanelSide) => Promise<AiPanelPrefs>
}) {
  const { side } = useAiPanelPrefs()
  const [pending, setPending] = useState(false)
  const destination = side === 'left' ? 'right' : 'left'
  const label = LABELS[lang][destination]
  const move = async () => {
    setPending(true)
    try {
      applyAiPanelPrefs(await onMove(destination))
    } catch (error) {
      console.error('[ai-panel] Failed to save panel position:', error)
    } finally {
      setPending(false)
    }
  }
  return (
    <button
      type="button"
      className="ai-header-btn ai-panel-side-button"
      data-tip={label}
      aria-label={label}
      disabled={pending}
      onClick={() => void move()}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={destination === 'left' ? { transform: 'scaleX(-1)' } : undefined}
      >
        <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
        <path d="M11.5 2.5v11M4 8h5M7 5.8 9.2 8 7 10.2" />
      </svg>
    </button>
  )
}
