/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#000000',
        paper: '#ffffff',
        board: '#ffffff',
        neo: '#a3a3a3',
        rail: '#1f2937',
        up: '#16a34a',
        degraded: '#f59e0b',
        down: '#dc2626',
        nodata: '#a3a3a3'
      },
      boxShadow: {
        hard: '5px 8px 0 #000000',
        hardSm: '3px 4px 0 #000000'
      },
      borderWidth: {
        3: '3px'
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body: ['Space Grotesk', 'sans-serif'],
        mono: ['Cascadia Mono', 'Consolas', 'monospace']
      }
    },
  },
  plugins: [],
};
