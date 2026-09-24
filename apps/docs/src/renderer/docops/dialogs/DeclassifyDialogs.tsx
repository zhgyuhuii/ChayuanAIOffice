// 文档脱密 / 脱密复原 dialogs — the chayuan-wps DocumentDeclassifyDialog and
// DocumentDeclassifyRestoreDialog contracts: keyword review table (editable
// terms/tokens/risk levels, occurrence counts, unmatched warnings), password
// gate with the wps policy, then descending placeholder replacement with the
// sealed backup landing in the sidecar next to the document.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useI18n } from '../../i18n/locale'
import { DocOpsField, DocOpsModal, DocOpsNotice, useAutoFocus } from './DocOpsModal'
import {
  applyDocumentDeclassify,
  buildNormalizedStream,
  buildReplacementPlan,
  buildSidecar,
  ensureUniqueReplacementTokens,
  extractSecretKeywordsWithModel,
  mergeLocalKeywordHits,
  restoreDeclassifyByTokens,
  validateDeclassifyPassword,
  type DeclassifySidecar,
  type KeywordEntry,
  type RiskLevel,
} from '../declassify'
import type { CompleteText } from '../model-complete'

// ---- 文档脱密 -----------------------------------------------------------------

type Phase = 'extracting' | 'review' | 'applying' | 'done' | 'error'

