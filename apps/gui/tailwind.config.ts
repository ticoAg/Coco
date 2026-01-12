import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          app: "#0f1115",
          panel: "#181b21",
          panelHover: "#1f232b",
          // Menus / popovers
          menu: "#1c2028",
          menuItemHover: "rgb(255 255 255 / 0.06)",
        },
        primary: {
          DEFAULT: "#646cff",
          hover: "#7b83ff",
        },
        accent: "#00e5ff",
        text: {
          main: "#ffffff",
          muted: "#8b949e",
          dim: "#484f58",
          // Menus / popovers
          menuLabel: "#7d8590",
          menuDesc: "#66707d",
        },
        border: {
          DEFAULT: "#30363d",
          active: "#539bf5",
          // Menus / popovers
          menu: "rgb(255 255 255 / 0.10)",
          menuInner: "rgb(255 255 255 / 0.06)",
          menuDivider: "rgb(255 255 255 / 0.08)",
        },
        status: {
          success: "#238636",
          warning: "#d29922",
          error: "#da3633",
          info: "#0969da",
        },
      },
      boxShadow: {
        menu: "inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 60px rgba(0,0,0,0.55), 0 6px 22px rgba(0,0,0,0.35)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
