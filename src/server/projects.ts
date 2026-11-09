import fs from "node:fs";
import path from "node:path";
import { listPackages } from "../scene/workspace.js";

// 多工程切换（设计方案 v2，P0-A）：工程注册与白名单解析工厂。
// 两种工作区形态：
//   multi  —— projects/ 注册目录（每个含 assets 的直接子目录是一个工程），白名单解析，未知工程 404
//   single —— 单工程根（现状形态：rootDir 下直接 assets/，tests/fixtures/workspace 与环境变量工程根皆此形态）
// 工程是请求的上下文不是服务状态：同一进程按请求解析，两个标签页可各看各的工程。

export interface ProjectEntry {
  name: string;
  root: string;
  assetsRoot: string;
  packageCount: number;
}

export interface Workspace {
  mode: "single" | "multi";
  defaultProject: string;
  projects: ProjectEntry[];
  /**
   * 白名单解析（project 参数不参与任何路径拼接，只做 Map 查找，防注入）：
   * - null/空 -> 默认工程
   * - multi：命中白名单返回工程；未命中返回 null（调用方 404，不静默回退）
   * - single：宽容映射到唯一工程（向后兼容：旧链接/脚本带了 project 参数不破）
   */
  resolve(name: string | null): ProjectEntry | null;
}

function entryOf(root: string, name?: string): ProjectEntry {
  const abs = path.resolve(root);
  return {
    name: name ?? path.basename(abs),
    root: abs,
    assetsRoot: path.join(abs, "assets"),
    packageCount: fs.existsSync(path.join(abs, "assets")) ? listPackages(abs).length : 0,
  };
}

/** 枚举注册目录下的工程：直接子目录含 assets/ 即工程，名称即目录名（天然白名单） */
export function discoverProjects(projectsDir: string): ProjectEntry[] {
  const dir = path.resolve(projectsDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .sort()
    .filter((name) => fs.existsSync(path.join(dir, name, "assets")))
    .map((name) => entryOf(path.join(dir, name), name));
}

/** 多工程模式：projectsDir 为注册目录（哪怕只有 1 个工程也保持白名单语义） */
export function multiProjectWorkspace(projectsDir: string): Workspace {
  const projects = discoverProjects(projectsDir);
  const byName = new Map(projects.map((p) => [p.name, p]));
  const def = projects[0] ?? null;
  return {
    mode: "multi",
    defaultProject: def?.name ?? "",
    projects,
    resolve: (name) => (name ? (byName.get(name) ?? null) : def),
  };
}

/** 单工程模式：rootDir 即工程根（现状形态，零行为变化） */
export function singleProjectWorkspace(rootDir: string): Workspace {
  const e = entryOf(rootDir);
  return { mode: "single", defaultProject: e.name, projects: [e], resolve: () => e };
}

/** 默认工程根（MCP 等单工程消费方共用）：注册目录第一个工程；否则回退环境变量/CC-Default */
export function defaultProjectRoot(): string {
  const projects = discoverProjects(path.resolve("projects"));
  if (projects.length > 0) return projects[0].root;
  return path.resolve(process.env.FGUI_PROJECT_ROOT ?? "CC-Default");
}
