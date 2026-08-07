export default {
  plugins: {
    // Tailwind v4 handles vendor prefixing itself (Lightning CSS), so a
    // separate autoprefixer plugin is no longer needed.
    "@tailwindcss/postcss": {},
  },
};
