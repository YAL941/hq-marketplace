/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /**
         * Brand ramp.
         *
         * Two of the specified brand values land on ramp entries rather than
         * beside them, because the ramp is read far more often than the flat
         * aliases: `primary-500` is the brand blue and `navy-900` is the brand
         * navy, while `primary-600` is the hover shade and `primary-900` is the
         * darkest step. Each ramp stays monotonic in luminance, so a `700`
         * sitting over a `500` background reads as a darker tone rather than a
         * brighter one.
         */
        primary: {
          50: '#f4f9ff',
          100: '#EAF4FF',
          200: '#c9e2fb',
          300: '#96c8f5',
          400: '#4f9fe8',
          500: '#1E78D6',
          600: '#145FC4',
          700: '#11498f',
          800: '#0d3567',
          900: '#0B2A4A',
        },
        /** The hover/active shade, named for call sites that read as brand. */
        'primary-dark': '#145FC4',
        navy: {
          50: '#f6f9fc',
          100: '#e8eff7',
          200: '#c5d8ea',
          300: '#8fb5d6',
          400: '#4f8cbd',
          500: '#2a6699',
          600: '#1d4f7c',
          700: '#173f63',
          800: '#12314f',
          900: '#0B2A4A',
          950: '#071c31',
        },
        gold: {
          50: '#fffaeb',
          100: '#fff3c6',
          200: '#ffe88c',
          300: '#ffdd52',
          400: '#FFC83D',
          500: '#f5b022',
          600: '#dd9312',
          700: '#b76e0c',
          800: '#94580e',
          900: '#7a4a0e',
        },
        /** Flat aliases for the three brand values used outside a scale. */
        'brand-navy': '#0B2A4A',
        'brand-gold': '#FFC83D',
        sky: '#EAF4FF',
        success: {
          50: '#f0fdf4',
          500: '#22c55e',
          600: '#16a34a',
        },
        warning: {
          50: '#fffbeb',
          500: '#f59e0b',
          600: '#d97706',
        },
        error: {
          50: '#fef2f2',
          500: '#ef4444',
          600: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        brand: ['"Readex Pro"', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
        'card': '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
        'card-hover': '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
      },
      borderRadius: {
        'card': '12px',
        'button': '8px',
      },
    },
  },
  plugins: [],
}