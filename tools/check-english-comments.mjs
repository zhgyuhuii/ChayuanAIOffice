#!/usr/bin/env node
// Fork policy (differs from upstream, deliberately): code comments in this
// fork may be Chinese — the LOCAL stitch annotations, round tags and feature
// notes are written in Chinese by convention and future sync rounds grep for
// them. This gate therefore enforces English-only on the documentation layer
// only, minus the fork's bilingual surfaces. Upstream's stricter
// English-only-comments rule is tracked as an upstream-ism we do not adopt.
//
// Functional CJK is fine anywhere (i18n resources, fixture text, zh-UI
// matchers, prompt guides, localized help topics under i18n/, html boot/brand
// markup, the bilingual README pair, CLAUDE.md governance text, docs/**
// design prose, and code comments per the policy above).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const HAN = /[\u3400-\u9fff]/

/** md surfaces that are bilingual or Chinese by design */
const BILINGUAL_DOCS = new Set(['README.md', 'README.en.md', 'CLAUDE.md'])
/** doc directories that are deliberately Chinese or localized in this fork */
const BILINGUAL_DOC_DIRS = [
  'docs/',
  'i18n/',
  'articles/',
  'brand-samples/',
  'dsh-plugin/',
  'skills/',
]

const git = spawnSync('git', ['ls-files'], { encoding: 'utf8' })
if (git.status !== 0) {
  console.error(git.stderr)
  process.exit(git.status ?? 1)
}
const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()

const violations = []
for (const file of git.stdout.trim().split('\n')) {
  // markdown docs layer only; code comments and html follow the fork's
  // bilingual convention (annotations, boot brand text, localized UI)
  const isDoc = /\.md$/.test(file) && !file.includes('/ai/prompts/')
  if (!isDoc) continue
  if (BILINGUAL_DOCS.has(file)) continue
  if (BILINGUAL_DOC_DIRS.some((dir) => file.includes(dir))) continue
  const lines = readFileSync(join(root, file), 'utf8').split('\n')
  lines.forEach((line, index) => {
    if (HAN.test(line)) {
      violations.push(`  ${file}:${index + 1}: ${line.trim()}`)
    }
  })
}

if (violations.length > 0) {
  console.error(
    `Chinese text found in code comments or docs:\n${violations.join('\n')}\n` +
      'Comments and documentation must be English-only. Move CJK text into ' +
      'string literals or rewrite the comment in English.',
  )
  process.exit(1)
}
console.log('check-english-comments: OK')
