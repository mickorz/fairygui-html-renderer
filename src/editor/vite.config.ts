import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// UI 编辑器 dev 配置（npm run editor 时 Vite 以本目录为 root 自动加载）
// /api 代理到现有 Node server（npm run serve，端口 7788）
// 画布内资源不走 Vite 代理：由服务端 asset 路由 + iframe base href 解析
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:7788",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
