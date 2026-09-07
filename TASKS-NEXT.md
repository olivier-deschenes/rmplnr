# Next site tasks

Reviewed September 5, 2026. Ordered from most urgent to least urgent.
Follow `AGENTS.md` and the [Vercel design guide](https://vercel.com/design.md).

## 1. [ ] High: Reject broken room outlines

Drawing a crossing outline currently saves a room with zero area; dragging a
corner can also turn a valid room inside out. Apply the existing geometry
validator to drawing, corner edits, and imports. Explain the rejected change
and preserve the last valid shape or unfinished draft.

## 2. [ ] High: Make backups restore the whole workspace

“Back up all” currently excludes tracing images and custom furniture presets.
Add a complete backup containing plans, underlay images and calibration, and
saved presets. Keep existing JSON backups importable. Verify that restoring in
a clean browser brings everything back, with no partial restore on failure.

## 3. [ ] High: Make two-finger navigation safe

The canvas shares one drag state across all pointers and has no touch pinch
handling. A second finger can take over an object drag. Track active pointers,
add two-finger pan and pinch zoom, and cancel object movement when navigation
takes over. Verify on touch devices that navigating leaves the plan unchanged.

## 4. [ ] Medium: Move and duplicate furniture together

Selection currently handles one object at a time. Add Shift-select, drag-box
selection, and a touch-friendly way to select several items. Move or duplicate
a dining set or desk setup while preserving spacing, collision behavior, and
one-step undo. Include basic edge alignment.

## 5. [x] Medium: Export plans that print to scale

Exports currently offer PNG and JSON. Add SVG download and printable PDF with
paper size, orientation, drawing scale, and dimension visibility. Reuse the
existing SVG renderer so lines stay sharp. Include a scale bar and verify a
known wall length on output printed at 100%.
