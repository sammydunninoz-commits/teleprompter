/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Bundled locally (see src/fonts.css) — no CDN dependency, works offline.
        prompter: ['Atkinson Hyperlegible', 'system-ui', 'sans-serif'],
      },
      colors: {
        panel: '#141414',
        panelalt: '#1c1c1c',
        edge: '#2a2a2a',
        accent: '#3b82f6',
      },
    },
  },
  plugins: [],
}
