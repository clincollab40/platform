/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ClinCollab brand palette
        navy: {
          50:  '#e8eef5',
          100: '#c5d4e6',
          200: '#9fb8d5',
          300: '#789bc4',
          400: '#5985b8',
          500: '#3a6fab',
          600: '#2d5a8e',
          700: '#204572',
          800: '#1A5276', // primary brand navy
          900: '#0e2d45',
          950: '#071828',
        },
        forest: {
          50:  '#e8f5ec',
          100: '#c5e6ce',
          200: '#9fd5ae',
          300: '#78c48e',
          400: '#59b874',
          500: '#3aab5a',
          600: '#2d8e48',
          700: '#1E8449', // primary brand green
          800: '#145c33',
          900: '#0a341e',
          950: '#051a0f',
        },
        clinical: {
          blue:  '#5DADE2',
          green: '#58D68D',
          light: '#F0F4F8',
          surface: '#FAFBFC',
        },
        sidebar: {
          DEFAULT:     '#0A1628',
          hover:       '#0F2040',
          active:      '#1A5276',
          border:      'rgba(255,255,255,0.07)',
          text:        'rgba(255,255,255,0.60)',
          'text-muted':'rgba(255,255,255,0.35)',
        },
        ink: {
          DEFAULT: '#0D1B2A',
          muted:   '#4A5568',
          faint:   '#718096',
        },
      },
      fontFamily: {
        display: ['var(--font-cormorant)', 'Georgia', 'serif'],
        sans:    ['var(--font-instrument)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-dm-mono)', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        'xl':  '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
      boxShadow: {
        'clinical': '0 1px 3px 0 rgba(26,82,118,0.08), 0 1px 2px -1px rgba(26,82,118,0.06)',
        'clinical-md': '0 4px 6px -1px rgba(26,82,118,0.08), 0 2px 4px -2px rgba(26,82,118,0.06)',
        'clinical-lg': '0 10px 15px -3px rgba(26,82,118,0.08), 0 4px 6px -4px rgba(26,82,118,0.06)',
      },
      spacing: {
        'sidebar': '240px',
        'topnav':  '56px',
        'insight': '288px',
      },
      animation: {
        'fade-in':    'fadeIn 0.4s ease-out',
        'slide-up':   'slideUp 0.5s ease-out',
        'slide-right':'slideRight 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'score-fill': 'scoreFill 1.2s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        slideRight: {
          '0%':   { opacity: '0', transform: 'translateX(-12px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scoreFill: {
          '0%':   { strokeDashoffset: '251' },
          '100%': { strokeDashoffset: 'var(--score-offset)' },
        },
      },
    },
  },
  plugins: [],
}
