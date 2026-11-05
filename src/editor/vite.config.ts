import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// UI 编辑器 dev 配置（npm run editor 时 Vite 以本目录为 root 自动加载）
// /api 代理到现有 Node server（npm run serve，端口 7788；测试可用 EDITOR_API_PORT 覆盖）
// vite 端口默认 5174（EDITOR_VITE_PORT 可覆盖），与主分支 worktree 的 5173 避开；非 strictPort，被占用时自动顺延
// 画布内资源不走 Vite 代理：由服务端 asset 路由 + iframe base href 解析
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.EDITOR_VITE_PORT || 5174),
    proxy: {
      "/api": {
        target: "http://localhost:" + (process.env.EDITOR_API_PORT || "7788"),
        changeOrigin: true,
      },
      // /view（Renderer 回读预览，convert 完成后的链接走同源）
      "/view": {
        target: "http://localhost:" + (process.env.EDITOR_API_PORT || "7788"),
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
