import handler from '@tanstack/react-start/server-entry'

import { canonicalHostRedirect } from '#/server/canonicalHost.ts'

export { RepositoryEvents } from '#/server/github/RepositoryEvents.ts'

const fetch: typeof handler.fetch = (request, ...rest) =>
  canonicalHostRedirect(request) ?? handler.fetch(request, ...rest)

export default { fetch }
