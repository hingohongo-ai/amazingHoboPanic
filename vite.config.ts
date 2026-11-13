import { defineConfig } from 'vite';

// Relative base so the game works from /amazingHoboPanic/ or any other subfolder.
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2500 },
});
