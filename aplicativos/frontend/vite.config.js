
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Integração do React com o Vite
  plugins: [react()],

  // Configurações do servidor de desenvolvimento
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,

    // Encaminha as chamadas da API para o backend Node.js
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        secure: false,
      },
    },
  },

  // Configurações de compilação para produção
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    emptyOutDir: true,
  },

  // Configurações do Vitest
  test: {
    environment: "jsdom",

    // Arquivo responsável pela preparação dos testes
    setupFiles: ["./src/test-stup.js"],

    // Arquivos de teste reconhecidos pelo Vitest
    include: ["src/**/*.test.{js,jsx}"],

    // Limpeza de mocks entre os testes
    clearMocks: true,
    restoreMocks: true,
  },
});