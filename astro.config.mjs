import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';

var base = process.env.GITHUB_ACTIONS ? '/YooExcalidraw' : '/';

export default defineConfig({
  site: 'https://yhui02.github.io',
  base: base,
  output: 'static',
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
});
