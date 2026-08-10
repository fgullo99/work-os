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
          600: "#3B4CE0",
          500: "#4A5AF0",
          400: "#6E7BF5",
          100: "#E7E9FD",
          50: "#F2F3FE",
        },
        risk: {
          600: "#C4432B",
          100: "#FBEAE6",
        },
        waiting: {
          600: "#9A6B12",
          100: "#FBF1DC",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
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
