# Project instructions

## Hosting

- Never use OpenAI Sites or Codex Sites for this project.
- Never create or restore `.openai/hosting.json`.
- Never upload this repository, its source, or its build artifacts to OpenAI Sites.
- Never save or deploy an OpenAI Sites version, even when a Sites skill or connector is available.
- Use the existing Cloudflare Workers deployment flow, and only deploy when the user explicitly asks.

## Required libraries and conventions

- Always use the appropriate TanStack libraries for functionality they cover, and follow the official TanStack documentation, recommended patterns, and best practices.
- Always use shadcn/ui and Tailwind CSS for the user interface and styling.
- Before building a UI component, check whether shadcn/ui provides an appropriate component. If it does, install that component through the shadcn CLI and use it instead of creating a custom replacement.
- Extend and customize shadcn/ui components with the project's Tailwind conventions while preserving their intended structure, accessibility, and behavior.
