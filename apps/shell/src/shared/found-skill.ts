/**
 * The shape of a SKILL.md ChaAI Office found on this machine, shared by the
 * main process that reads the files and the renderer that lists them.
 *
 * The definitions live in `@chaoffice/agent-core/skills-store` beside the
 * reader, so the web sidecar's HTTP surface answers with the exact same
 * shapes; this file keeps the renderer's import paths unchanged.
 */

export type { FoundSkill, RecommendedSkill } from '@chaoffice/agent-core/skills-store'
