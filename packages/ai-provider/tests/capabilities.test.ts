import { describe, expect, it } from 'vitest'
import {
  capabilityBlockers,
  functionCallingVerdict,
  resolveModelCapabilities,
} from '../src/capabilities'

const q = (vendorId: string, protocol: any, modelId: string) => ({ vendorId, protocol, modelId })

describe('functionCallingVerdict', () => {
  it('flags known no-FC models with a reason', () => {
    expect(functionCallingVerdict(q('deepseek', 'openai-compatible', 'deepseek-reasoner'))).toEqual({
      supported: false,
      reason: expect.stringContaining('does not support tool calls'),
    })
    expect(functionCallingVerdict(q('deepseek', 'openai-compatible', 'deepseek-r1-0528')).supported).toBe(false)
    expect(functionCallingVerdict(q('openai', 'openai-responses', 'o1-preview')).supported).toBe(false)
  })

  it('keeps FC-capable chat models supported', () => {
    expect(functionCallingVerdict(q('deepseek', 'openai-compatible', 'deepseek-chat')).supported).toBe(true)
    expect(functionCallingVerdict(q('openai', 'openai-responses', 'o3')).supported).toBe(true)
    expect(functionCallingVerdict(q('moonshot', 'openai-compatible', 'kimi-k3')).supported).toBe(true)
  })

  it('always trusts the chatoffice proxy presets', () => {
    expect(functionCallingVerdict(q('chatoffice', 'anthropic', 'claude-opus-4-7')).supported).toBe(true)
  })
})

describe('resolveModelCapabilities', () => {
  it('a no-FC model cannot be an operator', () => {
    const caps = resolveModelCapabilities(q('deepseek', 'openai-compatible', 'deepseek-reasoner'))
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
    const reasoner = q('deepseek', 'openai-compatible', 'deepseek-reasoner')
    expect(capabilityBlockers(reasoner, 'operator')).toHaveLength(1)
    expect(capabilityBlockers(q('deepseek', 'openai-compatible', 'deepseek-chat'), 'operator')).toHaveLength(0)
    expect(capabilityBlockers(reasoner, 'video')).toHaveLength(1)
    expect(capabilityBlockers(q('anthropic', 'anthropic', 'claude-sonnet-4-6'), 'attachment-video')).toHaveLength(1)
    expect(capabilityBlockers(q('anthropic', 'anthropic', 'claude-sonnet-4-6'), 'attachment-audio')).toHaveLength(1)
  })
})
