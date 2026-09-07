# rmplnr

rmplnr is a fast, private 2D room planner for drawing rooms, placing openings
and furniture, and checking dimensions and clearances. Plans are local-first:
the editor works without an account, and only plans explicitly selected for
GitHub sync leave the browser.

## Local setup

Install dependencies and start the app at `http://localhost:3000`:

```bash
bun install
bun run dev
```

GitHub sync is optional. To exercise it locally, copy `.dev.vars.example` to
`.dev.vars`, add the GitHub App credentials, then initialize the local D1
database:

```bash
cp .dev.vars.example .dev.vars
bunx wrangler d1 migrations apply AUTH_DB --local
```

The GitHub App callback URL is
`http://localhost:3000/api/github/oauth/callback`; its webhook URL is
`http://localhost:3000/api/github/webhook`.

## Checks

Run the complete project verification before opening a pull request:

```bash
bun test
bun run typecheck
bun run lint
bun run check
bun run build
bun run cf-types:check
```

`bun run format` applies Prettier and ESLint fixes. After changing
`wrangler.jsonc`, run `bun run cf-types` and commit the regenerated
`worker-configuration.d.ts`.

## Data and privacy

- Plans and editor preferences are saved in browser `localStorage`. Geometry is
  stored in centimetres; metric and imperial units only change how it is shown.
- Single-plan JSON, PNG and SVG exports are downloaded directly by the browser.
  JSON plans can be previewed and imported again. A full-library backup keeps
  every plan ID and can replace the browser's whole local library after review.
- Printing goes through a paper-sized sheet drawn at a stated scale, with a
  title block and a scale bar, and is handed to the browser's own print
  pipeline as vector artwork. "Save as PDF" at 100% measures true.
- The AI furniture helper opens a service you choose with generic research and
  formatting instructions. It sends no plan data; the product details you give
  that service follow its own privacy terms, and pasted results are checked and
  added locally.
- GitHub sync writes only selected plans to
  `.rmplnr/plans/<plan-uuid>.json`. Repository sync state lives at
  `.rmplnr/workspace.json`.
- Cloudflare D1 stores users, sessions, encrypted GitHub credentials, OAuth
  state, and the selected repository. It never stores plan contents.
- Repository change notifications pass through the Worker and its Durable
  Object. Cloudflare storage keeps event state, not plan contents.

Clearing site data removes local plans that have not been exported or synced.

## Search and social

The landing page is the only page written to be indexed. The editor, the plan
list, and the share handler are one person's local workspace, so each sends
`noindex, follow`: search engines are asked to leave them out of results while
still following their links. `robots.txt` deliberately leaves those paths
crawlable — a crawler has to fetch a page to read the tag that excludes it —
and closes off only `/api/`, which serves no page.

- `src/lib/seo.ts` holds the site's title, description, canonical origin, and
  social card, and builds the tags for a route's `head()`.
- `src/lib/structuredData.ts` describes the landing page as schema.org
  `WebSite`, `WebApplication`, and `FAQPage` nodes. The questions come from
  `src/lib/faq.ts`, which the landing page also renders, so the markup and the
  visible page cannot drift apart.
- `public/` holds `robots.txt`, `sitemap.xml`, `site.webmanifest`, the
  favicons, and `og.png`, the 1200x630 social card. They are copied into the
  Worker's assets by the build.

The site answers to `rmplnr.com`. `www.rmplnr.com` is pointed at the same
Worker and permanently redirected to the canonical host by
`src/server/canonicalHost.ts`, so no page exists under two names. Requests
under `/api/` are served where they land, since a redirect is re-requested as
a `GET` and would drop a webhook or OAuth body.

Changing the domain means changing `SITE_URL` in `src/lib/seo.ts`,
`CANONICAL_HOST` in `src/server/canonicalHost.ts`, the `routes` in
`wrangler.jsonc`, and the absolute URLs in `public/robots.txt` and
`public/sitemap.xml` together.

## Keyboard shortcuts

`Mod` means Command on macOS and Control on Windows or Linux.

| Action                                           | Shortcut                           |
| ------------------------------------------------ | ---------------------------------- |
| Select                                           | `V`                                |
| Draw polygon room                                | `R`                                |
| Draw rectangular room                            | `E`                                |
| Add door / window / opening                      | `D` / `W` / `O`                    |
| Undo / redo                                      | `Mod+Z` / `Mod+Shift+Z` or `Mod+Y` |
| Copy / paste / duplicate                         | `Mod+C` / `Mod+V` / `Mod+D`        |
| Delete selection, held wall, or last draft point | `Delete` or `Backspace`            |
| Finish a room outline                            | `Enter`                            |
| Cancel the current action                        | `Escape`                           |
| Nudge the selection                              | Arrow keys                         |
| Nudge ten snap steps                             | `Shift` + arrow key                |
| Pan while dragging                               | Hold `Space`                       |

## Cloudflare deployment

The production app runs as a Cloudflare Worker through the Cloudflare Vite
plugin and `wrangler.jsonc`.

For a new Cloudflare environment, create a D1 database and place its ID in the
`AUTH_DB` binding in `wrangler.jsonc`:

```bash
bunx wrangler d1 create rmplnr-auth
```

Create a GitHub App for the deployment origin with:

- callback URL `<origin>/api/github/oauth/callback`;
- webhook URL `<origin>/api/github/webhook`;
- expiring user authorization tokens and user authorization during install;
- repository permissions **Metadata: read** and **Contents: read/write**;
- the **Push** event subscription.

Set the required Worker secrets. `GITHUB_TOKEN_ENCRYPTION_KEY` must be a stable,
base64url-encoded 32-byte key.

```bash
bunx wrangler secret put GITHUB_CLIENT_ID
bunx wrangler secret put GITHUB_CLIENT_SECRET
bunx wrangler secret put GITHUB_APP_SLUG
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
bunx wrangler secret put GITHUB_TOKEN_ENCRYPTION_KEY
```

Authenticate once with `bunx wrangler login`. Run the complete checks above,
then apply the production migration and deploy deliberately:

```bash
bunx wrangler d1 migrations apply AUTH_DB --remote
bun run deploy
```

`bun run deploy` builds the app and publishes it with Wrangler. Set the optional
`GITHUB_CALLBACK_URL` variable only when the public callback origin cannot be
derived from incoming requests.
