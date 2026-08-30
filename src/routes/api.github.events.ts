import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/github/events')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [{ env }, auth, { handleGithubLiveUpgrade }] = await Promise.all([
          import('cloudflare:workers'),
          import('#/features/github/server/realtimeAuth.ts'),
          import('#/server/github/liveHandler.ts'),
        ])

        return handleGithubLiveUpgrade(request, {
          repositoryEvents: env.REPOSITORY_EVENTS,
          requireSelectedConnection: auth.requireSelectedGithubConnection,
        })
      },
    },
  },
})
