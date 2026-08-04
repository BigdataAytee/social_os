/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // Inlines styles/tokens.css into globals.css before Tailwind runs, so the
    // tokens' `@layer base` resolves against `@tailwind base`.
    "postcss-import": {},
    tailwindcss: {},
  },
};

export default config;
