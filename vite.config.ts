import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // VITE_BASE=/zip-to-git/ quando o app é publicado dentro do portfólio.
    base: process.env.VITE_BASE || '/',
    plugins: [react(), tailwindcss()],
    // Só variáveis VITE_ vão para o navegador. (Antes 'NVIDIA_' também ia, o que
    // colocava NVIDIA_API_KEY dentro do JavaScript público.)
    envPrefix: ['VITE_'],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
