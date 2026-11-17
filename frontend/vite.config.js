import { defineConfig, loadEnv } from 'vite';

// Preserve the existing GitHub Pages project path by default.
// Root-hosted deployments can explicitly set VITE_BASE_PATH=/ at build time.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: env.VITE_BASE_PATH?.trim() || (mode === 'production' ? '/Predio-AI/' : '/'),
  };
});
