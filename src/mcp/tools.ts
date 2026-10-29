import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPackage, resourceIdOf } from "../parser/package-parser.js";
import { getComponent, buildScene } from "../scene/scene-builder.js";
import type { ParsedComponent, ParsedNode } from "../parser/component-parser.js";
import { listComponents, listPackages, searchWorkspace } from "../scene/workspace.js";
import { renderHtml } from "../renderer/html-renderer.js";
import { screenshotUrl } from "./chrome.js";

// MCP 四工具的核心逻辑（阶段 D）：纯函数、与传输层（stdio 协议壳）分离，便于直测
// 全部只读：render/screenshot 产物写入系统临时目录，不触碰 FairyGUI 工程

export interface McpContext {
  rootDir: string;
}

function outDir(): string {
  const dir = path.join(os.tmpdir(), "fairygui-mcp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** file:/// 绝对 URL（Windows 盘符与反斜杠归一） */
function fileUrl(abs: string): string {
  return "file:///" + path.resolve(abs).replace(/\\/g, "/");
}

export function toolListComponents(ctx: McpContext, args: { package?: string }): Record<string, unknown> {
  if (args.package) {
    const listing = listComponents(ctx.rootDir, args.package);
    if (!listing) throw new Error(`包不存在: ${args.package}`);
    return { package: args.package, ...listing };
  }
  return { packages: listPackages(ctx.rootDir) };
}

export function toolLocate(ctx: McpContext, args: { query: string }): Record<string, unknown> {
  const q = (args.query ?? "").trim();
  if (!q) throw new Error("query 不能为空");
  return searchWorkspace(ctx.rootDir, q.toLowerCase());
}

export interface FoundNode {
  pkgDir: string;
  pkgId: string;
  component: string;
  /** 节点实际所在的组件场景（嵌套时为子组件场景，非渲染入口根场景） */
  scene: ParsedComponent;
  node: ParsedNode;
}

/** 全工程按稳定键精确反查节点（含所在组件场景与设计坐标来源） */
export function findNodeByKey(ctx: McpContext, key: string): FoundNode | null {
  for (const p of listPackages(ctx.rootDir)) {
    const pkgDir = path.join(ctx.rootDir, p.dir);
    const pkg = loadPackage(pkgDir);
    for (const r of pkg.resources) {
      if (r.kind !== "component") continue;
      const scene = buildScene(getComponent(r.file, { fresh: true }), { pkg, root: ctx.rootDir });
      const hit = findInNodes(scene, key);
      if (hit) return { pkgDir, pkgId: pkg.id, component: `${p.name}/${r.name}`, scene: hit.scene, node: hit.node };
    }
  }
  return null;
}

function findInNodes(scene: ParsedComponent, key: string): { scene: ParsedComponent; node: ParsedNode } | null {
  for (const n of scene.nodes) {
    if (n.stableKey === key) return { scene, node: n };
    if (n.childComp) {
      const hit = findInNodes(n.childComp.comp, key);
      if (hit) return hit;
    }
  }
  return null;
}

/** key -> 节点定位信息（设计坐标），供 AI 直接消费 */
export function describeNode(ctx: McpContext, key: string, found?: FoundNode | null): Record<string, unknown> {
  const f = found ?? findNodeByKey(ctx, key);
  if (!f) throw new Error(`未找到稳定键对应的节点: ${key}`);
  const rel = path.relative(ctx.rootDir, f.scene.file).split(path.sep).join("/");
  return {
    id: f.node.id,
    name: f.node.name,
    type: f.node.type,
    path: f.node.instancePath,
    key: f.node.stableKey,
    // 设计坐标（FairyGUI 坐标系）；浏览器实际坐标需由 DOM 测量获得
    bounds: { x: f.node.xy[0], y: f.node.xy[1], width: f.node.size?.[0] ?? null, height: f.node.size?.[1] ?? null },
    unsupported: f.node.unsupported ?? null,
    component: f.component,
    sourceFile: rel,
    resourceId: resourceIdOf(loadPackage(f.pkgDir), f.scene.file) ?? null,
  };
}

export interface RenderResult {
  htmlFile: string;
  url: string;
  node: Record<string, unknown>;
}

/** 渲染 key 所在组件并写入临时目录；HTML 自带 focus 定位（打开即高亮目标节点） */
export function toolRender(ctx: McpContext, args: { key: string }): RenderResult {
  const f = findNodeByKey(ctx, args.key);
  if (!f) throw new Error(`未找到稳定键对应的节点: ${args.key}`);
  const pkg = loadPackage(f.pkgDir);
  const html = renderHtml(f.scene, {
    pkg,
    toAssetUrl: (abs) => fileUrl(abs),
  });
  const base = path.basename(f.scene.file, ".xml");
  const htmlFile = path.join(outDir(), `${base}-${sanitize(args.key)}.html`);
  fs.writeFileSync(htmlFile, html, "utf8");
  return {
    htmlFile,
    url: fileUrl(htmlFile),
    node: describeNode(ctx, args.key, f),
  };
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export interface ScreenshotResult extends RenderResult {
  screenshotFile: string;
  viewport: { width: number; height: number };
}

/** 渲染 + Chrome headless 截图（focus 高亮 JS 执行完成后截屏） */
export function toolScreenshot(ctx: McpContext, args: { key: string; width?: number; height?: number }): ScreenshotResult {
  const width = Math.min(Math.max(args.width ?? 1280, 200), 3840);
  const height = Math.min(Math.max(args.height ?? 800, 200), 2160);
  const render = toolRender(ctx, { key: args.key });
  const pngFile = render.htmlFile.replace(/\.html$/, ".png");
  screenshotUrl(render.url, pngFile, width, height);
  return { ...render, screenshotFile: pngFile, viewport: { width, height } };
}
