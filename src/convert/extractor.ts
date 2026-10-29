import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findChrome } from "../mcp/chrome.js";

// browser-extractor（阶段 G）：无人值守提取
// 原理：向样本 HTML 注入提取脚本（把 JSON 写入隐藏 <pre id="__extract__">），
// Chrome headless --dump-dom 输出执行后的 DOM，Node 端解析出 JSON。
// 提取发生在浏览器渲染之后，Flex/Grid 等布局天然导出计算后的最终位置。

export interface ExtractNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "image" | "text" | "graph" | "container" | "list";
  /** list 专有：折叠的 item 样本与数量（同结构连续兄弟 >=3 折叠为 GList） */
  item?: ExtractNode;
  count?: number;
  layout?: string;
  lineItemCount?: number;
  src?: string;
  text?: string;
  fontSize?: number;
  color?: string;
  bgColor?: string;
  fillColor?: string;
  strokeColor?: string;
  strokeSize?: number;
  opacity?: number;
  rotation?: number;
  children?: ExtractNode[];
}

export interface ExtractData {
  canvas: { w: number; h: number };
  nodes: ExtractNode[];
}

/** 注入到样本 HTML 的提取脚本：递归 #canvas 子树，产出带相对坐标与视觉属性的 JSON */
export const EXTRACT_SNIPPET = `
<script>
(function () {
  function walk(el, base, out) {
    for (var i = 0; i < el.children.length; i++) {
      var child = el.children[i];
      var cs = getComputedStyle(child);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var cr = child.getBoundingClientRect();
      var br = base.getBoundingClientRect();
      var node = {
        id: child.id || child.tagName.toLowerCase() + "_" + out.length,
        x: Math.round(cr.left - br.left),
        y: Math.round(cr.top - br.top),
        w: Math.round(cr.width),
        h: Math.round(cr.height)
      };
      var ownText = "";
      for (var j = 0; j < child.childNodes.length; j++) {
        if (child.childNodes[j].nodeType === 3) ownText += child.childNodes[j].textContent;
      }
      ownText = ownText.trim();
      var hasBg = cs.backgroundColor !== "rgba(0, 0, 0, 0)";
      if (child.tagName === "IMG") {
        node.kind = "image";
        node.src = child.getAttribute("src");
      } else if (child.children.length > 0) {
        // 有子元素必为容器：背景色挂容器节点（mapper 会先铺 graph 背景）
        node.kind = "container";
        if (hasBg) node.fillColor = cs.backgroundColor;
      } else if (ownText) {
        node.kind = "text";
        node.text = ownText;
        node.fontSize = parseInt(cs.fontSize);
        node.color = cs.color;
        if (hasBg) node.bgColor = cs.backgroundColor;
        if (cs.webkitTextStrokeWidth && cs.webkitTextStrokeWidth !== "0px") {
          node.strokeColor = cs.webkitTextStrokeColor;
          node.strokeSize = parseFloat(cs.webkitTextStrokeWidth);
        }
      } else if (hasBg) {
        node.kind = "graph";
        node.fillColor = cs.backgroundColor;
      } else {
        node.kind = "container";
      }
      if (cs.opacity !== "1") node.opacity = parseFloat(cs.opacity);
      var tf = cs.transform;
      if (tf && tf !== "none") {
        var m = tf.match(/matrix\\(([^)]+)\\)/);
        if (m) {
          var p = m[1].split(",").map(parseFloat);
          node.rotation = Math.round(Math.atan2(p[1], p[0]) * 180 / Math.PI);
        }
      }
      var kids = [];
      walk(child, child, kids);
      if (kids.length) node.children = kids;
      out.push(node);
    }
  }
  // 连续同结构签名的兄弟节点（>=3）折叠为 list：编辑器里是可维护的 GList，而非散落节点
  function signature(n) {
    return n.kind + "|" + n.w + "x" + n.h + "|" + (n.fontSize || "") + "|" + (n.color || "") + "|" + (n.bgColor || "") + "|" + (n.fillColor || "") + "|" + (n.src || "");
  }
  function foldLists(nodes) {
    var out2 = [];
    var i = 0;
    while (i < nodes.length) {
      var n = nodes[i];
      var sig = signature(n);
      var repeatable = n.kind === "text" || n.kind === "image" || n.kind === "graph";
      var j = i + 1;
      if (repeatable && sig) {
        while (j < nodes.length && signature(nodes[j]) === sig) j++;
      }
      var count = j - i;
      // SDK 词表（ListLayout）：column/row/flow_hz/flow_vt/pagination；lineItemCount=每行项数
      var layout = "column";
      var lineItemCount = 0;
      if (count > 1) {
        var ys = {}, xs = {};
        for (var k2 = i; k2 < j; k2++) { ys[nodes[k2].y] = 1; xs[nodes[k2].x] = 1; }
        var rows = Object.keys(ys).length, cols = Object.keys(xs).length;
        if (rows === 1) { layout = "row"; lineItemCount = count; }
        else if (cols === 1) { layout = "column"; lineItemCount = 1; }
        else { layout = "flow_hz"; lineItemCount = cols; }
      }
      if (repeatable && count >= 3) {
        var item = {};
        for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k)) item[k] = n[k];
        item.id = "item";
        out2.push({
          id: n.id + "_list",
          kind: "list",
          x: n.x,
          y: n.y,
          w: nodes[j - 1].x + nodes[j - 1].w - n.x,
          h: nodes[j - 1].y + nodes[j - 1].h - n.y,
          item: item,
          count: count,
          layout: layout,
          lineItemCount: lineItemCount
        });
      } else {
        if (n.children) n.children = foldLists(n.children);
        out2.push(n);
      }
      i = j;
    }
    return out2;
  }

  var canvas = document.getElementById("canvas");
  var out = [];
  walk(canvas, canvas, out);
  out = foldLists(out);
  var pre = document.createElement("pre");
  pre.id = "__extract__";
  pre.style.display = "none";
  pre.textContent = JSON.stringify({ canvas: { w: canvas.offsetWidth, h: canvas.offsetHeight }, nodes: out });
  document.body.appendChild(pre);
})();
</scr` + `ipt>`;

