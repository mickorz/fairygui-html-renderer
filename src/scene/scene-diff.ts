import type { ParsedComponent, ParsedNode } from "../parser/component-parser.js";

// 场景结构差异分析（沿袭 egret 项目 P2-D scene-diff，适配 FairyGUI 组件模型）
// 两份构建场景的结构 diff（构建层 stableKey/instancePath 与画布/树一致）
//
// 匹配策略（为什么不用 stableKey 做身份主键）：
//   stableKey 含兄弟索引，对中间插入/删除敏感——中间插一个节点，后续兄弟 stableKey 全偏移，
//   一次插入会被误报成大量差异。因此身份判定分两层：
//     1. id 主键：FairyGUI 同文件内 id 唯一，跨版本保留率高（编辑器/代码靠 id 绑定）；
//        id 相同但父变化 -> moved；id 相同 -> 配对后做属性级 diff
//     2. 顺序配对：无 id 节点在相同父节点下按 type 分桶后按顺序一一配对
//   stableKey / instancePath 降级为报告中的定位信息（可喂给 /view?focus= 深度定位）。
//
// 已知边界（明示，不做近似猜测）：
//   无 id 同类型兄弟的中间插入/删除会从插入点起报成属性变化链（顺序配对的位置敏感性）；
//   有 id 节点不受影响。编辑器导出的节点普遍带 id，此边界影响有限。
//
// 差异分类：
//   added    B 有 A 无；removed A 有 B 无
//   moved    同 id 但父变化（跨父移动）
//   changed  配对成功但 flatten 路径属性变化（xy / attrs.text / component.file 全量诚实报告）

/** 差异节点定位信息（stableKey 供 /view?focus= 深度定位） */
export interface DiffNodeRef {
  stableKey: string;
  instancePath: string;
  type: string;
  name: string | null;
  id: string | null;
}

/** 属性级变化（flatten 路径，如 "xy"、"attrs.text"、"component.file"） */
export interface DiffPropChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface SceneDiff {
  fileA: string;
  fileB: string;
  stats: { matched: number; added: number; removed: number; moved: number; changed: number };
  added: DiffNodeRef[];
  removed: DiffNodeRef[];
  moved: { node: DiffNodeRef; fromParent: string; toParent: string }[];
  changed: { node: DiffNodeRef; changes: DiffPropChange[] }[];
}

// ---- FairyGUI 场景节点视图（构建节点/组件根统一形态） ----
interface SceneNodeLike {
  type: string;
  id?: string | null;
  name?: string | null;
  children: SceneNodeLike[];
  instancePath: string;
  stableKey: string;
  [k: string]: unknown;
}

/** 构建节点 -> diff 视图（children 经 childComp 展开；component 溯源进 flatten） */
function nodeOf(n: ParsedNode): SceneNodeLike {
  const out: SceneNodeLike = {
    type: n.type,
    id: n.id,
    name: n.name,
    children: n.childComp ? n.childComp.comp.nodes.map(nodeOf) : [],
    instancePath: n.instancePath ?? "",
    stableKey: n.stableKey ?? "",
    xy: n.xy,
    size: n.size ?? null,
    src: n.src ?? null,
    attrs: n.attrs,
  };
  if (n.childComp) out.component = { file: n.childComp.file };
  if (n.gears.length) out.gears = n.gears;
  if (n.unsupported?.length) out.unsupported = n.unsupported;
  return out;
}

/** 组件根合成节点（file 溯源 + 组件级属性全量进 flatten） */
function rootOf(comp: ParsedComponent): SceneNodeLike {
  const out: SceneNodeLike = {
    type: "component",
    id: null,
    name: null,
    children: comp.nodes.map(nodeOf),
    instancePath: comp.file,
    stableKey: pathBasename(comp.file),
    size: comp.size,
  };
  if (comp.overflow !== undefined) out.overflow = comp.overflow;
  if (comp.extension !== undefined) out.extension = comp.extension;
  if (comp.controllers.length) out.controllers = comp.controllers;
  if (comp.rootExtension !== undefined) out.rootExtension = comp.rootExtension;
  return out;
}

function pathBasename(f: string): string {
  return f.replace(/[\\/]/g, "/").split("/").pop() ?? f;
}

const refOf = (n: SceneNodeLike): DiffNodeRef => ({
  stableKey: n.stableKey,
  instancePath: n.instancePath,
  type: n.type,
  name: n.name ?? null,
  id: n.id ?? null,
});

/** 节点序列化对象 flatten 为 path -> 值（排除 children 与派生定位字段；属性变化全量报告不分主次） */
function flatten(node: object, prefix: string, out: Map<string, unknown>): void {
  for (const [k, v] of Object.entries(node)) {
    // stableKey/instancePath 是派生定位信息：父变化已由 moved 分类报告，不重复进属性差异
    if (k === "children" || k === "stableKey" || k === "instancePath") continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, p, out);
    } else {
      out.set(p, v ?? null);
    }
  }
}

