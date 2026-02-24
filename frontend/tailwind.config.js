/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        radarr: {
          400: '#f2a824',
          500: '#e09519',
          600: '#c98210',
        },
        teal: {
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        dark: {
          300: '#9ca3b4',
          400: '#6b7a90',
          500: '#4a5568',
          600: '#334155',
          700: '#1e2d44',
          800: '#162032',
          900: '#111a2e',
          950: '#0b1120',
        },
      },
    },
  },
  plugins: [],
}
