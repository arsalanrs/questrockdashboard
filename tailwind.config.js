/** @type {import('next').NextConfig} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background:   "hsl(var(--background))",
        foreground:   "hsl(var(--foreground))",
        muted:        "hsl(var(--muted))",
        mutedForeground: "hsl(var(--muted-foreground))",
        border:       "hsl(var(--border))",
        card:         "hsl(var(--card))",
        cardForeground: "hsl(var(--card-foreground))",
        primary:      "hsl(var(--primary))",
        primaryForeground: "hsl(var(--primary-foreground))",
        destructive:  "hsl(var(--destructive))",
        destructiveForeground: "hsl(var(--destructive-foreground))",
        /* Named yellow accent for use in className */
        accent: {
          DEFAULT: "#E8FF00",
          dim:     "rgba(232, 255, 0, 0.12)",
        },
      },
      borderRadius: {
        lg:  "var(--radius)",
        xl:  "16px",
        "2xl": "20px",
      },
      boxShadow: {
        card:   "0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)",
        "card-hover": "0 4px 16px rgba(0,0,0,0.5)",
        yellow: "0 0 0 1px rgba(232,255,0,0.15), 0 4px 24px rgba(232,255,0,0.08)",
      },
    },
  },
  plugins: [],
};
