import type { ParsedComponent, ParsedNode, Gear } from "../parser/component-parser.js";
import type { Geo } from "./types.js";

// gear 处理：gearDisplay 可见性 / gearXY / gearSize / gearColor 默认页取值

/** gear 默认页取值（xy/size）：selected 页在 gear.pages 中且有值（非 "-"）时用页值，否则用 default */
function applyGear(gear: Gear, comp: ParsedComponent, geo: Geo): void {
  const ctrl = comp.controllers.find((c) => c.name === gear.controller);
  if (!ctrl) return;
  // 在 gear 自己的 pages 中找当前选中页（gear.pages 与 controller.pageIds 布局可能不同）
  const idx = gear.pages.indexOf(ctrl.selected);
  let value = gear.default;
  if (idx >= 0 && gear.values && gear.values[idx] && gear.values[idx] !== "-") {
    value = gear.values[idx];
  }
  if (!value || value === "-") return;
  const pair = value.split(",").map(Number);
  if (gear.kind === "xy") geo.xy = [pair[0] ?? geo.xy[0], pair[1] ?? geo.xy[1]];
  else if (gear.kind === "size" && pair.length === 2 && !Number.isNaN(pair[0])) geo.size = [pair[0], pair[1]];
}

/** 取 gear 当前选中页的值：在 gear 自己的 pages 中找选中页，"-" 或无匹配用 default；无实质值返回 null */
export function pickGearValue(gear: Gear, ctrl: { pageIds: string[]; selected: string } | undefined): string | null {
  if (!ctrl) return null;
  const idx = gear.pages.indexOf(ctrl.selected);
  let value = gear.default;
  if (idx >= 0 && gear.values && gear.values[idx] && gear.values[idx] !== "-") value = gear.values[idx];
  if (!value || value === "-") return null;
  return value;
}

/** 计算 gearDisplay 可见性与 gearXY/gearSize/gearColor 默认页取值 */
export function resolveGear(node: ParsedNode, comp: ParsedComponent): { hidden: boolean; geo: Geo; colorOverride?: string } {
  const geo: Geo = { xy: node.xy, size: node.size };
  let hidden = false;
  let colorOverride: string | undefined;
  for (const gear of node.gears) {
    const ctrl = comp.controllers.find((c) => c.name === gear.controller);
    if (gear.kind === "display") {
      if (ctrl && !gear.pages.includes(ctrl.selected)) hidden = true;
    } else if (gear.kind === "color") {
      // 页值格式 "color,stroke"；取 color 段。有实值时覆盖节点颜色
      const value = pickGearValue(gear, ctrl);
      if (value) colorOverride = value.split(",")[0] || undefined;
    } else {
      applyGear(gear, comp, geo);
    }
  }
  return { hidden, geo, colorOverride };
}
