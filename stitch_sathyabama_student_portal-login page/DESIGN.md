---
name: Obsidian Scholar
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#c3c6d7'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#8d90a0'
  outline-variant: '#434655'
  surface-tint: '#b4c5ff'
  primary: '#b4c5ff'
  on-primary: '#002a78'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#0053db'
  secondary: '#7bd0ff'
  on-secondary: '#00354a'
  secondary-container: '#00a6e0'
  on-secondary-container: '#00374d'
  tertiary: '#c0c1ff'
  on-tertiary: '#1000a9'
  tertiary-container: '#585be6'
  on-tertiary-container: '#f1eeff'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#c4e7ff'
  secondary-fixed-dim: '#7bd0ff'
  on-secondary-fixed: '#001e2c'
  on-secondary-fixed-variant: '#004c69'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#07006c'
  on-tertiary-fixed-variant: '#2f2ebe'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  headline-2xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-2xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: 0em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  code-sm:
    fontFamily: monospace
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-2xs: 0.25rem
  space-xs: 0.5rem
  space-sm: 0.75rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
  space-3xl: 4rem
  gutter-mobile: 1rem
  gutter-desktop: 1.5rem
  card-padding-compact: 1.25rem
  card-padding-spacious: 2.25rem
---

## Brand & Style

This design system delivers a focused, high-performance academic identity tailored for the student portal of Sathyabama Institute of Science and Technology. It combines the rigorous precision of institutional engineering with contemporary developer-grade clarity.

### Personality & Emotional Response
- **Authoritative yet Modern:** Grounds collegiate heritage in sleek, high-tech digital tooling.
- **Focused & Calm:** Employs an ultra-dark canvas to mitigate visual fatigue during late-night study sessions, exam registration, and grade verification.
- **Precision-Driven:** Features crisp borders, deliberate focus states, and zero unnecessary visual clutter to instill absolute trust during critical administrative workflows.

### Design Movement
**Dark Glass Minimalism:** A fusion of deep obsidian slate surfaces, calibrated 1px low-contrast translucent borders, disciplined typography, and focused royal cobalt illumination.

## Colors

The palette establishes an intentional contrast hierarchy: deep light-absorbing backgrounds paired with high-clarity slate mid-tones and a vibrant collegiate cobalt accent derived from the institutional seal.

### Surface System
- **Canvas Base (`#0B0F17`):** The primary view background; reduces eye strain and establishes total visual grounding.
- **Surface Elevation 1 (`#111827`):** Base container tone for login modules, navigation headers, and modal backings.
- **Surface Elevation 2 (`#1E293B` with alpha):** Elevated pill tags, interactive table rows, and secondary input controls.
- **Surface Elevation 3 (`#334155` at 40% alpha):** Card hover states and active button layers.

### Accents & Interactivity
- **University Cobalt (`#2563EB`):** Primary action color for entry points, submit triggers, and focused state indicators.
- **Cobalt Deep (`#1D4ED8`):** Pressed/active button states and solid active tabs.
- **Electric Cyan (`#38BDF8`):** Informational highlights, micro-indicators (e.g., active session dots), and sub-label highlights.
- **Focus Glow (`rgba(37, 99, 235, 0.35)`): Outer ring drop-shadow applied to inputs, selection targets, and buttons during active keyboard/cursor states.

### Functional States
- **Success:** `#10B981` (Registration verified, fees cleared)
- **Warning:** `#F59E0B` (Attendance thresholds, upcoming deadlines)
- **Destructive/Error:** `#EF4444` (Authentication failed, invalid registration number)

## Typography

The type system balances structure and legibility across high-density academic views.

- **Plus Jakarta Sans** provides a modern, welcoming, yet engineered presence for portal headers, section titles, and greeting hero locks.
- **Inter** ensures uniform clarity for transactional content, form inputs, registration code tables, and micro-copy.

### Usage Standards
- Headlines use optical tracking reductions (`-0.02em` to `-0.01em`) to tighten display locks against dark backdrops.
- Form field labels always use `label-md` or `label-sm` with slight uppercase tracking when displaying institutional tags (e.g., `REG. NO`, `SEMESTER`, `BRANCH CODE`).
- Data grids, roll numbers, and OTP sequences map strictly to fixed-pitch or high-legibility numerals.

## Layout & Spacing

The portal adheres to a fluid, column-based structural grid bounded by maximum readable container widths.

### Grid Infrastructure
- **Desktop (1024px+):** 12-column responsive layout with 24px (`space-lg`) gutters and fluid side margins bounded at a maximum container width of `1280px`. Single-panel login cards center within an 8-column or 460px fixed shell.
- **Tablet (768px – 1023px):** 8-column layout with 20px gutters and 32px external margins.
- **Mobile (Up to 767px):** 4-column layout with 16px (`space-md`) gutters and 16px lateral padding. Form components fill 100% of available viewport width.

