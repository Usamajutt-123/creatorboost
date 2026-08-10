import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-space)', 'Inter', 'sans-serif'],
      },
      colors: {
        bg: { 900: '#05030d', 800: '#0a0716', 700: '#0f0a1f', 600: '#15102a' },
        brand: {
          purple: '#8b5cf6',
          'purple-light': '#a78bfa',
          blue: '#3b82f6',
          'blue-light': '#60a5fa',
          pink: '#ec4899',
        },
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #3b82f6 100%)',
        'gradient-text': 'linear-gradient(135deg, #a78bfa 0%, #818cf8 35%, #60a5fa 70%, #22d3ee 100%)',
      },
      animation: {
        'gradient-x': 'gradient-x 8s ease infinite',
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
        'fade-in-up': 'fadeInUp 0.6s ease-out',
        'shimmer': 'shimmer 2.5s linear infinite',
        'marquee': 'marquee 30s linear infinite',
      },
      keyframes: {
        'gradient-x': {
          '0%, 100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        'pulse-glow': {
          '0%, 100%': { 'box-shadow': '0 0 20px rgba(139, 92, 246, 0.3)' },
          '50%': { 'box-shadow': '0 0 40px rgba(139, 92, 246, 0.6)' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { 'background-position': '-200% 0' },
          '100%': { 'background-position': '200% 0' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      backdropBlur: { xs: '2px' },
    },
  },
  plugins: [],
};

export default config;
