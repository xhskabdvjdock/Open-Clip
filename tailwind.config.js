/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "IBM Plex Sans Arabic",
          "Inter",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Cascadia Code",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Desktop-native neutral palette, no gradients / neon
        surface: {
          DEFAULT: "#ffffff",
          dark: "#1a1d21",
        },
      },
    },
  },
  plugins: [],
};
