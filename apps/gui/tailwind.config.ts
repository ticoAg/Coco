import type { Config } from "tailwindcss";

const rgb = (cssVar: string) => `rgb(var(${cssVar}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          app: rgb("--am-bg-app"),
          panel: rgb("--am-bg-panel"),
          panelHover: rgb("--am-bg-panel-hover"),
          // Menus / popovers
          menu: rgb("--am-bg-menu"),
          popover: rgb("--am-bg-popover"),
          menuItemHover: "rgb(255 255 255 / var(--am-alpha-menu-item-hover))",
        },
        primary: {
          DEFAULT: rgb("--am-primary"),
          hover: rgb("--am-primary-hover"),
        },
        accent: rgb("--am-accent"),
        text: {
          main: rgb("--am-text-main"),
          muted: rgb("--am-text-muted"),
          dim: rgb("--am-text-dim"),
          // Menus / popovers
          menuLabel: rgb("--am-text-menu-label"),
          menuDesc: rgb("--am-text-menu-desc"),
        },
        border: {
          DEFAULT: rgb("--am-border"),
          active: rgb("--am-border-active"),
          // Menus / popovers
          menu: "rgb(255 255 255 / var(--am-alpha-menu-border))",
          menuInner: "rgb(255 255 255 / var(--am-alpha-menu-inner-border))",
          menuDivider: "rgb(255 255 255 / var(--am-alpha-menu-divider))",
        },
        token: {
          // Token foreground is used for "neutral grey" message surfaces (e.g. bg-token-foreground/5),
          // matching VS Code Codex webview semantics.
          foreground: rgb("--am-text-main"),
          inputBackground: rgb("--am-token-input-background"),
          border: rgb("--am-token-border"),
          borderStrong: rgb("--am-token-border-strong"),
          codeBackground: rgb("--am-token-code-background"),
        },
        status: {
          success: rgb("--am-status-success"),
          warning: rgb("--am-status-warning"),
          error: rgb("--am-status-error"),
          info: rgb("--am-status-info"),
        },
      },
      boxShadow: {
        menu: "var(--am-shadow-menu)",
        card: "var(--am-shadow-card)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
