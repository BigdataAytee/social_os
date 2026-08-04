import type { Config } from "tailwindcss";

/**
 * SocialOS Tailwind config — ARCHITECTURE.md §7.
 *
 * Every color here resolves to a CSS variable defined in styles/tokens.css.
 * No hex values live in this file, so re-theming is a tokens.css-only change.
 * The `<alpha-value>` placeholders are what make `bg-surface/60` work.
 */

const channel = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./modules/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // base surfaces — bg-canvas, bg-surface, bg-surface-raised
        canvas: channel("canvas"),
        surface: {
          DEFAULT: channel("surface"),
          raised: channel("surface-raised"),
        },
        border: {
          DEFAULT: channel("border"),
          strong: channel("border-strong"),
        },

        // type — text-primary, text-secondary, text-muted
        primary: channel("text-primary"),
        secondary: channel("text-secondary"),
        muted: channel("text-muted"),

        // signal + status
        accent: {
          DEFAULT: channel("accent"),
          contrast: channel("accent-contrast"),
        },
        success: channel("success"),
        warning: channel("warning"),
        danger: channel("danger"),

        // per-studio accents — bg-studio-tiktok, text-studio-youtube, …
        studio: {
          DEFAULT: channel("studio-accent"),
          x: channel("studio-x"),
          tiktok: channel("studio-tiktok"),
          instagram: channel("studio-instagram"),
          facebook: channel("studio-facebook"),
          youtube: channel("studio-youtube"),
        },
      },
      fontFamily: {
        // §7 type pairing. Loaded via next/font in app/layout.tsx.
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        base: "var(--motion-base)",
        slow: "var(--motion-slow)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down var(--motion-base) var(--ease-standard)",
        "accordion-up": "accordion-up var(--motion-base) var(--ease-standard)",
        "fade-in": "fade-in var(--motion-base) var(--ease-standard)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
