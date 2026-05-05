import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/web/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        bg: '#000000',
        surface: '#0a0a0f',
        primary: '#0F0F23',
        secondary: '#1E1B4B',
        accent: '#E11D48',
        fg: '#F8FAFC',
        muted: '#181818',
        border: '#312E81',
        destructive: '#EF4444',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
