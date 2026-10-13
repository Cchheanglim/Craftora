---
name: Craftora
description: A dark, dense desktop studio for fetching media, cutting an exact range and exporting a clean file.
colors:
  bg-input: "#0f0f10"
  bg-canvas: "#121213"
  bg-rail: "#161618"
  bg-panel: "#18181a"
  bg-raised: "#1e1e21"
  bg-hover: "#26262a"
  bg-selected: "#2c2c30"
  preview-well: "#000000"
  line-soft: "#222224"
  line: "#2c2c2e"
  line-strong: "#3a3a3c"
  line-hover: "#4a4a4e"
  text: "#f5f5f7"
  text-2: "#aeaeb2"
  text-3: "#8e8e93"
  text-on-accent: "#ffffff"
  accent: "#fa2d48"
  accent-fill: "#d81e3a"
  accent-fill-hover: "#c01733"
  accent-wash: "rgb(250 45 72 / 0.12)"
  ok: "#30d158"
  warn: "#ffb340"
  danger: "#ff6961"
typography:
  title:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  control:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Geist Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.06em"
  timecode:
    fontFamily: "Geist Mono Variable, Cascadia Mono, Consolas, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "\"tnum\" 1"
  mono:
    fontFamily: "Geist Mono Variable, Cascadia Mono, Consolas, monospace"
    fontSize: "inherit"
    fontWeight: 400
    fontFeature: "\"tnum\" 1"
rounded:
  sm: "3px"
  md: "4px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.text-on-accent}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-fill-hover}"
  button-add-to-queue:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.text-on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "38px"
    width: "100%"
  button-secondary:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.bg-selected}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.md}"
    size: "32px"
  field:
    backgroundColor: "{colors.bg-input}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  segmented:
    backgroundColor: "{colors.bg-input}"
    rounded: "{rounded.md}"
    padding: "2px"
  segmented-option:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    height: "26px"
  segmented-option-selected:
    backgroundColor: "{colors.line-strong}"
    textColor: "{colors.text}"
  option-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "7px 10px"
  option-row-selected:
    backgroundColor: "{colors.bg-selected}"
  kbd:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "2px 5px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  nav-item-hover:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.text}"
  nav-item-active:
    backgroundColor: "{colors.bg-selected}"
    textColor: "{colors.text}"
  queue-row:
    backgroundColor: "{colors.bg-rail}"
    textColor: "{colors.text}"
    padding: "0 12px 0 16px"
    height: "44px"
  timeline-track:
    backgroundColor: "{colors.bg-raised}"
    rounded: "{rounded.md}"
    height: "56px"
  timeline-range:
    backgroundColor: "{colors.accent-wash}"
  timeline-handle:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    width: "12px"
---

# Design System: Craftora

## Overview

**Creative North Star: "The Graphite Cutting Bench"**

Craftora is a dark, dense desktop workbench where the cut is the hero. Everything that is not the cut is graphite: a tight ladder of near-black surfaces separated by hairline rules, with type in grey steps. Against that quiet field, red appears in exactly two jobs (the range being cut on the timeline, with its length readout, and the one primary action) so the eye always knows what is being kept and how to commit it. The dark frame is chosen by use: people judge a picture here, and a dark surround keeps the preview true.

The layout is a fixed, always-visible workspace rather than a set of tabs: toolbar across the top, a narrow rail, the editor in the centre, a fixed-width export panel on the right and the queue dock along the bottom, so running work is never hidden. Density is utility-grade: 32px controls, 12.5–13px UI text, 4px corners. Depth comes from tonal steps and 1px lines, not shadows. Motion is short and functional, with one authored moment: a queued job landing in the dock.

Confirmed rejections from the owner's brand commitments: no pill-shaped buttons, no purple, no decorative gradients, no cursor animations or scroll effects.

