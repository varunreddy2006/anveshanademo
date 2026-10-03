/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0B1220',
        blue: '#2563EB',
        teal: '#14B8A6',
        orange: '#F97316',
        danger: '#EF4444',
        slatebg: '#F8FAFC',
      },
      boxShadow: {
        soft: '0 20px 45px rgba(15, 23, 42, 0.12)',
      },
    },
  },
  plugins: [],
}

