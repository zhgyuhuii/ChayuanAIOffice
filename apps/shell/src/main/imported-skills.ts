/**
 * The skills a user installed into ChaAI Office.
 *
 * The implementation moved to `@chaoffice/agent-core/skills-store` so the web
 * sidecar (apps/server) calls the exact same import rules — size caps, entry
 * checks, scratch-then-rename — over HTTP instead of a drifting copy. The
 * Electron main keeps importing from here: integrations-ipc (the settings
 * pane) and user-cli (the composer picker) are unchanged.
 */

export {
  importDirBytes,
  importMdBytes,
  importSkillDir,
  importSkillMd,
  importSkillZip,
  installRecommendedSkill,
  isKnownSkillPath,
  readSkillBody,
  recommendedSkills,
  removeSkill,
  skillVersion,
  skillsRoot,
  usableSkills,
  type FoundSkill,
  type RecommendedSkill,
} from '@chaoffice/agent-core/skills-store'
