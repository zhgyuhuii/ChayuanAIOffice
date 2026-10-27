import { describe, expect, it } from 'vitest'
import {
  capabilityBlockers,
  functionCallingVerdict,
  geminiThinkingBudget,
  resolveModelCapabilities,
} from '../src/capabilities'

const q = (vendorId: string, protocol: any, modelId: string) => ({ vendorId, protocol, modelId })

describe('functionCallingVerdict', () => {
  it('flags known no-FC models with a reason', () => {
    // V4-era reasoner alias returns tool_calls (live API, 2026-09); legacy R1 stays no-FC
    expect(functionCallingVerdict(q('deepseek', 'openai-compatible', 'deepseek-reasoner')).supported).toBe(true)
    expect(functionCallingVerdict(q('deepseek', 'openai-compatible', 'deepseek-r1-0528')).supported).toBe(false)
    expect(functionCallingVerdict(q('openai', 'openai-responses', 'o1-preview')).supported).toBe(false)
  })

  it('keeps FC-capable chat models supported', () => {
    expect(functionCallingVerdict(q('deepseek', 'openai-compatible', 'deepseek-chat')).supported).toBe(true)
    expect(functionCallingVerdict(q('openai', 'openai-responses', 'o3')).supported).toBe(true)
    expect(functionCallingVerdict(q('moonshot', 'openai-compatible', 'kimi-k3')).supported).toBe(true)
  })

  it('always trusts the chaoffice proxy presets', () => {
    expect(functionCallingVerdict(q('chaoffice', 'anthropic', 'claude-opus-4-7')).supported).toBe(true)
  })
})

describe('resolveModelCapabilities', () => {
  it('a no-FC model cannot be an operator', () => {
    const caps = resolveModelCapabilities(q('deepseek', 'openai-compatible', 'deepseek-r1-0528'))
    expect(caps.functionCalling).toBe(false)
  })

  it('audio input follows the protocol matrix', () => {
    expect(resolveModelCapabilities(q('gemini', 'gemini', 'gemini-3-flash')).audioInput).toBe(true)
    expect(resolveModelCapabilities(q('openai', 'openai-compatible', 'gpt-5.6')).audioInput).toBe(true)
    expect(resolveModelCapabilities(q('anthropic', 'anthropic', 'claude-sonnet-4-6')).audioInput).toBe(false)
  })

  it('video input is gemini-native or vendor-whitelisted on openai routes', () => {
    expect(resolveModelCapabilities(q('gemini', 'gemini', 'gemini-3-flash')).videoInput).toBe(true)
    expect(resolveModelCapabilities(q('aliyun-bailian', 'openai-compatible', 'qwen-vl-max')).videoInput).toBe(true)
    expect(resolveModelCapabilities(q('zhipu', 'openai-compatible', 'glm-4v-plus')).videoInput).toBe(true)
    expect(resolveModelCapabilities(q('openai', 'openai-responses', 'gpt-5.6')).videoInput).toBe(false)
    expect(resolveModelCapabilities(q('anthropic', 'anthropic', 'claude-sonnet-4-6')).videoInput).toBe(false)
  })

  it('media generation requires both model type and a wired vendor', () => {
    expect(resolveModelCapabilities(q('aliyun-bailian', 'openai-compatible', 'wanx2.1-t2v-turbo')).videoGeneration).toBe(true)
    expect(resolveModelCapabilities(q('deepseek', 'openai-compatible', 'wanx2.1-t2v-turbo')).videoGeneration).toBe(false)
    expect(resolveModelCapabilities(q('aliyun-bailian', 'openai-compatible', 'qwen-turbo')).videoGeneration).toBe(false)
    expect(resolveModelCapabilities(q('aliyun-bailian', 'openai-compatible', 'qwen-image')).imageGeneration).toBe(true)
  })

  it('text-only vendor models lose vision (DeepSeek V4 Pro/Flash)', () => {
    expect(resolveModelCapabilities(q('deepseek', 'openai-compatible', 'deepseek-v4-pro')).vision).toBe(false)
    expect(resolveModelCapabilities(q('deepseek', 'openai-compatible', 'deepseek-v4-flash-vision')).vision).toBe(true)
  })
})

describe('capabilityBlockers', () => {
  it('explains operator/image/attachment blockers', () => {
    const r1 = q('deepseek', 'openai-compatible', 'deepseek-r1-0528')
    expect(capabilityBlockers(r1, 'operator')).toHaveLength(1)
    expect(capabilityBlockers(q('deepseek', 'openai-compatible', 'deepseek-chat'), 'operator')).toHaveLength(0)
    // a chat model has no media channel regardless of FC
    expect(capabilityBlockers(r1, 'video')).toHaveLength(1)
    expect(capabilityBlockers(q('anthropic', 'anthropic', 'claude-sonnet-4-6'), 'attachment-video')).toHaveLength(1)
    expect(capabilityBlockers(q('anthropic', 'anthropic', 'claude-sonnet-4-6'), 'attachment-audio')).toHaveLength(1)
  })
})

describe('recraft vendor (SVG-line image generation)', () => {
  it('recraft model ids infer as image-generation and are wired to the image channel', () => {
    expect(resolveModelCapabilities(q('recraft', 'openai-compatible', 'recraftv3')).imageGeneration).toBe(true)
    expect(resolveModelCapabilities(q('recraft', 'openai-compatible', 'recraftv3')).videoGeneration).toBe(false)
  })
})

describe('geminiThinkingBudget', () => {
  it('caps the default-on 2.5 thinking at a quarter of the turn budget', () => {
    expect(geminiThinkingBudget('gemini-2.5-pro', 32768)).toBe(8192)
    expect(geminiThinkingBudget('gemini-2.5-flash', 32768)).toBe(8192)
    expect(geminiThinkingBudget('gemini-2.5-flash', 4096)).toBe(1024)
    expect(geminiThinkingBudget('gemini-2.5-flash-preview', 65536)).toBe(8192)
  })

  it('stays out of the small-budget and unverified-model ranges', () => {
    // per-model minimums (512 flash-lite) get risky when every token counts
    expect(geminiThinkingBudget('gemini-2.5-flash', 4095)).toBeUndefined()
    expect(geminiThinkingBudget('gemini-2.5-flash-lite', 2048)).toBeUndefined()
    // 1.x/2.0 reject the field; 3.x moved to thinking_level
    expect(geminiThinkingBudget('gemini-1.5-flash', 32768)).toBeUndefined()
    expect(geminiThinkingBudget('gemini-2.0-flash', 32768)).toBeUndefined()
    expect(geminiThinkingBudget('gemini-3-pro', 32768)).toBeUndefined()
  })
})
