# 0013. Monochrome liquid glass

- **Status:** Accepted. Supersedes [0011](0011-blue-glassmorphism-design-system.md)
- **Date:** 2026-11-09

## Context

The first design system ([0011](0011-blue-glassmorphism-design-system.md)) used pure blue
`#0000FF` as the brand accent on flat frosted panels. The owner wanted the interface to
feel like physical glass: tactile buttons that catch light and tip when pressed, in the
spirit of "liquid glass" button studies. Colour was explicitly not wanted: black, white
and greys only, with no accent.

## Decision

**Palette: monochrome.**

- Light theme: studio grey `#d8d8d8` with a 30 px dot grid and soft white light blooms.
- Dark theme: charcoal `#141416` with the same dot grid.
- No accent colour. Hierarchy comes from *material*, not hue: everyday controls are clear
  glass; primary actions and "current/selected" states are **ink glass**, smoked charcoal
  in light mode and frosted white in dark mode (an inversion, so contrast holds in both).
- Charts use a greyscale series ramp read from the `--series` token, so they flip with the
  theme. Green / amber / red remain **only** as small status dots and meters
  (running / pending / failed), because state must stay distinguishable at a glance.
- Logo and favicon are a smoked-glass gem.

**Material: liquid glass** (`web/src/styles/liquid.css`). Every interactive surface is
built from the same four ingredients:

1. a faint diagonal fill,
2. stacked inset shadows: dark top lip, bright bottom lip, soft inner halo, short drop,
3. a 1 px **rim**: a conic gradient with two light-catching spots whose angle is a
   registered custom property (`@property --rim-angle`) so it *rotates* smoothly on
   hover and press,
4. a **sheen**: a diagonal highlight that slides across on hover.

Pressing a button tips it back in 3D (`perspective + rotateX`) and lights its bottom lip.
Panels reuse the rim at a fixed angle so cards and buttons read as the same material.
Typography is Inter throughout; text on glass carries a faint embossed shadow.

**Layering.** `glass.css` holds tokens and base styles, the page stylesheets hold layout,
and `liquid.css` loads last and owns the material, so the look can be changed in one file.

## Consequences

- One coherent, colour-free identity across site and console, in both themes.
- Material effects rely on `backdrop-filter`, `mask-composite` and `@property`; browsers
  without them fall back to flat grey pills that remain fully usable.
- Status colours are the only hue left; making them grey too is a token change
  (`--ok`, `--warn`, `--bad`) if strict black-and-white is ever required.
- Screenshots were regenerated; any future visual change should regenerate them too.
