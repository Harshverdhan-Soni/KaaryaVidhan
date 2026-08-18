/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Driven by CSS variables (see index.css) so the whole palette flips
        // between light and dark under the .dark class. Values are space-
        // separated RGB channels, keeping Tailwind's alpha utilities working.
        ink:     'rgb(var(--c-ink) / <alpha-value>)',
        blue:    { DEFAULT: 'rgb(var(--c-blue) / <alpha-value>)', 600: 'rgb(var(--c-blue) / <alpha-value>)', 500: 'rgb(var(--c-blue-500) / <alpha-value>)', 400: 'rgb(var(--c-blue-400) / <alpha-value>)' },
        sky:     'rgb(var(--c-sky) / <alpha-value>)',
        line:    'rgb(var(--c-line) / <alpha-value>)',
        muted:   'rgb(var(--c-muted) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        page:    'rgb(var(--c-bg) / <alpha-value>)',
        ok:      'rgb(var(--c-ok) / <alpha-value>)',
        warn:    'rgb(var(--c-warn) / <alpha-value>)',
        bad:     'rgb(var(--c-bad) / <alpha-value>)'
      },
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        card: '0 1px 2px rgba(10,37,64,.06), 0 8px 24px -12px rgba(10,37,64,.18)'
      }
    }
  },
  plugins: []
};
