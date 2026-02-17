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
