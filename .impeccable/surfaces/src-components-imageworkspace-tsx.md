---
version: 1
slug: "src-components-imageworkspace-tsx"
primary_target: "src/components/ImageWorkspace.tsx"
related_targets: ["src/components/NewImageDialog.tsx","src/components/LayersPanel.tsx","src/App.tsx"]
---

# Image editor

Scope: the Image editor screen (image-mode workspace: top bar, layers, work area, settings) and its New image window. Mode: Operate.
Audience: the owner first (non-technical, judges by "like the popular editor"), later the public.
Task: make video thumbnails, social posts/stories and quick photo fixes (cut out, filters, colour) as layered pictures, exported as PNG/JPG.
Must keep (owner, 2026-11-13): layers always on screen with real height; shortcuts V, H, T, Ctrl+J, Ctrl+[ ], arrow nudge; grey #3a3a3f work area.
Must fix (owner, 2026-11-13): video leftovers in image mode (link box, Fetch, Queue, timeline/playhead copy, Place: Bottom); the squeezed Properties + Layers column; the New image window's dead space; adding text/shapes/photos through narrow half-empty panels.
Constraints: PRODUCT.md brand commitments; current house look in code (round glass icon buttons, IconTabs with every tab visible, own Select, no obvious tooltips); only features that exist or are on the roadmap (blend modes, groups, masks later; no templates or stickers library); every control needs an export path (preview = PNG); never name the popular editor.
Unresolved: blend modes/groups/masks placement (stage 5).
Chosen direction (owner, decision page 2026-11-13): "Tools and a do-anything box". Memorable moment: Ctrl K, type "remove", and the picked photo's Remove background is the first row.

## Direction contract

THESIS: The image editor as a photo workbench: tools on a slim strip with their keys, every other action one typed word away in the do-anything box, and the layers always visible above the settings of the one you picked. Refuses the video editor's shell (link box, Queue, timeline words) and the old squeezed Properties + Layers column.

OWN-WORLD: Craftora graphite (#121213 ground to #2c2c30 picked), 1px hairlines, 3–4px corners, round glass icon buttons, IconTabs with every tab visible, Geist words and Geist Mono numbers, keycaps beside tools. Work area grey #3a3a3f. Red only on Export (the one primary) and the logo; picked states are white and graphite.

STORY: The owner starts from New image or a photo, adds a title with T and a shape with U, picks a layer to tune it under Properties, types "remove" in the box to cut out the photo, and exports a PNG.

FIRST VIEWPORT: 48px top bar: menu, logo, name with mono size, New and Open; the 460px do-anything box centred (Ctrl K); undo, redo, zoom, red Export. 56px tool strip left: Move V, Hand H | Text T, Shape U, Photo | Cut out, Crop C, Canvas. Grey work area with the picture fitted. 340px right dock: Layers on top with a drag line, Properties below (picked layer's name, six tabs: Edit, Text, Adjust, Filters, Effects, Cut out).

FORM: dealt structure 7 of my 7, "Tools and a do-anything box", chosen by the owner on the decision page; seed:d9316d509407d0f6.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
