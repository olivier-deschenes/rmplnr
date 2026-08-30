import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/github/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGithubOauthCallback } =
          await import('#/features/github/server/auth.ts')
        return handleGithubOauthCallback(request)
      },
    },
  },
})
