import type { ParsedComponent, ParsedNode } from "../parser/component-parser.js";
import { resourceIdOf, type FairyPackage } from "../parser/package-parser.js";

// Scene Tree JSON：对 AI / 前端输出的核心数据模型（B2）
// 与渲染器共用 buildScene 填充的 instancePath / stableKey，保证「查 JSON = 查画布」。

export interface SceneJsonOptions {
  /** 把绝对文件路径转为对外相对路径（如相对工程根） */
  relativize?: (abs: string) => string;
}

function nodeJson(node: ParsedNode, pkg: FairyPackage, opts: SceneJsonOptions): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: node.type,
    id: node.id,
    name: node.name,
    path: node.instancePath,
    key: node.stableKey,
    xy: node.xy,
    size: node.size ?? null,
    src: node.src ?? null,
    attrs: node.attrs,
    gears: node.gears.length ? node.gears : undefined,
    unsupported: node.unsupported,
  };
  if (node.childComp) {
    base.component = {
      file: opts.relativize ? opts.relativize(node.childComp.file) : node.childComp.file,
      packageId: pkg.id,
      resourceId: resourceIdOf(pkg, node.childComp.file) ?? null,
    };
    base.children = node.childComp.comp.nodes.map((n) => nodeJson(n, pkg, opts));
  }
  return base;
}

/** 场景树 -> 结构化 JSON（undefined 字段由 JSON.stringify 自动剔除） */
export function toSceneJson(scene: ParsedComponent, pkg: FairyPackage, opts: SceneJsonOptions = {}): Record<string, unknown> {
  return {
    file: opts.relativize ? opts.relativize(scene.file) : scene.file,
    packageId: pkg.id,
    size: scene.size,
    extension: scene.extension ?? null,
    controllers: scene.controllers,
    nodes: scene.nodes.map((n) => nodeJson(n, pkg, opts)),
  };
}
