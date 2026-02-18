import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
      colors: {
        // Mapped to CSS variables defined in globals.css
        "bg-base": "var(--bg-base)",
        "bg-surface": "var(--bg-surface)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-border": "var(--bg-border)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
        "accent-function": "var(--accent-function)",
        "accent-class": "var(--accent-class)",
        "accent-file": "var(--accent-file)",
        "accent-module": "var(--accent-module)",
        "accent-primary": "var(--accent-primary)",
        "accent-hover": "var(--accent-hover)",
      },
    },
  },
  plugins: [],
};

export default config;
