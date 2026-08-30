import handler from '@tanstack/react-start/server-entry'

export { RepositoryEvents } from '#/server/github/RepositoryEvents.ts'

export default {
  fetch: handler.fetch,
}
