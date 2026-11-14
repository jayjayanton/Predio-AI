import { defineConfig } from 'vite';

// GitHub Pages project URL: /Predio-AI/.
// Local dev retains root path.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/Predio-AI/' : '/',
}));
