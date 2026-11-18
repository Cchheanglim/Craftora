---
target: Image editor
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Very, Urgenly, Important\\Github Projects\\Craftora\\src\\components\\ImageWorkspace.tsx"
target_fingerprint: "sha256:07b3e0b56c38d654c1eb38a484a3a6d8b4820d04275d93c3c3d72bd8499bb06a"
target_path: "D:\\Very, Urgenly, Important\\Github Projects\\Craftora\\src\\components\\ImageWorkspace.tsx"
timestamp: 2026-11-18T08-55-18Z
slug: src-components-imageworkspace-tsx
---
Method: dual-agent (A: Sonnet design review, live app only · B: Haiku detector). A did not read source.

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "No layer picked" beside "Layers 21"; cut-out looked like nothing (fixed 2026-11-18) |
| 2 | Match System / Real World | 3 | Plain words; stars named "Rectangle" |
| 3 | User Control and Freedom | 3 | Undo/redo (undo after cut-out fixed); no History list |
| 4 | Consistency and Standards | 2 | Photoshop tool column + menus vs Canva-style preset sidebar; Add text/shape/photo in top bar AND tool column |
| 5 | Error Prevention | 2 | Same-named layers; hover tip covers menu items |
| 6 | Recognition Rather Than Recall | 2 | Greyed tabs with no reason |
| 7 | Flexibility and Efficiency | 2 | Keys + Ctrl K; no drag from Photos panel, no rulers/snapping; opacity type-only (task 97) |
| 8 | Aesthetic and Minimalist | 2 | Size presets/custom/colours take the right column; Layers ~1/3 height |
| 9 | Error Recovery | 3 | Plain, dismissible messages |
| 10 | Help and Documentation | 2 | Ctrl K only |
| **Total** | | **24/40** | **Acceptable** |

## Design Specificity Verdict
Looks authored (dark, sharp, red only on Export) but works like two products: Photoshop on the left (menus, tools), Canva on the right (presets, colour dots). Detector: source 0 findings (7 files); live 4 (tiny-text p.export__hint 11.5px — in-character; bounce-easing --spring tokens.css:88 — sliding switches; repeating-stripes — TimelineEditor.css:464 ruler ticks, false positive; shape-assembled-illustration — likely welcome scene).

## Priority Issues
- [P1] Two models fight (Photoshop column vs Canva sidebar): top bar -> per-tool options bar; canvas size -> Image > Canvas size…; nothing picked -> compact Document line. /impeccable shape, distill
- [P1] Layers panel too small/weak: draggable divider (Layers ~50%), content names (Star, Text: SELFIE), bigger thumbs, groups later. /impeccable layout
- [P1] Adding content too many steps: drag Photos cards onto canvas at drop point; Import adds directly; Text tool click-to-type. /impeccable shape
- [P2] State unclear: greyed tabs say why; clear frame on picked layer; click picks topmost, Ctrl+click deeper. /impeccable clarify
- [P2] Overlays collide / long menus: hide tips while a menu is open; Resize to ▸ submenu; zoom shown once. /impeccable polish

## Persona Red Flags
- Alex: no rulers/guides/snapping, no History, no drag from panel, shortcuts not in every menu row.
- Jordan: greyed tabs unexplained; "No layer picked" vs 21 layers; Photos/Add a photo/Import/this PC naming.
- Sam: keyboard not tested; low-contrast greyed text; tool tips hover-only.

## Minor Observations
Duplicate subject.png cards look identical; "Image" tag covers card pictures; colour dots unlabeled; tiny foreground/background squares; --spring the only bouncy motion.

## Questions to Consider
Zero-click photo add? Top bar = only current tool's options? Layers rows thumbnail-first?