**Key Characteristics:**
- Graphite surface ladder (seven steps, darkest to lightest) with hairline 1px rules.
- Red is rationed: the cut range and the single primary action; the toolbar logo is an exempt brand mark.
- Selection, radios, checkboxes, segmented choices and progress are neutral (white and grey), never red.
- Geist for words, Geist Mono with tabular figures for every number, timecode, size and command.
- Near-square corners (3–4px), no pills, no gradients.
- One authored motion moment; everything else is a 120ms colour change.

## Colors

A graphite neutral field with one rationed red and three small status hues.

### Primary
- **Cut Red** (accent): the in/out range border and handles on the timeline, the clip-length readout, the text caret, the keyboard focus ring and the toolbar logo. It marks what is being kept.
- **Commit Red** (accent-fill): the fill of the single primary button (Add to queue). Darkened from Cut Red so white label text holds contrast. Hover deepens to **Pressed Red** (accent-fill-hover).
- **Cut Wash** (accent-wash): the 12% red tint inside the timeline range, and the brief flash when a queued row lands. Text selection uses the same red at 35%.

### Neutral
- **Input Black** (bg-input): wells that take user input: fields, segmented tracks, the command block.
- **Canvas Graphite** (bg-canvas): the window background behind the editor and library.
- **Rail Graphite** (bg-rail): the left rail and the queue dock, the two frame edges.
- **Panel Graphite** (bg-panel): toolbar and export panel; also the library row hover.
- **Raised Graphite** (bg-raised): the timeline track, keycaps, popovers, the "More settings below" bar, rail hover.
- **Hover Graphite** (bg-hover): secondary button fill and ghost/icon hover.
- **Selected Graphite** (bg-selected): the current rail item, a checked option row, secondary button hover.
- **Preview Black** (preview-well): the video well only, so letterboxing reads as true black.
- **Hairlines** (line-soft, line, line-strong, line-hover): row dividers, panel and section rules, control borders, and hovered control borders, in that order of weight.
- **Text steps** (text, text-2, text-3): primary text; secondary labels and inactive controls; tertiary detail, placeholders and timestamps. All three hold at least 4.5:1 on Panel Graphite.

### Status
- **Finished Green** (ok): completed queue jobs only.
- **Signal Amber** (warn): warnings and the not-connected engine dot; also forced trade-off notes (for example when a transform forces a re-encode).
- **Error Coral** (danger): invalid field borders and error icons. Not a brand red; never used for emphasis.

### Named Rules
**The Two Reds Rule.** Red does two jobs: mark the cut (range, handles, clip length) and fill the one primary action per screen. The toolbar logo is the brand mark and is exempt. Any other red is a defect.

**The Neutral Choice Rule.** A chosen state is never red. Selected rail items, checked option rows, pressed segments, radios and checkboxes (`accent-color` set to the text colour) and progress bars all use white and graphite.

**The Status Only Rule.** Green means finished, amber means warning or not connected, coral means invalid. None of them decorate.

## Typography

**UI Font:** Geist Variable (with Segoe UI, system-ui)
**Mono Font:** Geist Mono Variable (with Cascadia Mono, Consolas)

**Character:** A neutral, slightly technical grotesque for words, paired with its own mono for numbers, so a timecode lines up and reads as data while labels stay quiet.

### Hierarchy
- **Title** (600, 16px, -0.01em): view headings: the source title in the editor, the Library heading.
- **Headline** (600, 14px): panel titles (Export) and the toolbar wordmark.
- **Body** (400, 13px, line-height 1.4): default UI text, rail items, library rows, the Add to queue label. Queue dock heading uses this size at 600.
- **Control** (500, 12.5px): button and field text, segmented options. Primary buttons go to 600.
- **Supporting** (400, 12px): sub-lines, sizes, trade-off notes, export summary. Not tokenised; it is the observed step between control and caption.
- **Caption** (400, 11.5px): field labels, queue status, details, engine state, hints.
- **Label** (600, 11px, 0.06em, uppercase): fieldset legends and group headings (Output, Source quality, Transform, Cut mode, Engines). It names the controls beneath it; it never sits above a page title as a kicker.
- **Timecode** (mono, 14px, tabular): the transport clock. The clip-length readout uses mono at 15px (14px at the minimum window) in Cut Red.