function propChanges(a: SceneNodeLike, b: SceneNodeLike): DiffPropChange[] {
  const fa = new Map<string, unknown>();
  const fb = new Map<string, unknown>();
  flatten(a, "", fa);
  flatten(b, "", fb);
  const out: DiffPropChange[] = [];
  for (const k of new Set([...fa.keys(), ...fb.keys()])) {
    const va = fa.has(k) ? fa.get(k) : undefined;
    const vb = fb.has(k) ? fb.get(k) : undefined;
    if (JSON.stringify(va ?? null) !== JSON.stringify(vb ?? null)) out.push({ path: k, from: va ?? null, to: vb ?? null });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

/** 全树按 id 收集（含父引用，供配对侣伴式 moved 判定） */
function collectById(n: SceneNodeLike, parent: SceneNodeLike | null, out: Map<string, { node: SceneNodeLike; parentNode: SceneNodeLike | null }>): void {
  if (n.id) out.set(String(n.id), { node: n, parentNode: parent });
  for (const c of n.children) collectById(c, n, out);
}

export function diffScenes(a: ParsedComponent, b: ParsedComponent): SceneDiff {
  const diff: SceneDiff = {
    fileA: a.file,
    fileB: b.file,
    stats: { matched: 0, added: 0, removed: 0, moved: 0, changed: 0 },
    added: [],
    removed: [],
    moved: [],
    changed: [],
  };
  const paired = new Set<object>();
  // A 侧节点 -> 配对侣伴 B 侧节点（moved 判定：A 侧父的侣伴不是 B 侧实际父即真移动）
  const pairPartner = new Map<object, object>();

  const ra = rootOf(a);
  const rb = rootOf(b);

  const byIdA = new Map<string, { node: SceneNodeLike; parentNode: SceneNodeLike | null }>();
  const byIdB = new Map<string, { node: SceneNodeLike; parentNode: SceneNodeLike | null }>();
  collectById(ra, null, byIdA);
  collectById(rb, null, byIdB);

  // 第 1 遍：全部 id 配对先入 paired（防第 2 层重复走查），记录配对表
  const idPairs: { a: SceneNodeLike; b: SceneNodeLike; parentA: SceneNodeLike | null; parentB: SceneNodeLike | null }[] = [];
  for (const [id, ea] of byIdA) {
    const eb = byIdB.get(id);
    if (!eb) {
      diff.removed.push(refOf(ea.node));
      diff.stats.removed++;
      paired.add(ea.node);
      continue;
    }
    if (paired.has(ea.node)) continue; // 同 id 重复出现（异常数据）以首次为准
    paired.add(ea.node);
    paired.add(eb.node);
    pairPartner.set(ea.node, eb.node);
    idPairs.push({ a: ea.node, b: eb.node, parentA: ea.parentNode, parentB: eb.parentNode });
  }

  // 根配对（根属性变化可报告：size/overflow/controllers/rootExtension）
  paired.add(ra);
  paired.add(rb);
  pairPartner.set(ra, rb);
  diff.stats.matched++;
  const rootChanges = propChanges(ra, rb);
  if (rootChanges.length) {
    diff.changed.push({ node: refOf(rb), changes: rootChanges });
    diff.stats.changed++;
  }

  // 第 2 层先走：从根对齐无 id 分支（填满配对伴侣表，供 id 配对的 moved 判定用）
  diffChildren(ra, rb, diff, paired, pairPartner);

  // 第 3 步 a：id 配对先递归各自无 id 子孙（先填满全树配对伴侣表；
  // 顺序敏感：子节点在更深子树内，若先报 moved 再递归，伴侣表未齐会假报跨父移动）
  for (const p of idPairs) {
    diffChildren(p.a, p.b, diff, paired, pairPartner);
  }

  // 第 3 步 b：moved 判定 + 属性报告（全树伴侣表已齐，顺序无关）
  for (const p of idPairs) {
    // moved 判定：A 侧父的配对侣伴不是 B 侧实际父 => 真跨父移动
    const partnerOfParentA = p.parentA ? pairPartner.get(p.parentA) : rb;
    if (partnerOfParentA !== p.parentB) {
      diff.moved.push({
        node: refOf(p.b),
        fromParent: p.parentA ? p.parentA.instancePath : "<root>",
        toParent: p.parentB ? p.parentB.instancePath : "<root>",
      });
      diff.stats.moved++;
    } else {
      diff.stats.matched++;
    }
    const changes = propChanges(p.a, p.b);
    if (changes.length) {
      diff.changed.push({ node: refOf(p.b), changes });
      diff.stats.changed++;
    }
  }
  return diff;
}

/** 同父子列表配对：剔除已配对 -> 按 type 分桶 -> 桶内按顺序一一配对 -> 尾差 added/removed -> 递归 */
function diffChildren(a: SceneNodeLike, b: SceneNodeLike, diff: SceneDiff, paired: Set<object>, pairPartner: Map<object, object>): void {
  const aKids = a.children.filter((c) => !paired.has(c));
  const bKids = b.children.filter((c) => !paired.has(c));

  const sig = (n: SceneNodeLike) => n.type;
  const aBuckets = new Map<string, SceneNodeLike[]>();
  const bBuckets = new Map<string, SceneNodeLike[]>();
  for (const c of aKids) push(aBuckets, sig(c), c);
  for (const c of bKids) push(bBuckets, sig(c), c);

  for (const key of new Set([...aBuckets.keys(), ...bBuckets.keys()])) {
    const la = aBuckets.get(key) ?? [];
    const lb = bBuckets.get(key) ?? [];
    const n = Math.min(la.length, lb.length);
    for (let i = 0; i < n; i++) {
      const na = la[i];
      const nb = lb[i];
      paired.add(na);
      paired.add(nb);
      pairPartner.set(na, nb);
      diff.stats.matched++;
      const changes = propChanges(na, nb);
      if (changes.length) {
        diff.changed.push({ node: refOf(nb), changes });
        diff.stats.changed++;
      }
      diffChildren(na, nb, diff, paired, pairPartner);
    }
    for (let i = n; i < la.length; i++) {
      diff.removed.push(refOf(la[i]));
      diff.stats.removed++;
    }
    for (let i = n; i < lb.length; i++) {
      diff.added.push(refOf(lb[i]));
      diff.stats.added++;
    }
  }
}

function push(m: Map<string, SceneNodeLike[]>, k: string, v: SceneNodeLike): void {
  (m.get(k) ?? m.set(k, []).get(k)!).push(v);
}
