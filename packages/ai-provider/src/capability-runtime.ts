import {
  findProfile,
  resolveDefaultModel,
  resolveModelCall,
  type ResolvedModelCall,
} from './settings-v2'
import type { AiSettingsV2 } from './types'

/**
 * Media capability resolution — the runtime counterpart of the capability
 * tree (capability-tree.ts powers the settings page; this powers invocation).
 * One question, one answer: "the user configured a model of this kind — which
 * call does it resolve to?" Pure settings math plus an optional async secret
 * resolver; no network, no storage.
 */

export type MediaModelKind =
  'image' | 'video' | 'imageUnderstanding' | 'videoUnderstanding' | 'tts' | 'asr'

/** settings AiDefaultKind for each media kind (DEFAULT_KIND_TYPES drives auto-detect) */
const KIND_TO_DEFAULT: Record<MediaModelKind, Parameters<typeof resolveDefaultModel>[1]> = {
  image: 'image',
  video: 'videoGeneration',
  imageUnderstanding: 'imageUnderstanding',
  videoUnderstanding: 'videoUnderstanding',
  tts: 'tts',
  asr: 'asr',
}

export interface ResolveMediaCapabilityOptions {
  /**
   * Async secret resolution for profiles that only carry a credential
   * reference (harness source). Desktop file-backed profiles keep inline
   * keys and never hit this.
   */
  resolveSecret?: (profileId: string) => Promise<string | null>
}

/**
 * Resolve the configured default model for a media kind into a concrete call
 * (protocol + endpoint + key + model). Undefined = nothing usable is
 * configured — the honest "not configured" answer, never a fallback.
 */
export async function resolveMediaCapability(
  settings: AiSettingsV2,
  kind: MediaModelKind,
  options: ResolveMediaCapabilityOptions = {},
): Promise<ResolvedModelCall | undefined> {
  const selection = resolveDefaultModel(settings, KIND_TO_DEFAULT[kind])
  if (!selection) return undefined
  const profile = findProfile(settings, selection.profileId)
  if (!profile) return undefined
  let apiKey = profile.apiKey ?? ''
  if (!apiKey && options.resolveSecret) {
    apiKey = (await options.resolveSecret(profile.id)) ?? ''
  }
  if (!apiKey) return undefined
  return resolveModelCall(settings, selection, apiKey)
}

/** availability probe without resolving secrets (cheap, sync view for UIs).
 * True only when a model of the kind is selected AND its profile carries an
 * inline key or a login-backed auth — the same bar resolveMediaCapability
 * applies, so gating and invocation never disagree. */
export function hasMediaCapability(settings: AiSettingsV2, kind: MediaModelKind): boolean {
  const selection = resolveDefaultModel(settings, KIND_TO_DEFAULT[kind])
  if (!selection) return false
  const profile = findProfile(settings, selection.profileId)
  if (!profile) return false
  return !!profile.apiKey || profile.auth === 'chatoffice-login'
}

/**
 * True when the resolved call targets Alibaba DashScope (official host or an
 * aliyun-bailian/dashscope vendor profile). DashScope hosts its voice and
 * media APIs on native paths (/api/v1/...) alongside the compatible-mode
 * surface, so voice adapters must know to leave the OpenAI wire shapes.
 */
export function isDashscopeCall(call: ResolvedModelCall): boolean {
  if (/dashscope\.aliyuncs\.com/i.test(call.baseUrl)) return true
  return /aliyun-bailian|dashscope/i.test(call.vendorId ?? '')
}

/** DashScope native API root (origin) derived from the configured base URL,
 * which may be the native root itself or the compatible-mode surface. */
export function dashscopeRoot(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    if (/dashscope\.aliyuncs\.com$/i.test(url.hostname)) return url.origin
  } catch {
    /* fall through to the raw value */
  }
  return baseUrl.replace(/\/+$/, '')
}
