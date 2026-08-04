---
name: "soflia-deck"
description: |
  Create light-mode SofLIA challenger decks using the approved Newsreader and Inter Tight typography system, Deep Blue and accessible Aqua accents, oversized editorial headlines, structured B2B layouts, and built-in slide animations. Use for SofLIA Deck, SofLIA presentations, high-voltage corporate decks, Challenger Sale pitches, keynote storytelling, and executive B2B slides.
triggers:
  - "SofLIA Deck"
  - "SofLIA deck"
  - "SofLIA presentation"
  - "high-voltage deck"
  - "challenger deck"
  - "B2B pitch deck"
od:
  mode: deck
  scenario: marketing
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  fidelity: high-fidelity
  speaker_notes: false
  animations: true
  example_prompt: "Create a 10-slide SofLIA Deck for a high-stakes B2B pitch using the approved SofLIA typography and color tokens."
---

# SofLIA Deck

Create a self-contained light HTML presentation with a high-voltage corporate challenger aesthetic. Keep the typography, palette, animation system, and slide vocabulary as one coordinated system.

## Visual character

- Use a light, precise and human-centered corporate canvas.
- Balance editorial transformation with technological clarity.
- Maintain low visual density and high-impact messaging.
- Preserve the crosshairs, grid, structured borders and built-in reveals.

## Approved design tokens

### Typography

| Role | Family | Weight | Leading | Tracking |
|---|---|---:|---:|---:|
| Hero display | Newsreader | 300 | 0.92 | -0.04em |
| Large display | Newsreader | 300 | 0.98 | -0.035em |
| Editorial heading | Newsreader | 400 | 1.04 | -0.03em |
| Product heading | Inter Tight | 500 | 1.12 | normal |
| Card heading | Inter Tight | 600 | 1.18 | normal |
| Supporting lead | Inter Tight | 300/400 | 1.50-1.60 | normal |
| Body | Inter Tight | 400 | 1.55-1.65 | normal |
| Label / kicker | Inter Tight | 500 | 1.25 | 0.10em |
| Metric | Inter Tight | 600 | 1.0 | normal |

Use Newsreader only for brief, meaningful and high-impact messages. Never use it for paragraphs, navigation, tables, controls or text below 24px. Use Inter Tight for all functional and supporting content. Avoid a third font family.

### Color

| Token | Value | Purpose |
|---|---|---|
| `--blue-deep` | `#0A2540` | Primary text and structure |
| `--accent` | `#23AEA8` | Large transformation accents |
| `--accent-accessible` | `#138A87` | Small aqua text on light backgrounds |
| `--muted` | `#6C7887` | Secondary copy and metadata |
| `--bg` | `#F3F7F8` | Main soft canvas |
| `--bg-positive` | `#E8FAF7` | Positive or highlighted surfaces |
| `--shell` | `#FFFFFF` | Outer canvas and cards |

Use Aqua as an accent, not as a paragraph color. Prefer `--accent-accessible` for small text and interactive labels.

## Workflow

1. Clone `example.html` as the working file.
2. Replace placeholders with the real copy, numbers, labels and imagery.
3. Preserve all approved typography and color tokens.
4. Keep one dominant hierarchy per slide.
5. Use uppercase only for brief labels with `0.06em-0.12em` tracking.
6. Keep body copy readable and avoid lines longer than roughly 65-75 characters.
7. Add slides by duplicating an existing `<section class="slide">` structure.
8. Do not modify the navigation script or remove the animation classes.

## Layout vocabulary

- Provocation or title: `<section class="slide s-center">`
- Text left, image right: `<section class="slide s-split">`
- Image left, text right: `<section class="slide s-split s-split-rev">`
- Three-column framework: `<section class="slide">` containing `<div class="grid-3">`

## Animation system

- `.anim-marker`: draw an Aqua underline.
- `.static-marker`: show a fixed Aqua underline.
- `.anim-color`: transition text toward Aqua.
- `.anim-reveal`: reveal content using a clip path.
- `.anim-typewriter`: reveal text with a cursor.
- `.anim-fade-up`: fade upward; sequence with `.stagger-1`, `.stagger-2`, `.stagger-3`.

## Output contract

Emit the completed deck between artifact tags:

```html
<artifact identifier="soflia-deck" type="text/html" title="Deck Title">
<!doctype html>
<html lang="es">...</html>
</artifact>
```
