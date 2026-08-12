import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0B0D12",
          900: "#12141B",
          800: "#1B1E27",
          700: "#2A2E3A",
          600: "#454B5C",
          500: "#63697A",
          400: "#8A8F9E",
          300: "#B3B7C2",
          200: "#DADCE3",
          100: "#EEEFF3",
          50: "#F7F8FA",
        },
        accent: {
          600: "#7E1D12",
          500: "#9C2416",
          400: "#B84433",
          100: "#FBEAE7",
          50: "#FDF3F1",
        },
        risk: {
          600: "#C2410C",
          100: "#FCEADB",
        },
        waiting: {
          600: "#9A6B12",
          100: "#FBF1DC",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        heading: ["var(--font-space-grotesk)", "var(--font-inter)", "-apple-system", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 18, 27, 0.04), 0 1px 1px rgba(16, 18, 27, 0.03)",
        popover: "0 12px 32px rgba(16, 18, 27, 0.14)",
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
};

export default config;
