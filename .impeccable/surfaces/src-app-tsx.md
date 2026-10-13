---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components"]
---

# Workspace

Scope: the main Craftora window (toolbar, rail, editor, export panel, queue dock). Mode: Operate.
Task: paste a link, set an exact range, choose output, queue it, keep working while jobs run.
Constraints: PRODUCT.md brand commitments; desktop window, min 1100×700; engines simulated until the Tauri backend lands.
Direction: pinned by the owner-approved mockup (https://claude.ai/artifact/32EQwSWoBoVbU5hKWKUBgv); no concept roll.
Unresolved: Library view depth, settings, save-folder picker.

## Direction contract

THESIS: One window where the cut is the hero: the range on the timeline is the only thing painted red besides the primary action. Refuses the tabbed inspector/trimmer/queue split that hides progress.

OWN-WORLD: Graphite neutrals (#121213 → #2c2c30), hairline #2c2c2e rules, 3–4px corners, no pills or gradients. Geist for UI, Geist Mono for every number. Red #fa2d48 marks the cut, #d81e3a fills the one primary button; the toolbar logo is the brand mark and is exempt; selected states and radios stay neutral; green = finished, amber = warning or not connected.

STORY: The user sees what they fetched, scrubs to the moment, drags or types In/Out, understands fast vs precise before committing, presses Add to queue and watches it land in the dock while starting the next clip.

FIRST VIEWPORT: Toolbar with URL field across the top; 208px rail left; preview filling the centre above transport, timeline and In/Out fields; 340px Export panel right with Add to queue pinned at its foot; queue dock across the bottom, always visible.

FORM: Owner-pinned mockup; no concept roll was made (the owner approved the layout before this build), so there is no seed reference.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
