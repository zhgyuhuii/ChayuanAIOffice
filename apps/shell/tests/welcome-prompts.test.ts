// Welcome-screen combo greeting pool (chayuan-wps style): 4×4×4 = 64
// combinations assembled from opening/ability/action, and the pick never
// repeats the previous one across landing visits.
import { describe, expect, it } from 'vitest'
import { pickWelcomePrompt } from '../src/renderer/src/home-chat/welcome-prompts'

const OPENINGS = [
  '欢迎使用察元AI Office。',
  '你好，我是你的 AI 办公助手。',
  '察元AI Office 已准备就绪。',
  '欢迎回来，随时开始。',
]
const ABILITIES = [
  '我可以写文档、做表格、生成演示，也能就地修改已打开的文档，',
  '从周报、通知到方案、汇报，一句话就能起步，',
  '支持中文写作、润色校对与格式整理，',
  '生成结果直接落到工程文件，随时继续编辑，',
]
const ACTIONS = [
  '从一句「帮我写」开始。',
  '把目标告诉我，我来出初稿。',
  '现在就可以开始。',
  '你负责思路，我负责产出。',
]

const KEY_TO_TEXT: Record<string, string> = {}
OPENINGS.forEach((v, i) => (KEY_TO_TEXT[`welcomeOpen${i + 1}`] = v))
ABILITIES.forEach((v, i) => (KEY_TO_TEXT[`welcomeAbility${i + 1}`] = v))
ACTIONS.forEach((v, i) => (KEY_TO_TEXT[`welcomeAction${i + 1}`] = v))

function translate(key: string): string {
  return KEY_TO_TEXT[key] ?? key
}

describe('pickWelcomePrompt', () => {
  it('assembles opening+ability+action from the pools', () => {
    for (let i = 0; i < 40; i += 1) {
      const text = pickWelcomePrompt(translate)
      const opening = OPENINGS.find((o) => text.startsWith(o))
      const action = ACTIONS.find((a) => text.endsWith(a))
      expect(opening).toBeTruthy()
      expect(action).toBeTruthy()
      const body = text.slice((opening ?? '').length, text.length - (action ?? '').length)
      expect(ABILITIES).toContain(body)
    }
  })

  it('never repeats the previous pick in a row', () => {
    let prev = ''
    for (let i = 0; i < 200; i += 1) {
      const text = pickWelcomePrompt(translate)
      if (prev) expect(text).not.toBe(prev)
      prev = text
    }
  })

  it('reaches more than one distinct combination over many picks', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 400; i += 1) seen.add(pickWelcomePrompt(translate))
    expect(seen.size).toBeGreaterThan(10)
  })
})
