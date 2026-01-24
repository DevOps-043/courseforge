import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/features/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/shared/**/*.{js,ts,jsx,tsx,mdx}",
  ],

  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: '#050B14', // Deepest dark blue from reference
        surface: '#0F172A', // Slightly lighter for cards
        primary: {
          DEFAULT: '#00E5C0', // The bright teal/green from the image
          hover: '#00CDB0',
          dark: '#00B59C',
        },
        secondary: {
          DEFAULT: '#1F5AF6', // The deep blue
          hover: '#1a4bd3',
        },
        text: {
          main: '#FFFFFF',
          muted: '#94A3B8',
        }
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "hero-glow": "radial-gradient(circle at 50% 50%, rgba(31, 90, 246, 0.15), transparent 70%)",
      },
      animation: {
        "float-slow": "float 8s ease-in-out infinite",
        "pulse-glow": "pulse-glow 4s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-20px)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.5", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.05)" },
        }
      },
    },
  },
  plugins: [],
};
export default config;
