# rmplnr task list

This file is the implementation queue for coding agents. Work on one numbered task at a time unless the user explicitly asks for a group of tasks.

## Agent rules

- Read `AGENTS.md` before making changes.
- Keep rmplnr focused on fast, private, precise 2D room planning.
- Use the appropriate TanStack libraries, shadcn/ui components, and Tailwind conventions already used by the project.
- Do not deploy unless the user explicitly asks.
- Preserve existing user data and unrelated working-tree changes.
- Add or update tests for every behavior change.
- When the user asks for the next task without naming a number, work on the
  first unchecked numbered task whose dependencies are complete.
- A task is complete only when its acceptance criteria are met and the relevant checks pass.
- Once a task is complete, change its checkbox from `[ ]` to `[x]`.

## Standard verification

Run these after each task unless the task is documentation-only:

```bash
bun test
bun run typecheck
bun run lint
bun run check
bun run build
```

For Cloudflare binding or Worker changes, also run:

```bash
bun run cf-types:check
```

## Tasks

### 1. [x] Restore a clean project baseline

**Priority:** P0  
**Dependencies:** None

**Work**

- Fix the Prettier failure in `src/features/github/GitHubCommitDialog.tsx`.
- Regenerate the stale Cloudflare binding types and make `bun run cf-types:check` pass.
- Replace the starter-heavy README introduction with a short rmplnr overview, local setup, test commands, data-storage model, keyboard shortcuts, and Cloudflare deployment notes.
- Add a useful application-level not-found page instead of TanStack Router's generic fallback.
- Remove unused starter/demo code only after confirming it has no imports.

**Acceptance criteria**

- Every standard verification command passes.
- `bun run cf-types:check` passes.
- The README describes rmplnr rather than a generic TanStack starter.
- An unknown URL shows a branded recovery page with a link to all plans.

### 2. [x] Preserve valid plan data through JSON and GitHub round trips

**Priority:** P0  
**Dependencies:** Task 1

**Work**

- Include `room.locked` in canonical project serialization.
- Validate and trim plan names before export or GitHub commit.
- Prevent blank plan names in the inspector; show an inline validation message and keep the last valid name.
- Add regression tests for locked rooms, blank names, and serialize/parse round trips.

**Likely files**

- `src/lib/planner/planSerialization.ts`
- `src/lib/planner/types.ts`
- `src/components/planner/inspector.tsx`
- `src/lib/planner/planSerialization.test.ts`

**Acceptance criteria**

- A locked room remains locked after export and re-import.
- Lock-only changes alter the serialized content/hash.
- rmplnr cannot create an external project file that its own parser rejects.

### 3. [x] Make local autosave trustworthy

**Priority:** P0  
**Dependencies:** Task 1

**Work**

- Track persistence state: `saving`, `saved`, and `error`.
- Flush pending changes on `pagehide` or the appropriate browser lifecycle event.
- Surface blocked-storage and quota failures instead of silently swallowing them.
- Keep editing usable after a save failure, but make the risk visible.
- Add tests using mocked storage and lifecycle events.

**Likely files**

- `src/lib/planner/store.ts`
- `src/components/planner/toolbar.tsx`

**Acceptance criteria**

- Closing immediately after an edit does not lose the edit.
- The UI shows whether the current library is safely saved locally.
- A storage exception produces a visible, recoverable error state.

### 4. [x] Prevent multiple tabs from overwriting each other

**Priority:** P0  
**Dependencies:** Task 3

**Work**

- Detect library changes made by another rmplnr tab.
- Do not silently overwrite a newer external version.
- Either merge non-conflicting project changes or present a clear reload/review choice.
- Add deterministic tests for same-plan and different-plan tab conflicts.

**Acceptance criteria**

- Two tabs editing different plans do not lose either plan.
- Two tabs editing the same plan produce an explicit conflict instead of last-write-wins data loss.

### 5. [x] Add JSON import and full-library backup/restore

**Priority:** P0  
**Dependencies:** Tasks 2 and 3

**Work**