### Named Rules
**The Mono Numbers Rule.** Every number the user reads or types (timecodes, durations, sizes, percentages, counts, file names, container codes, the command) is set in Geist Mono with tabular figures. Words stay in Geist, even inside a mixed string.

**The No Display Face Rule.** There is no display size. The largest type is 16px; hierarchy comes from weight and grey steps.

## Layout

A fixed desktop grid, minimum window 1100px wide (design floor 1100×700). Columns: a 208px rail and a fluid main area; rows: a 52px toolbar and the work area. Inside main, the editor flexes beside a fixed 340px export panel, and the queue dock spans the bottom, always visible (its list caps at 178px and scrolls). Only the editor, export body, library and queue list scroll; the window itself never does.

Spacing runs on a 4px base (4, 8, 12, 16, 20). Panels pad 18px top and 20px sides; stacks inside them gap 14px, tightening to 10px below 780px of window height. Control rows gap 6–8px. Responsive behaviour is height- and width-stepped rather than reflowed: below 1380px the keyboard legend hides; below 1240px In/Out keycaps hide and time fields narrow from 118px to 104px so In, Out, Clip length and Whole video stay on one line; below 780px height vertical gaps and option padding tighten.

The export panel keeps Add to queue pinned at its foot. When settings overflow, a sticky "More settings below" bar sits at the bottom of the scroll area and disappears when everything fits.

## Elevation & Depth

Flat by default. Depth is carried by the graphite ladder (input wells darkest, raised surfaces lightest) and 1px hairlines between regions. Shadows exist only where something genuinely overlaps content.

### Shadow Vocabulary
- **Popover** (`box-shadow: 0 6px 18px rgb(0 0 0 / 0.45)`): floating messages that overlap content, such as the URL error under the toolbar field.
- **Overflow edge** (`box-shadow: 0 -8px 16px -6px rgb(0 0 0 / 0.6)`): the sticky "More settings below" bar, signalling content scrolled beneath it.

### Named Rules
**The Flat Panel Rule.** Panels, cards, rows and controls carry no shadow. If a surface needs separating, use a darker or lighter graphite step and a hairline.

## Shapes

Near-square everywhere: 4px on controls, panels-within-panels, the timeline track, the preview well and popovers; 3px on small inner parts (keycaps, segmented options, timeline handles, the preview badge). No pills: the only full circle is the 6px engine status dot. Progress bars are square-ended 4px strips. Borders are 1px; keycaps take a 2px bottom edge to read as keys. Icons are 24px-grid strokes at 2px, drawn as inline SVG.

## Components

### Buttons
Compact and quiet; only one button per screen speaks in red.
- **Shape:** gently squared (4px), 32px tall, 12px side padding, 6px icon gap.
- **Primary:** Commit Red fill, white 600 text. The export foot's Add to queue is the primary at 38px, full width, 13px, with its shortcut keycap in a translucent dark/white treatment.
- **Secondary:** Hover Graphite fill with a strong hairline border, white text; hover steps to Selected Graphite.
- **Ghost / Icon:** transparent with secondary text; hover fills Hover Graphite and lifts text to white. Icon buttons are 32px square.
- **Play:** the transport play button is the one inverted control, white fill with canvas-coloured glyph, 36px square.
- **States:** colour transitions at 120ms linear. Disabled drops to 45% opacity with a not-allowed cursor.

