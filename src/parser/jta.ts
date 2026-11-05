import { readFileSync } from "node:fs";
import path from "node:path";

// jta（FairyGUI 序列帧动画）二进制解析：静态渲染取单帧
// 格式经 OpenFairy SDK Migrate.ImportMovieClip 源码核实（无 LICENSE，仅参考格式知识）：
//   [0..2)   uint16 魔术串长度（5）
//   [2..7)   "yytou"
//   [7..11)  int32  interval（毫秒）
//   [11..19) 8 字节保留
//   [19..21) int16  width
//   [21..23) int16  height
//   [23..24) 标志字节
//   [24..28) int32  frameCount
//   [28..)   每帧 12 字节：addDelay,x,y,w,h,imageIndex（int16 大端）
//   然后     int16 imageCount；每张图 int32 长度 + PNG 字节
// 注意：jta 内嵌 PNG 无文件通道，静态渲染以 data URL 内联（不做帧合成落盘）

export interface JtaFrame {
  /** 帧在动画画布中的位置与尺寸（左上原点，与 CSS 同向，无需翻转） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 帧引用的内嵌图（PNG 字节） */
  png: Buffer;
}

export interface JtaData {
  width: number;
  height: number;
  /** 帧间隔（毫秒）：头部偏移 7 的 int32（OpenFairy Migrate.ImportMovieClip 同源） */
  interval: number;
  frames: JtaFrame[];
}

const jtaCache = new Map<string, JtaData>();

/** 解析 jta 文件（带缓存，clearCache 由调用方整体失效时重建自然失效） */
export function parseJta(file: string): JtaData {
  const key = path.normalize(file);
  const cached = jtaCache.get(key);
  if (cached) return cached;
  const data = readFileSync(key);
  const i16 = (o: number) => data.readInt16BE(o);
  const i32 = (o: number) => data.readInt32BE(o);
  const magic = data.toString("latin1", 2, 7);
  if (magic !== "yytou") throw new Error(`${key} 不是合法 jta 文件（魔术串 ${JSON.stringify(magic)}）`);
  const width = i16(19);
  const height = i16(21);
  const interval = i32(7);
  const frameCount = i32(24);
  let offset = 28;
  const frameRects: { x: number; y: number; w: number; h: number; image: number }[] = [];
  for (let i = 0; i < frameCount; i++, offset += 12) {
    frameRects.push({ x: i16(offset + 2), y: i16(offset + 4), w: i16(offset + 6), h: i16(offset + 8), image: i16(offset + 10) });
  }
  const imageCount = i16(offset);
  offset += 2;
  const images: Buffer[] = [];
  for (let i = 0; i < imageCount; i++) {
    const size = i32(offset);
    offset += 4;
    images.push(data.subarray(offset, offset + size));
    offset += size;
  }
  const frames = frameRects.map((r) => ({
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    png: images[r.image] ?? images[0],
  }));
  const result = { width, height, interval, frames };
  jtaCache.set(key, result);
  return result;
}
