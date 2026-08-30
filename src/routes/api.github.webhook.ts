import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/github/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ env }, auth, { handleGithubWebhook }] = await Promise.all([
          import('cloudflare:workers'),
          import('#/features/github/server/realtimeAuth.ts'),
          import('#/server/github/webhookHandler.ts'),
        ])

        return handleGithubWebhook(request, {
          webhookSecret: env.GITHUB_WEBHOOK_SECRET,
          repositoryEvents: env.REPOSITORY_EVENTS,
          isRepositorySelected: auth.isGithubRepositorySelected,
          applyInstallationAccessEvent: auth.applyGithubInstallationAccessEvent,
        })
      },
    },
  },
})
