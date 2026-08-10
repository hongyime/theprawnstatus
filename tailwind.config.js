/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111111',
        paper: '#fffdf5',
        board: '#f4efe0',
        rail: '#1f2937',
        up: '#16a34a',
        degraded: '#f59e0b',
        down: '#dc2626',
        nodata: '#9ca3af',
        cyan: '#00b8d9',
        pink: '#ff4fa3'
      },
      boxShadow: {
        hard: '6px 6px 0 #111111',
        hardSm: '3px 3px 0 #111111'
      },
      borderWidth: {
        3: '3px'
      },
      fontFamily: {
        display: ['Bahnschrift', 'Aptos Display', 'Arial Black', 'sans-serif'],
        body: ['Aptos', 'Segoe UI', 'sans-serif'],
        mono: ['Cascadia Mono', 'Consolas', 'monospace']
      }
    },
  },
  plugins: [],
};
