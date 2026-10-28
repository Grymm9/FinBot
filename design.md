\---

version: "alpha"

name: "Hyperrealism UI (Opaque Glass Variant)"

description: "Translucent morphism and frosted glass visual system with backdrop blur, subtle metallic outlines, and physically plausible lighting."

colors:

&#x20; primary: "#3ea6ff"

&#x20; background: "#121316"

&#x20; surface: "rgba(255, 255, 255, 0.04)"

&#x20; surface-hover: "rgba(255, 255, 255, 0.08)"

&#x20; border: "rgba(255, 255, 255, 0.12)"

&#x20; border-bright: "rgba(255, 255, 255, 0.25)"

&#x20; text: "#f5f5f2"

&#x20; text-muted: "#94949e"

&#x20; accent: "#ffb238"

&#x20; on-primary: "#051321"

&#x20; on-surface: "#FFFFFF"

&#x20; on-accent: "#000000"

typography:

&#x20; h1:

&#x20;   fontFamily: "'Helvetica Neue', 'Futura', sans-serif"

&#x20;   fontSize: "4rem"

&#x20;   fontWeight: "700"

&#x20;   lineHeight: "1.05"

&#x20; body-md:

&#x20;   fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif"

&#x20;   fontSize: "1rem"

&#x20;   fontWeight: "400"

&#x20;   lineHeight: "1.6"

&#x20; label-caps:

&#x20;   fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif"

&#x20;   fontSize: "0.75rem"

&#x20;   fontWeight: "600"

&#x20;   letterSpacing: "0.06em"

rounded:

&#x20; sm: "8px"

&#x20; md: "14px"

&#x20; lg: "24px"

&#x20; pill: "999px"

spacing:

&#x20; sm: "8px"

&#x20; md: "16px"

&#x20; lg: "32px"

components:

&#x20; button-primary:

&#x20;   backgroundColor: "{colors.primary}"

&#x20;   textColor: "{colors.on-primary}"

&#x20;   rounded: "{rounded.pill}"

&#x20;   padding: "12px 20px"

&#x20;   boxShadow: "0 0 16px rgba(62, 166, 255, 0.4)"

&#x20; button-glass:

&#x20;   backgroundColor: "rgba(255, 255, 255, 0.05)"

&#x20;   textColor: "{colors.text}"

&#x20;   backdropFilter: "blur(20px) saturate(180%)"

&#x20;   rounded: "{rounded.pill}"

&#x20;   border: "1px solid {colors.border}"

&#x20;   padding: "12px 20px"

&#x20; card:

&#x20;   backgroundColor: "{colors.surface}"

&#x20;   backdropFilter: "blur(20px) saturate(180%)"

&#x20;   textColor: "{colors.on-surface}"

&#x20;   rounded: "{rounded.lg}"

&#x20;   padding: "24px"

&#x20;   border: "1px solid {colors.border}"

&#x20;   boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15)"

&#x20; badge-outline:

&#x20;   backgroundColor: "rgba(255, 255, 255, 0.03)"

&#x20;   textColor: "{colors.text-muted}"

&#x20;   backdropFilter: "blur(20px) saturate(180%)"

&#x20;   rounded: "{rounded.pill}"

&#x20;   border: "1px solid {colors.border}"

&#x20;   padding: "6px 14px"

&#x20; page:

&#x20;   backgroundColor: "{colors.background}"

&#x20;   textColor: "{colors.text}"

&#x20;   padding: "16px"

\---

\## Overview



Opaque frosted glass visual system, translated from the Claude Artisan morphism catalog for dark-mode interfaces.



\- \*\*Category:\*\* morphism / glassmorphism

\- \*\*Era:\*\* Modern Skeuomorphic Morphism

\- \*\*Structural base:\*\* Translucent application shell with backdrop-blur navigation and layered glass panels



\*\*Defining traits:\*\*

\- Frosted glass blur (`backdrop-filter: blur(20px)`)

\- Opaque, semi-transparent dark charcoal surfaces

\- Radial ambient background glow highlights

\- Multi-layered depth and subtle inset light bevels

\- Tactile outline buttons and pill-shaped badges



\## Colors



\- \*\*bg\*\* — #121316

\- \*\*surface\*\* — rgba(255, 255, 255, 0.04)

\- \*\*surface-hover\*\* — rgba(255, 255, 255, 0.08)

\- \*\*border\*\* — rgba(255, 255, 255, 0.12)

\- \*\*border-bright\*\* — rgba(255, 255, 255, 0.25)

