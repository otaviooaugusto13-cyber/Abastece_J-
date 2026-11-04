import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Build → ../../cs-app (servido pelo Express em /painel-cs). base absoluta: a página está em /painel-cs (sem barra final).
export default defineConfig({ plugins: [react()], base: "/cs-app/", build: { outDir: "../../cs-app", emptyOutDir: true, sourcemap: false }, server: { fs: { allow: ["../.."] } } });
