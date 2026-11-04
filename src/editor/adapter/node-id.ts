// 节点身份（执行计划第六节规则）：
// - 属性名 data-fgui-node-id
// - 已有 id 保留；缺失按文档顺序生成 node_001 递增，不与已有冲突
// - 编辑过程中不重排、不回收；导出前校验唯一性

export const NODE_ID_ATTR = "data-fgui-node-id";

function allElements(root: Element): Element[] {
  return [root, ...Array.from(root.querySelectorAll("*"))];
}

/** 收集文档中已存在的节点 id 与重复项；重复项按出现顺序返回 */
export function collectIds(root: Element): { ids: string[]; duplicates: string[] } {
  const ids: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const el of allElements(root)) {
    const v = el.getAttribute(NODE_ID_ATTR);
    if (v === null) continue;
    if (seen.has(v)) duplicates.push(v);
    else {
      seen.add(v);
      ids.push(v);
    }
  }
  return { ids, duplicates };
}

/** 为缺失 id 的元素按文档顺序补 node_XXX（跳过已有编号），返回新分配的 id 列表 */
export function assignNodeIds(root: Element): { assigned: string[]; duplicates: string[] } {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let max = 0;
  const missing: Element[] = [];
  for (const el of allElements(root)) {
    const v = el.getAttribute(NODE_ID_ATTR);
    if (v === null) {
      missing.push(el);
      continue;
    }
    if (seen.has(v)) duplicates.push(v);
    seen.add(v);
    const m = v.match(/^node_(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const assigned: string[] = [];
  let next = max + 1;
  for (const el of missing) {
    let id = "node_" + String(next).padStart(3, "0");
    while (seen.has(id)) id = "node_" + String(++next).padStart(3, "0");
    el.setAttribute(NODE_ID_ATTR, id);
    seen.add(id);
    assigned.push(id);
    next++;
  }
  return { assigned, duplicates };
}