### Inputs / Fields
- **Style:** Input Black well, strong hairline border, 4px corners, 32px tall (34px in the toolbar URL field, with a leading link icon). Values that are numbers or codes use mono.
- **Hover / Focus:** border lightens on hover; on focus the border goes to tertiary grey, and keyboard focus adds the 2px Cut Red ring at 1px offset.
- **Error:** coral border plus a raised popover beneath the field with a coral-outlined frame or icon.

### Segmented control
An Input Black track with 2px inset, holding equal-width 26px options at 3px corners. The pressed option fills with the strong line grey and goes white at 500. Never red.

### Option rows
A bordered row (1px hairline, 4px corners, 7px 10px padding) wrapping a native radio or checkbox, its label and mono detail. Checked rows fill Selected Graphite with a tertiary-grey border. Disabled rows drop to 45%.

### Keycaps
Mono 10.5px on Raised Graphite, strong hairline border with a 2px bottom edge, 3px corners. Used beside the actions they trigger and in the editor's key legend.

### Navigation (rail)
32px full-width items, 13px secondary text with a stroke icon and optional mono count. Hover fills Raised Graphite; the current view fills Selected Graphite with white 500 text. Below the nav, an Engines group lists each engine with a 6px status dot.

### Queue dock
A 40px head (title, mono counts, a 160px overall progress strip, actions) over 44px rows on Rail Graphite separated by soft hairlines. Each row: name and mono summary, a 4px progress strip in white (grey when paused) with status text, mono size, and icon actions. Finished rows swap the bar for a Finished Green status line.

**The Landing Rule.** The one authored motion: a newly queued row arrives with a 900ms ease-out landing, dropping 6px into place within the first 35% while a Cut Wash fades out behind it; the Add to queue label echoes it with a 600ms rise. No other element animates on entry.

### Timeline (signature)
A 56px Raised Graphite track with faint vertical grid lines and a mono ruler beneath. Outside the range is shaded at 38% black. The range is the one region red owns: a Cut Wash fill bounded by 2px Cut Red top and bottom edges, with 12px Cut Red handles carrying a white grip line that widen to 14px on hover or focus. Handle focus uses a white ring, since red on red would vanish. A white playhead with a notched cap rides above everything.

### Browser surface
Text selection is Cut Red at 35% with white text; the caret in fields is Cut Red; keyboard focus is a 2px Cut Red outline at 2px offset, suppressed for pointer focus. Scrollbars are thin, 8px, with a strong-line thumb on a transparent track that lightens on hover. Chrome text is not selectable; fields, code and pre are. Motion tokens: ease-out `cubic-bezier(0.16, 1, 0.3, 1)`, 120ms for state colour, 220ms for transforms (mirror preview, chevrons). Under reduced motion every transition and animation duration drops to zero.

## Do's and Don'ts

### Do:
- **Do** keep red to the cut (range, handles, clip length) and one primary button per screen; the toolbar logo is the only exempt red.
- **Do** show chosen states in white and graphite: Selected Graphite fills, the strong line grey for pressed segments, text-coloured radios and checkboxes.
- **Do** set every number, timecode, size, percentage and command in Geist Mono with tabular figures.
- **Do** separate regions with graphite steps and 1px hairlines; use 4px corners on controls and 3px on their inner parts.
- **Do** size controls at 32px and space on the 4px scale (4, 8, 12, 16, 20).
- **Do** keep running work visible: the queue dock never collapses out of the layout.
- **Do** make motion short and functional (120ms colour, 220ms ease-out transforms) and zero it under reduced motion.

### Don't:
- **Don't** use red for chosen states (selected items, radios, pressed segments), progress, links, badges or decoration.
- **Don't** use pill-shaped buttons or radii beyond 4px on rectangles.
- **Don't** use purple or decorative gradients.
- **Don't** add cursor animations or scroll effects.
- **Don't** put shadows on panels, rows or controls; shadows are for popovers and the overflow edge only.
- **Don't** use green, amber or coral for anything but finished, warning/not-connected and invalid.
- **Don't** add a display type size; the largest text is 16px.