\- \*\*text\*\* — #f5f5f2

\- \*\*text-muted\*\* — #94949e

\- \*\*primary\*\* — #3ea6ff

\- \*\*accent\*\* — #ffb238

\- \*\*highlight\*\* — rgba(255, 255, 255, 0.15)



\## CSS Technical Implementation



```css

:root {

&#x20; --color-bg: #121316;

&#x20; --color-surface-glass: rgba(255, 255, 255, 0.04);

&#x20; --color-surface-hover: rgba(255, 255, 255, 0.08);

&#x20; --color-border: rgba(255, 255, 255, 0.12);

&#x20; --color-border-bright: rgba(255, 255, 255, 0.25);

&#x20; --color-text: #f5f5f2;

&#x20; --color-text-muted: #94949e;

&#x20; --color-primary: #3ea6ff;

&#x20; --color-highlight: rgba(255, 255, 255, 0.15);

&#x20; 

&#x20; --radius-sm: 8px;

&#x20; --radius-md: 14px;

&#x20; --radius-lg: 24px;

&#x20; --radius-pill: 999px;

&#x20; 

&#x20; --backdrop-blur: blur(20px) saturate(180%);

&#x20; --shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.25), inset 0 1px 0 var(--color-highlight);

&#x20; --shadow-md: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 var(--color-highlight), inset 0 -1px 2px rgba(0, 0, 0, 0.3);

&#x20; --blue-glow: radial-gradient(circle at 80% 30%, rgba(62, 166, 255, 0.15) 0%, transparent 60%);

}



body {

&#x20; margin: 0;

&#x20; color: var(--color-text);

&#x20; font-family: 'Inter', -apple-system, sans-serif;

&#x20; background: var(--color-bg);

&#x20; background-image: var(--blue-glow);

&#x20; background-attachment: fixed;

}



/\* Glass Panel Utility Class \*/

.card, .glass-panel {

&#x20; background: var(--color-surface-glass);

&#x20; backdrop-filter: var(--backdrop-blur);

&#x20; -webkit-backdrop-filter: var(--backdrop-blur);

&#x20; color: var(--color-text);

&#x20; border-radius: var(--radius-lg);

&#x20; box-shadow: var(--shadow-md);

&#x20; padding: 24px;

&#x20; border: 1px solid var(--color-border);

&#x20; transition: background 0.2s cubic-bezier(0.2, 0, 0, 1), border-color 0.2s cubic-bezier(0.2, 0, 0, 1);

}



.card:hover, .glass-panel:hover {

&#x20; background: var(--color-surface-hover);

&#x20; border-color: var(--color-border-bright);

}



/\* Glass \& Glow Buttons \*/

.btn {

&#x20; font: 600 1rem/1 'Inter', sans-serif;

&#x20; color: var(--color-text);

&#x20; padding: 12px 20px;

&#x20; border-radius: var(--radius-pill);

&#x20; background: rgba(255, 255, 255, 0.05);

&#x20; backdrop-filter: var(--backdrop-blur);

&#x20; -webkit-backdrop-filter: var(--backdrop-blur);

&#x20; border: 1px solid var(--color-border);

&#x20; box-shadow: var(--shadow-sm);

&#x20; cursor: pointer;

&#x20; transition: all 0.2s ease;

}



.btn:hover {

&#x20; background: rgba(255, 255, 255, 0.12);

&#x20; border-color: var(--color-border-bright);

}



.btn--primary {

&#x20; background: var(--color-primary);

&#x20; color: #051321;

&#x20; border: 1px solid rgba(255, 255, 255, 0.4);

&#x20; box-shadow: 0 0 16px rgba(62, 166, 255, 0.4);

}



.btn--primary:hover {

&#x20; background: #57b6ff;

&#x20; box-shadow: 0 0 24px rgba(62, 166, 255, 0.6);

}



/\* Outline Pill Tag / Badge \*/

.badge {

&#x20; display: inline-flex;

&#x20; align-items: center;

&#x20; padding: 6px 14px;

&#x20; border-radius: var(--radius-pill);

&#x20; border: 1px solid var(--color-border);

&#x20; background: rgba(255, 255, 255, 0.03);

&#x20; backdrop-filter: var(--backdrop-blur);

&#x20; -webkit-backdrop-filter: var(--backdrop-blur);

&#x20; color: var(--color-text-muted);

&#x20; font-size: 0.75rem;

&#x20; text-transform: uppercase;

&#x20; letter-spacing: 0.05em;

}