- Add a shadcn/ui import dialog for validated rmplnr JSON files.
- Show a preview before applying an import.
- For duplicate IDs, offer replace or import as a copy.
- Add export and restore for the whole local plan library.
- Never partially apply an invalid import.

**Likely files**

- `src/components/planner/toolbar.tsx`
- `src/lib/planner/planSerialization.ts`
- `src/lib/planner/projectExport.ts`
- `src/lib/planner/store.ts`

**Acceptance criteria**

- A single exported plan can be imported into a clean browser.
- A full backup restores every plan without changing valid IDs.
- Invalid files explain the problem and leave existing plans untouched.

### 6. [x] Make the editor responsive

**Priority:** P0  
**Dependencies:** Task 1

**Work**

- Replace the fixed mobile inspector with the appropriate shadcn/ui Sheet or Drawer.
- Keep the desktop inspector visible at wide breakpoints.
- Group or collapse toolbar controls so important actions are reachable without horizontal clipping.
- Use touch-friendly control sizes on small screens.
- Re-fit the canvas when the inspector or viewport size changes.

**Likely files**

- `src/components/planner/planner.tsx`
- `src/components/planner/toolbar.tsx`
- `src/components/planner/inspector.tsx`

**Acceptance criteria**

- At 390 px, the canvas remains useful and all controls are reachable.
- At tablet and desktop widths, no toolbar actions are clipped.
- Desktop behavior and keyboard shortcuts remain unchanged.

### 7. [x] Add first-run and active-tool guidance

**Priority:** P1  
**Dependencies:** Task 6

**Work**

- Show an empty-canvas chooser for rectangle room, custom outline, and import.
- Display a short contextual instruction for the active tool.
- Explain how to finish or cancel polygon drawing and how to pan.
- Add a discoverable keyboard-shortcuts dialog.
- Change populated reopened plans from “Nothing yet — draw a room to start” to “No edits this session.”

**Acceptance criteria**

- A first-time user can create a room without depending on hover tooltips.
- Tool guidance updates and disappears at the appropriate times.
- History empty-state copy reflects whether the plan itself is empty.

### 8. [x] Support exact wall-length and angle editing

**Priority:** P1  
**Dependencies:** Tasks 2 and 7

**Work**

- Add wall selection to the selection model.
- Let users edit a selected wall's exact length and angle.
- Preserve connected geometry, openings, closets, and shared walls when applying changes.
- Reject impossible edits with a clear explanation.
- Add geometry and store tests for rectangular and irregular rooms.

**Acceptance criteria**

- A displayed wall measurement can be edited precisely.
- Editing one wall does not corrupt adjoining geometry or detach openings.
- Undo and redo treat one committed dimension change as one history step.

### 9. [x] Add calibrated image/PDF underlay tracing

**Priority:** P1  
**Dependencies:** Tasks 5 and 6

**Work**

- Import an image or PDF page as a locked background layer.
- Calibrate scale using one user-entered known distance.
- Support opacity, visibility, positioning, and deletion.
- Store large underlay assets outside localStorage.
- Keep underlays out of normal plan exports unless explicitly included.

**Acceptance criteria**

- A user can calibrate an underlay and trace an accurately scaled room over it.
- Underlays remain locked while normal plan objects are edited.
- Reloading restores the underlay without exceeding localStorage limits.

### 10. [x] Expand and customize the furniture catalogue

**Priority:** P1  
**Dependencies:** Task 2

**Work**

- Add common presets such as bed, desk, chair, dresser, TV, appliance, radiator, column, and rug.
- Keep each object a lightweight, dimensionally accurate 2D footprint.
- Let users save a resized and renamed object as a custom preset.
- Add categories or search once the Add menu becomes long.

**Acceptance criteria**

- Presets have sensible metric dimensions and work in imperial display mode.
- Custom presets persist locally and can be renamed or deleted.
- Collision behavior is configurable for items such as rugs.

### 11. [ ] Improve the plan library

**Priority:** P1  
**Dependencies:** Tasks 3 and 6

**Work**

- Add created and modified timestamps with a migration for existing plans.
- Add plan thumbnails, sorting, and row actions for rename, duplicate, export, and delete.
- Add search only when it remains useful with larger plan collections.
- Make deletion recoverable through an undo toast or temporary trash.

