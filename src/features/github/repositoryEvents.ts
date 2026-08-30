export interface RepositoryChangedMessage {
  type: 'repository-changed'
  repositoryId: string
  headSha: string
}

export interface AccessChangedMessage {
  type: 'access-changed'
  repositoryId: string
}

/** The complete, deliberately content-free live notification protocol. */
export type RepositoryEventMessage =
  RepositoryChangedMessage | AccessChangedMessage

export function isRepositoryEventMessage(
  value: unknown,
): value is RepositoryEventMessage {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate)

  if (
    candidate.type === 'access-changed' &&
    typeof candidate.repositoryId === 'string' &&
    /^[1-9][0-9]*$/.test(candidate.repositoryId)
  ) {
    return keys.length === 2
  }

  return (
    candidate.type === 'repository-changed' &&
    typeof candidate.repositoryId === 'string' &&
    /^[1-9][0-9]*$/.test(candidate.repositoryId) &&
    typeof candidate.headSha === 'string' &&
    /^[a-f0-9]{40,64}$/.test(candidate.headSha) &&
    keys.length === 3
  )
}
