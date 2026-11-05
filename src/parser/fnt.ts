import { readFileSync } from "node:fs";
import path from "node:path";

// BMFont 位图字体（.fnt 文本格式）解析：静态渲染逐字摆位
// 实测两种变体（CC-Default 真实样本）：
//   1. FairyGUI UIBuilder 变体（HitNumber.fnt）：`char id=48 img=duef6n ...` 每字符是包内独立图片资源 id
//   2. 标准 BMFont 图集变体（BMFontTest.fnt）：`char id=20307 x=.. y=.. width=.. height=.. page=0` 字符是图集矩形，
//      图集由 font 资源的 texture 属性（package.xml）指定，page file 字段实测可能是占位（11_0.png 不存在）
// 仅解析文本结构；图片资源解析（img id / texture id / page file）由 scene-builder 在构建期完成（需要包索引）

export interface FntGlyph {
  /** 字符码点 */
  id: number;
  /** FairyGUI 变体：包内图片资源 id（与 atlas 字段二选一） */
  img?: string;
  /** 图集变体：矩形与步进 */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  xoffset?: number;
  yoffset?: number;
  xadvance?: number;
  page?: number;
}

export interface FntData {
  lineHeight: number;
  glyphs: FntGlyph[];
  /** page id -> 文件名（图集变体；可能与实际图集不符，优先用 font 资源 texture 属性） */
  pages: string[];
}

const fntCache = new Map<string, FntData>();

const ATTR_RE = /(\w+)=("[^"]*"|\S+)/g;

function attrsOf(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(ATTR_RE)) out[m[1]] = m[2].replace(/^"|"$/g, "");
  return out;
}

/** 解析 .fnt 文件（带缓存） */
export function parseFnt(file: string): FntData {
  const key = path.normalize(file);
  const cached = fntCache.get(key);
  if (cached) return cached;
  const lines = readFileSync(key, "utf-8").split(/\r?\n/);
  let lineHeight = 0;
  const glyphs: FntGlyph[] = [];
  const pages: string[] = [];
  for (const line of lines) {
    const a = attrsOf(line);
    if (a.lineHeight !== undefined) lineHeight = Number(a.lineHeight) || 0;
    else if (a.id !== undefined && a.file !== undefined) pages[Number(a.id) || 0] = a.file;
    else if (a.id !== undefined && (a.img !== undefined || a.x !== undefined)) {
      glyphs.push({
        id: Number(a.id),
        img: a.img,
        x: a.x !== undefined ? Number(a.x) : undefined,
        y: a.y !== undefined ? Number(a.y) : undefined,
        width: a.width !== undefined ? Number(a.width) : undefined,
        height: a.height !== undefined ? Number(a.height) : undefined,
        xoffset: a.xoffset !== undefined ? Number(a.xoffset) : 0,
        yoffset: a.yoffset !== undefined ? Number(a.yoffset) : 0,
        xadvance: a.xadvance !== undefined ? Number(a.xadvance) : undefined,
        page: a.page !== undefined ? Number(a.page) : 0,
      });
    }
  }
  const data = { lineHeight, glyphs, pages };
  fntCache.set(key, data);
  return data;
}

/** 构建期解析结果：字符 -> 渲染所需全部信息（图片文件已解析为绝对路径） */
export interface BitmapGlyph {
  file: string;
  /** FairyGUI 变体：资源登记尺寸；图集变体：矩形宽高 */
  w: number;
  h: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  /** 图集变体：图集内矩形坐标 */
  atlasX?: number;
  atlasY?: number;
}

export interface BitmapFontResolved {
  glyphs: Map<number, BitmapGlyph>;
  /** 行高（图集变体 lineHeight；FairyGUI 变体取最大字形高） */
  lineHeight: number;
}