export function DeclassifyDialog({
  editor,
  docPath,
  complete,
  onDeclassified,
  onClose,
}: {
  editor: Editor
  /** absolute path of the saved document (sidecar anchor); null = not saved yet */
  docPath: string | null
  complete: CompleteText
  /** host callback: sidecar saved, ribbon buttons flip */
  onDeclassified: (sidecar: DeclassifySidecar) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>('extracting')
  const [entries, setEntries] = useState<KeywordEntry[]>([])
  const [errorText, setErrorText] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [resultCount, setResultCount] = useState(0)
  const [missing, setMissing] = useState<string[]>([])
  const startedRef = useRef(false)

  const fullText = useMemo(() => {
    const { normalized } = buildNormalizedStream(editor.state.doc)
    return normalized
  }, [editor])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void (async () => {
      try {
        const modelEntries = await extractSecretKeywordsWithModel(fullText, complete)
        const merged = mergeLocalKeywordHits(fullText, modelEntries ?? [])
        if (merged.length === 0) {
          setPhase('error')
          setErrorText(t('docopsDeclassifyNoKeywords'))
          return
        }
        setEntries(merged)
        setPhase('review')
      } catch {
        // model unreachable: the local regex fallback still declassifies
        const merged = mergeLocalKeywordHits(fullText, null)
        if (merged.length === 0) {
          setPhase('error')
          setErrorText(t('docopsDeclassifyExtractFailed'))
          return
        }
        setEntries(merged)
        setPhase('review')
      }
    })()
  }, [fullText, complete, t])

  // live occurrence preview per term
  const occurrences = useMemo(() => {
    const counts = new Map<string, number>()
    const { hits, unmatchedTerms } = buildReplacementPlan(editor.state.doc, entries)
    for (const hit of hits) counts.set(hit.term, (counts.get(hit.term) ?? 0) + 1)
    return { counts, unmatchedTerms }
  }, [editor, entries])

  const totalHits = useMemo(
    () => [...occurrences.counts.values()].reduce((a, b) => a + b, 0),
    [occurrences],
  )

  const passwordError = useMemo(() => {
    if (password === '' && password2 === '') return null
    const policy = validateDeclassifyPassword(password)
    if (policy) return t(`docopsPw${policy}` as never)
    if (password2 !== '' && password !== password2) return t('docopsPwMismatch')
    return null
  }, [password, password2, t])

  const canApply =
    phase === 'review' &&
    docPath !== null &&
    password !== '' &&
    password === password2 &&
    passwordError === null &&
    totalHits > 0

  const apply = useCallback(async () => {
    if (!docPath) return
    setPhase('applying')
    try {
      const tokenized = ensureUniqueReplacementTokens(entries, fullText)
      const { hits, unmatchedTerms } = buildReplacementPlan(editor.state.doc, tokenized)
      const originalText = buildNormalizedStream(editor.state.doc).normalized
      const count = applyDocumentDeclassify(editor, hits)
      if (count === 0) {
        setPhase('error')
        setErrorText(t('docopsDeclassifyNoHits'))
        return
      }
      const declassifiedText = buildNormalizedStream(editor.state.doc).normalized
      const sidecar = await buildSidecar(originalText, declassifiedText, tokenized, hits, password)
      const stored = await window.desktop.declassifyStore('save', docPath, sidecar)
      if (!stored.ok) {
        setPhase('error')
        setErrorText(t('docopsSidecarSaveFailed'))
        return
      }
      setResultCount(count)
      setMissing(unmatchedTerms)
      onDeclassified(sidecar)
      setPhase('done')
    } catch {
      setPhase('error')
      setErrorText(t('docopsDeclassifyApplyFailed'))
    }
  }, [docPath, entries, fullText, editor, password, onDeclassified, t])

  return (
    <DocOpsModal
      title={t('docopsDeclassifyTitle')}
      onClose={onClose}
      width={680}
      footer={
        phase === 'review' ? (
          <>
            <button className="btn-ghost" onClick={onClose}>
              {t('appCancel')}
            </button>
            <button className="btn-primary" disabled={!canApply} onClick={() => void apply()}>
              {t('docopsDeclassifyRun', { count: totalHits })}
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={onClose}>
            {t('appClose')}
          </button>
        )
      }
    >
      {phase === 'extracting' && <DocOpsNotice kind="info" text={t('docopsDeclassifyExtracting')} />}
      {phase === 'applying' && <DocOpsNotice kind="info" text={t('docopsDeclassifyApplying')} />}
      {phase === 'error' && <DocOpsNotice kind="warn" text={errorText} />}
      {phase === 'done' && (
        <>
          <DocOpsNotice kind="info" text={t('docopsDeclassifyDone', { count: resultCount })} />
          {missing.length > 0 && (
            <DocOpsNotice kind="warn" text={t('docopsDeclassifyUnmatched', { count: missing.length })} />
          )}
        </>
      )}
      {(phase === 'review' || phase === 'done') && (
        <>
          {docPath === null && phase === 'review' && (
            <DocOpsNotice kind="warn" text={t('docopsDeclassifyNeedSave')} />
          )}
          <div className="docops-table-wrap docops-table-scroll">
            <table className="docops-table">
              <thead>
                <tr>
                  <th>{t('docopsKwTerm')}</th>
                  <th>{t('docopsKwCategory')}</th>
                  <th>{t('docopsKwRisk')}</th>
                  <th>{t('docopsKwHits')}</th>
                  {phase === 'review' && <th />}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={`${entry.term}-${i}`}>
                    <td>
                      {phase === 'review' ? (
                        <input
                          className="docops-kw-term"
                          value={entry.term}
                          onChange={(e) => {
                            const next = [...entries]
                            next[i] = { ...entry, term: e.target.value }
                            setEntries(next)
                          }}
                        />
                      ) : (
                        entry.term
                      )}
                    </td>
                    <td>{entry.category}</td>
                    <td>
                      {phase === 'review' ? (
                        <select
                          value={entry.riskLevel}
                          onChange={(e) => {
                            const next = [...entries]
                            next[i] = { ...entry, riskLevel: e.target.value as RiskLevel }
                            setEntries(next)
                          }}
                        >
                          <option value="high">{t('docopsRiskHigh')}</option>
                          <option value="medium">{t('docopsRiskMedium')}</option>
                          <option value="low">{t('docopsRiskLow')}</option>
                        </select>
                      ) : (
                        entry.riskLevel
                      )}
                    </td>
                    <td>{occurrences.counts.get(entry.term) ?? 0}</td>
                    {phase === 'review' && (
                      <td>
                        <button
                          type="button"
                          className="docops-icon-btn"
                          aria-label={t('docopsKwRemove')}
                          onClick={() => setEntries(entries.filter((_, j) => j !== i))}
                        >
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {occurrences.unmatchedTerms.length > 0 && phase === 'review' && (
            <DocOpsNotice
              kind="warn"
              text={t('docopsDeclassifyUnmatched', { count: occurrences.unmatchedTerms.length })}
            />
          )}
          {phase === 'review' && (
            <div className="docops-two-col">
              <DocOpsField label={t('docopsPwLabel')} hint={t('docopsPwHint')}>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </DocOpsField>
              <DocOpsField label={t('docopsPw2Label')}>
                <input
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  autoComplete="new-password"
                />
              </DocOpsField>
            </div>
          )}
          {passwordError && phase === 'review' && (
            <DocOpsNotice kind="warn" text={passwordError} />
          )}
        </>
      )}
    </DocOpsModal>
  )
}

// ---- 脱密复原 -----------------------------------------------------------------

export function DeclassifyRestoreDialog({
  editor,
  docPath,
  onClose,
  onRestored,
}: {
  editor: Editor
  docPath: string | null
  onRestored: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [sidecar, setSidecar] = useState<DeclassifySidecar | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<
    { ok: true; restored: number; missing: number } | { ok: false; error: string } | null
  >(null)
  const pwRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!docPath) {
      setLoadState('none')
      return
    }
    void window.desktop
      .declassifyStore('load', docPath)
      .then((r) => {
        const sc = r.sidecar as DeclassifySidecar | null
        if (sc && sc.state?.status === 'declassified' && sc.envelope) {
          setSidecar(sc)
          setLoadState('ready')
        } else setLoadState('none')
      })
      .catch(() => setLoadState('error'))
  }, [docPath])

  useAutoFocus(pwRef)

  const restore = useCallback(async () => {
    if (!sidecar || !docPath || busy) return
    setBusy(true)
    try {
      const { openSidecar } = await import('../declassify')
      const payload = await openSidecar(sidecar, password)
      const outcome = restoreDeclassifyByTokens(
        editor,
        payload.replacements.map((r) => ({ token: r.token, term: r.term })),
      )
      await window.desktop.declassifyStore('clear', docPath)
      onRestored()
      setResult({ ok: true, restored: outcome.restored, missing: outcome.missingTokens.length })
    } catch {
      setResult({ ok: false, error: t('docopsRestoreWrongPassword') })
    } finally {
      setBusy(false)
    }
  }, [sidecar, docPath, busy, password, editor, onRestored, t])

  return (
    <DocOpsModal
      title={t('docopsRestoreTitle')}
      onClose={onClose}
      width={440}
      footer={
        result ? (
          <button className="btn-primary" onClick={onClose}>
            {t('appClose')}
          </button>
        ) : (
          <>
            <button className="btn-ghost" onClick={onClose}>
              {t('appCancel')}
            </button>
            <button
              className="btn-primary"
              disabled={loadState !== 'ready' || !password || busy}
              onClick={() => void restore()}
            >
              {busy ? t('docopsRestoring') : t('docopsRestoreRun')}
            </button>
          </>
        )
      }
    >
      {loadState === 'loading' && <DocOpsNotice kind="info" text={t('docopsRestoreLoading')} />}
      {loadState === 'none' && <DocOpsNotice kind="warn" text={t('docopsRestoreNone')} />}
      {loadState === 'error' && <DocOpsNotice kind="warn" text={t('docopsRestoreLoadFailed')} />}
      {loadState === 'ready' && sidecar && !result && (
        <>
          <DocOpsNotice
            kind="info"
            text={t('docopsRestoreState', {
              keywords: sidecar.state.keywordCount,
              replacements: sidecar.state.replacementCount,
            })}
          />
          <DocOpsField label={t('docopsPwLabel')}>
            <input
              ref={pwRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && password && void restore()}
            />
          </DocOpsField>
        </>
      )}
      {result &&
        (result.ok ? (
          <>
            <DocOpsNotice kind="info" text={t('docopsRestoreDone', { count: result.restored })} />
            {result.missing > 0 && (
              <DocOpsNotice kind="warn" text={t('docopsRestoreMissing', { count: result.missing })} />
            )}
          </>
        ) : (
          <DocOpsNotice kind="warn" text={result.error} />
        ))}
    </DocOpsModal>
  )
}
