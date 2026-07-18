/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:   '#0A2540',
        blue:  { DEFAULT: '#0B4E8C', 600: '#0B4E8C', 500: '#1565A8', 400: '#2E7BC4' },
        sky:   '#EAF2FA',
        line:  '#D6E3F0',
        muted: '#5A7391',
        ok:    '#1F8A4C',
        warn:  '#E8801A',
        bad:   '#D93025'
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
