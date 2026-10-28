import { readFileSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

// FairyGUI package.xml 解析：建立资源 id 索引（原版编辑器格式，CC-Default 为准）

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
});

export interface ImageResource {
  kind: "image";
  id: string;
  name: string;
  /** 物理文件路径（绝对） */
  file: string;
  width?: number;
  height?: number;
  /** 九宫格 "x,y,w,h"（P1 用于 border-image） */
  scale9grid?: string;
}

export interface ComponentResource {
  kind: "component";
  id: string;
  name: string;
  file: string;
  exported: boolean;
}

export interface OtherResource {
  kind: "other";
  type: string;
  id: string;
  name: string;
  file: string;
}

export type Resource = ImageResource | ComponentResource | OtherResource;

export interface FairyPackage {
  dir: string;
  id: string;
  resources: Resource[];
  byId(id: string): Resource | undefined;
}

export function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** 解析 package.xml，pkgDir 为包所在目录（含 package.xml） */
export function loadPackage(pkgDir: string): FairyPackage {
  const doc = parser.parse(readFileSync(path.join(pkgDir, "package.xml"), "utf8"));
  const desc = doc.packageDescription;
  if (!desc) throw new Error(`${pkgDir}/package.xml 缺少 packageDescription 根节点`);

  const resources: Resource[] = [];
  // resources 下按标签名分组：image / component / movieclip / font / jta 等
  const group = desc.resources ?? {};
  for (const [tag, list] of Object.entries(group)) {
    for (const e of asArray<Record<string, string>>(list as Record<string, string>)) {
      const file = path.join(pkgDir, String(e.path ?? "/").replace(/^\/+/, ""), e.name);
      if (tag === "image") {
        resources.push({
          kind: "image",
          id: e.id,
          name: e.name,
          file,
          width: e.width !== undefined ? Number(e.width) : undefined,
          height: e.height !== undefined ? Number(e.height) : undefined,
          scale9grid: e.scale9grid,
        });
      } else if (tag === "component") {
        resources.push({ kind: "component", id: e.id, name: e.name, file, exported: e.exported === "true" });
      } else {
        resources.push({ kind: "other", type: tag, id: e.id, name: e.name, file });
      }
    }
  }

  const index = new Map(resources.map((r) => [r.id, r]));
  return { dir: pkgDir, id: desc.id, resources, byId: (id) => index.get(id) };
}