/** 给样本 HTML 注入提取脚本（</body> 前插入），返回注入后的 HTML */
export function injectExtractor(html: string): string {
  if (html.includes("__extract__")) return html; // 已注入
  if (html.includes("</body>")) return html.replace("</body>", EXTRACT_SNIPPET + "\n</body>");
  return html + EXTRACT_SNIPPET;
}

function unescapeHtml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** Chrome headless 提取：样本.html -> 提取 JSON（渲染后最终布局） */
export function extractFromHtml(htmlFile: string, viewport?: { width: number; height: number }): ExtractData {
  const chrome = findChrome();
  if (!chrome) throw new Error("未找到 Chrome，请安装或设置 CHROME_PATH");
  const injected = injectExtractor(fs.readFileSync(htmlFile, "utf8"));
  const tmpHtml = path.join(path.dirname(htmlFile), path.basename(htmlFile, ".html") + ".extract.html");
  fs.writeFileSync(tmpHtml, injected, "utf8");
  const w = viewport?.width ?? 800;
  const h = viewport?.height ?? 600;
  const r = spawnSync(
    chrome,
    ["--headless=new", "--disable-gpu", "--no-first-run", `--window-size=${w},${h}`, "--virtual-time-budget=2000", "--dump-dom", fileUrl(tmpHtml)],
    { timeout: 30_000, maxBuffer: 32 * 1024 * 1024, encoding: "buffer" },
  );
  const dom = r.stdout?.toString() ?? "";
  // dump-dom 序列化的 pre 可能带 style 等属性，属性部分宽松匹配
  const m = dom.match(/<pre id="__extract__"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) throw new Error(`提取失败：输出中无 __extract__ 数据（检查 #canvas 是否存在）${r.stderr?.toString().slice(0, 200) ?? ""}`);
  fs.unlinkSync(tmpHtml);
  return JSON.parse(unescapeHtml(m[1])) as ExtractData;
}

function fileUrl(abs: string): string {
  return "file:///" + path.resolve(abs).replace(/\\/g, "/");
}
