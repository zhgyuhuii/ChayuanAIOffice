import type { HomeChatSession, HomeChatSessionScope } from '../../../shared/home-api'

/** one tree level in the history dropdown: a project, a file, or unattached */
export interface HomeChatSessionGroup {
  /** 'project:<id>' | 'file:<path>' | 'unattached' */
  key: string
  /** null = unattached (no project/file ownership) */
  scope: HomeChatSessionScope | null
  sessions: HomeChatSession[]
}

/** group sessions the way the left tree organizes them: projects, then files, then unattached */
export function groupSessionsByTree(sessions: HomeChatSession[]): HomeChatSessionGroup[] {
  const groups = new Map<string, HomeChatSessionGroup>()
  for (const s of sessions) {
    const scope = s.scope ?? null
    const key = scope ? `${scope.kind}:${scope.id}` : 'unattached'
    let group = groups.get(key)
    if (!group) {
      group = { key, scope, sessions: [] }
      groups.set(key, group)
    }
    group.sessions.push(s)
  }
  const rank = (g: HomeChatSessionGroup): number =>
    g.scope ? (g.scope.kind === 'project' ? 0 : 1) : 2
  return [...groups.values()].sort((a, b) => rank(a) - rank(b))
}

/** display name of a group node: file basename / project name / 未归属 label */
export function groupNameOf(
  group: HomeChatSessionGroup,
  projects: Array<{ id: string; name: string }>,
  unattachedLabel: string,
): string {
  if (!group.scope) return unattachedLabel
  if (group.scope.kind === 'file') {
    return group.scope.id.split(/[\\/]/).pop() || group.scope.id
  }
  return projects.find((p) => p.id === group.scope!.id)?.name ?? group.scope.id
}