### Layout Philosophy
- Inputs, field actions, and notification triggers adhere strictly to an 8px spatial increments system.
- Functional groupings (e.g., form field label + input + helper text) use compact 4px–6px gaps to enforce clear visual proximity.

## Elevation & Depth

Visual hierarchy uses frosted glass layers and subtle border strokes rather than muddy black shadows, maintaining lightness across the dark theme.

### Layering System
1. **Canvas Layer (`#0B0F17`):** Flat zero-elevation base.
2. **Frosted Panel Tier:** Surface composed of `#111827` rendered at 80% opacity with `backdrop-filter: blur(16px)` and a hairline border: `1px solid rgba(255, 255, 255, 0.08)`.
3. **Elevated Dynamic Tier:** Sub-panels, input fields, and dropdown menus use `#1E293B` at 60% opacity with `backdrop-filter: blur(8px)` and a top-edge highlight (`rgba(255, 255, 255, 0.12)`).

### Lighting & Shadow Physics
- **Ambient Floor Shadow:** `0 20px 40px -15px rgba(0, 0, 0, 0.7)` on floating cards to lift them cleanly above background noise.
- **Cobalt Bloom:** On active buttons and focused inputs, an inner highlight is paired with an outer cobalt halo: `0 0 0 3px rgba(37, 99, 235, 0.35), 0 8px 16px -4px rgba(37, 99, 235, 0.3)`.

## Shapes

The design uses a balanced 8px (`0.5rem`) corner radius system. It avoids harsh brutalist edges while maintaining a modern, architectural presence.

### Geometry Specifications
- **Controls & Form Inputs:** 8px (`0.5rem`) base corner radius.
- **Cards & Dialog Containers:** 16px (`1rem`) corner radius to create clear boundary definitions for frosted backdrops.
- **Pills, Badges & Status Chips:** Fully circular (9999px) for clear functional differentiation from actionable form buttons.
- **Nested Ratio Rule:** Inner elements (e.g., icons or tags nested inside a card) maintain half the outer container radius to preserve balanced, concentric margins.

## Components

### Input Fields
- **Base State:** Background `#111827` at 80% opacity, border `1px solid rgba(255, 255, 255, 0.1)`, 14px padding vertical, 16px horizontal, text `#F9FAFB`, placeholder `#64748B`.
- **Focus State:** Border transitions to `#2563EB`, background shifts to `#0F172A`, applied outer glow `0 0 0 3px rgba(37, 99, 235, 0.35)`.
- **Error State:** Border shifts to `#EF4444`, outer glow `0 0 0 3px rgba(239, 68, 68, 0.25)`.
- **Add-on Decorators:** Symmetrical left icon slots in `#64748B` shift to `#38BDF8` upon focus.

### Primary Action Buttons
- **Base State:** Background `#2563EB`, text `#FFFFFF` (`label-lg`), no visible outer border, subtle top inset border `1px solid rgba(255, 255, 255, 0.2)`.
- **Hover:** Background `#1D4ED8`, ambient lift `translateY(-1px)`, drop shadow `0 8px 20px -4px rgba(37, 99, 235, 0.4)`.
- **Active / Pressed:** `translateY(0)`, background `#1E40AF`.
- **Disabled:** Background `#1E293B`, text `#475569`, border `1px solid rgba(255, 255, 255, 0.04)`, cursor not-allowed.

### Frosted Cards
- **Architecture:** `rgba(17, 24, 39, 0.75)` backdrop blur of 16px, perimeter border `1px solid rgba(255, 255, 255, 0.07)`.
- **Header Separator:** Seamless inset divider line `1px solid rgba(255, 255, 255, 0.05)` maintaining equal content separation.

### Checkboxes & Radio Controls
- **Box Shell:** 18x18px, border `1.5px solid rgba(255, 255, 255, 0.2)`, background `rgba(30, 41, 59, 0.5)`.
- **Checked State:** Background `#2563EB`, border `#2563EB`, white checkmark/dot icon with smooth 150ms scale-in transition.

### Chips & Status Badges
- **Format:** Pill-shaped with 4px vertical, 10px horizontal padding.
- **Academic Variant (e.g., "Semester VII"):** Background `rgba(37, 99, 235, 0.12)`, text `#60A5FA`, border `1px solid rgba(37, 99, 235, 0.25)`.
- **Live Indicator:** Includes an animated 6px pulsating dot on the leading edge for real-time announcements.

### Institution Identity Module
- A lockup containing the Sathyabama collegiate insignia rendered in monochrome slate with a royal cobalt secondary crest, anchored at the top of the authentication panel alongside dual-factor credential switches.