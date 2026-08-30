import { describe, expect, it } from 'bun:test'

import { isRepositoryEventMessage } from './repositoryEvents.ts'

const HEAD_SHA = 'a'.repeat(40)

describe('isRepositoryEventMessage', () => {
  it('accepts the two messages the hub sends', () => {
    expect(
      isRepositoryEventMessage({
        type: 'repository-changed',
        repositoryId: '42',
        headSha: HEAD_SHA,
      }),
    ).toBe(true)
    expect(
      isRepositoryEventMessage({
        type: 'access-changed',
        repositoryId: '42',
      }),
    ).toBe(true)
  })

  it('rejects anything carrying more than the protocol allows', () => {
    expect(
      isRepositoryEventMessage({
        type: 'repository-changed',
        repositoryId: '42',
        headSha: HEAD_SHA,
        plan: { name: 'Flat' },
      }),
    ).toBe(false)
  })

  it('rejects malformed ids and SHAs', () => {
    expect(
      isRepositoryEventMessage({
        type: 'repository-changed',
        repositoryId: '0',
        headSha: HEAD_SHA,
      }),
    ).toBe(false)
    expect(
      isRepositoryEventMessage({
        type: 'repository-changed',
        repositoryId: '42',
        headSha: 'not-a-sha',
      }),
    ).toBe(false)
  })

  it('rejects values that are not messages at all', () => {
    expect(isRepositoryEventMessage(null)).toBe(false)
    expect(isRepositoryEventMessage('repository-changed')).toBe(false)
    expect(isRepositoryEventMessage({ type: 'something-else' })).toBe(false)
  })
})
