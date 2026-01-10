import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          app: '#0f1115',
          panel: '#181b21',
          panelHover: '#1f232b',
        },
        primary: {
          DEFAULT: '#646cff',
          hover: '#7b83ff',
        },
        accent: '#00e5ff',
        text: {
          main: '#ffffff',
          muted: '#8b949e',
          dim: '#484f58',
        },
        border: {
          DEFAULT: '#30363d',
          active: '#539bf5',
        },
        status: {
          success: '#238636',
          warning: '#d29922',
          error: '#da3633',
          info: '#0969da',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config

