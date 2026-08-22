# Design System Specification: High-End Audio Experience

## 1. Overview & Creative North Star
**Creative North Star: "The Neon Nocturne"**

This design system moves beyond the utility of a standard music player to create a "Neon Nocturne" experience—a high-end, editorial digital space where deep, ink-like shadows meet vibrant, electric energy. It is designed to feel like a premium physical hi-fi system reimagined as a digital interface. 

To break the "template" look typical of desktop apps, we employ **intentional asymmetry** and **layered tonal depth**. Instead of rigid boxes, elements breathe through generous white space and overlapping glass surfaces. Large-scale, high-contrast typography creates an editorial feel, treating every album cover and playlist title as a piece of curated art rather than just a database entry.

---

## 2. Colors: Depth and Vibrancy
Our palette is rooted in deep blacks (`#0e0e0e`) and sophisticated grays, punctuated by a hyper-vibrant Electric Lime (`#86ff8d`) that commands attention.

### The "No-Line" Rule
**Explicit Instruction:** Use of 1px solid borders for sectioning is strictly prohibited. We define boundaries through background color shifts and tonal transitions.
- **Sectioning:** Use `surface-container-low` for navigation sidebars and `surface` for the main content area. This creates a natural break without visual noise.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. We use a "Nesting" approach to depth:
- **Base Layer:** `surface` (#0e0e0e)
- **Primary Sectioning:** `surface-container-low` (#131313)
- **Nested Components (Cards):** `surface-container-highest` (#262626)
- **Interactive Hover States:** `surface-bright` (#2c2c2c)

### The "Glass & Gradient" Rule
To add soul to the interface, avoid flat primary colors for large CTAs. Use a subtle gradient transition from `primary` (#86ff8d) to `primary_container` (#0ef859) at a 135-degree angle. Floating elements (like context menus or the persistent player bar) should utilize a backdrop blur of `24px` with a semi-transparent `surface_variant` at 60% opacity.

---

## 3. Typography: Editorial Authority
We utilize a dual-font strategy to balance character with readability.

- **Display & Headlines (Plus Jakarta Sans):** These are the "hero" elements. The `display-lg` (3.5rem) and `headline-lg` (2rem) scales are used for artist names and playlist titles to provide an authoritative, editorial feel.
- **Body & Titles (Manrope):** Chosen for its technical precision and readability at small sizes. `body-md` (0.875rem) is our workhorse for track metadata.
- **Hierarchy:** Maintain a clear contrast. A `display-sm` heading should be paired with `on_surface_variant` (gray) for sub-headers to ensure the primary info "pops" against the dark background.

---

## 4. Elevation & Depth
In this system, elevation is a feeling, not a line.

### The Layering Principle
Depth is achieved by "stacking" tones. Place a `surface_container_lowest` (#000000) card on a `surface_container_high` (#20201f) section to create a soft, recessed "etched" look.

### Ambient Shadows
For floating objects like Tooltips or Playback Controls:
- **Color:** Use a tinted shadow based on `on_surface` at 6% opacity.
- **Style:** Extra-diffused. Blur values should exceed `32px` to mimic natural, ambient lighting rather than a harsh drop-shadow.

### The "Ghost Border" Fallback
If a border is required for accessibility, use the `outline_variant` token at 15% opacity. High-contrast, 100% opaque borders are forbidden as they break the immersive "Nocturne" aesthetic.

---

## 5. Components: Modern Primitives

### Buttons
- **Primary:** Gradient-filled (`primary` to `primary_container`), `full` roundedness. No border. Text is `on_primary`.
- **Secondary:** Transparent background with a "Ghost Border." On hover, shift to `surface_bright`.
- **Tertiary:** Text only using `primary` color, strictly for low-priority actions like "Show All."

### Playback Bar (The Persistent Anchor)
- **Style:** Utilize Glassmorphism. Apply a 60% opaque `surface_container_low` with a `24px` backdrop blur. 
- **Layout:** Use `spacing-6` (1.5rem) padding. No divider line between the player and the content; let the blur define the edge.

### Cards & Track Lists
- **Cards:** Use `lg` (1rem) rounded corners. Forbid the use of divider lines.
- **Track Lists:** Separate items using vertical white space (`spacing-2`). Use a `surface_bright` background shift on hover to indicate selection.
- **Spacing:** Use `spacing-4` (1rem) as the standard gutter between list items to maintain breathing room.

### Checkboxes & Radios
- Always use `primary` for the selected state. The unselected state should be a subtle `outline` circle. Avoid heavy boxes; keep the geometry light and thin.

---

## 6. Do’s and Don’ts

### Do:
- **Use "Surface Tint":** Apply a 2% `surface_tint` (#86ff8d) overlay to main containers to give the blacks a "cool" professional tone.
- **Leverage Asymmetry:** Let the album art in the player bar slightly overlap the progress slider to create depth.
- **Prioritize Motion:** All hover states should transition over `200ms` using an `ease-out` curve.

### Don't:
- **Don't use Divider Lines:** Never use a solid line to separate the sidebar from the main content. Use the transition from `surface_container_low` to `surface`.
- **Don't use Pure White for Metadata:** Use `on_surface_variant` (#adaaaa) for secondary info like "Artist Name" or "Duration" to keep the visual hierarchy focused on the track title.
- **Don't use Square Corners:** Every interactive element must have at least a `sm` (0.25rem) radius to maintain the polished, modern feel.