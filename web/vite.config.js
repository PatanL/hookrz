import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const pages = ['index', 'coins', 'coin', 'stacks', 'blocks', 'build', 'docs'];
export default defineConfig({
  base: './', // works on hookrz.fun/ and on patanl.github.io/hookrz/
  build: { rollupOptions: { input: Object.fromEntries(pages.map((p) => [p, resolve(__dirname, `${p}.html`)])) } },
  server: { allowedHosts: true },
});