**Likely files**

- `src/routes/index.tsx`
- `src/lib/planner/types.ts`
- `src/lib/planner/store.ts`

**Acceptance criteria**

- Existing libraries migrate without data loss.
- Recently edited plans can be found quickly.
- Plans can be managed without opening the editor.
- Accidental deletion can be recovered.

### 12. [ ] Add SVG and printable PDF export

**Priority:** P1  
**Dependencies:** Task 2

**Work**

- Reuse the existing clean SVG renderer for direct SVG download.
- Add export options for labels, dimensions, scale, paper size, and orientation.
- Add a vector PDF or print-ready output path without rasterizing unnecessarily.

**Likely files**

- `src/components/planner/planImage.tsx`
- `src/components/planner/toolbar.tsx`
- `src/lib/planner/projectExport.ts`

**Acceptance criteria**

- SVG output remains sharp at any zoom.
- PDF output fits the chosen page and reports its drawing scale.
- PNG and JSON export continue to work.

### 13. [ ] Make plan objects keyboard and screen-reader accessible

**Priority:** P1  
**Dependencies:** Task 6

**Work**

- Add an accessible object/layers list for rooms, furniture, closets, and openings.
- Support keyboard selection, rename, duplicate, delete, and movement.
- Announce selection and blocked actions.
- Give the canvas an accessible name and instructions without duplicating every visual label.

**Acceptance criteria**

- Every selectable plan object can be reached and selected without a pointer.
- Existing keyboard shortcuts work after keyboard selection.
- Screen-reader output identifies object type, name, and selection state.

### 14. [ ] Add multi-select, grouping, align, and distribute

**Priority:** P2  
**Dependencies:** Tasks 8 and 13

**Work**

- Extend the selection model to support multiple furniture items.
- Add Shift-select and a selection rectangle.
- Add group/ungroup, align, distribute, duplicate, and delete actions.
- Preserve collision and undo behavior.

**Acceptance criteria**

- Multiple objects can be selected by pointer or keyboard.
- A group can be moved and duplicated as one undoable action.
- Alignment and distribution produce deterministic results.

### 15. [ ] Add layout variants and comparison

**Priority:** P2  
**Dependencies:** Tasks 11 and 14

**Work**

- Model named variants under one plan instead of relying only on duplicated projects.
- Add side-by-side and ghost-overlay comparison.
- Clearly show which variant is active and saved.
- Define how variants participate in export and GitHub sync before implementation.

**Acceptance criteria**

- A user can create an alternative without modifying the original layout.
- Variants can be compared visually and promoted to the primary layout.
- Serialization and migrations preserve all variants.

### 16. [ ] Harden GitHub sync for Cloudflare limits

**Priority:** P0 before public multi-user release  
**Dependencies:** Tasks 1 and 2

**Work**

- Replace the optimistic 1,000-file snapshot allowance with a deployment-aware, tested limit or a more efficient retrieval strategy.
- Add aggregate request-size limits before parsing large commit bodies.
- Bound plan, room, point, furniture, opening, and name counts in external schemas.
- Avoid unbounded or fully sequential GitHub blob retrieval.
- Add Worker integration tests for OAuth/session rotation, token refresh, D1 access, webhook signatures and body bounds, repository races, and Durable Object events.

**Likely files**

- `src/features/github/contracts.ts`
- `src/features/github/server/repository.ts`
- `src/features/github/server/security.ts`
- `src/server/github/RepositoryEvents.ts`

**Acceptance criteria**

- Oversized requests fail early with a useful error.
- Supported repository sizes stay within the configured Worker limits.
- Security-critical GitHub flows have integration coverage using Worker-compatible test bindings.

## Suggested delivery order

1. Tasks 1–6: correctness, data safety, portability, and responsive usability.
2. Tasks 7–13: onboarding and high-value product capabilities.
3. Tasks 14–15: advanced layout workflows.
4. Task 16 must be completed before promoting GitHub sync for broad public use; it may run in parallel with product work after Task 2.
