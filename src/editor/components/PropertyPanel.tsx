// 属性面板（Task 4）：Transform / Appearance / Typography / Image 四分节
// 全部 React 受控控件直连 component API（addStyle/addAttributes），不用 GrapesJS StyleManager DOM
import type { Component } from "grapesjs";
import { type ReactElement } from "react";
import { useSelectedComponent } from "../grapes/use-editor";

import { nodeDisplayName } from "../grapes/node-name";

type StyleMap = Record<string, string>;

/** 组件当前内联 style（getStyle） */
function styleOf(cmp: Component): StyleMap {
  return (cmp.getStyle() ?? {}) as StyleMap;
}

/** 提取 px 数值，无则空串 */
function pxNum(style: StyleMap, prop: string): string {
  const v = style[prop];
  if (!v) return "";
  const m = /(-?[\d.]+)/.exec(v);
  return m ? m[1] : "";
}

/** 写入一个样式属性（px 单位）；空值移除该属性 */
function setStyleProp(cmp: Component, prop: string, value: string, unit = "px"): void {
  if (value === "") {
    cmp.removeStyle(prop);
  } else {
    cmp.addStyle({ [prop]: value + unit } as never);
  }
}

/** 提取 rotate 角度数值 */
function rotationOf(style: StyleMap): string {
  const m = /rotate\((-?[\d.]+)deg\)/.exec(style["transform"] ?? "");
  return m ? m[1] : "";
}

// ---------- 小控件 ----------

function NumField({ label, value, onCommit, step = 1 }: { label: string; value: string; onCommit: (v: string) => void; step?: number }): ReactElement {
  return (
    <label className="flex items-center gap-1">
      <span className="w-6 text-[11px] text-[#999]">{label}</span>
      <input
        type="number"
        step={step}
        className="w-16 bg-[#2b2b2b] border border-[#555] rounded px-1 py-0.5 text-xs"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        data-testid={"prop-" + label.toLowerCase()}
      />
    </label>
  );
}

function TextField({ label, value, onCommit, testId, placeholder }: { label: string; value: string; onCommit: (v: string) => void; testId?: string; placeholder?: string }): ReactElement {
  return (
    <label className="flex items-center gap-1 w-full">
      <span className="w-14 shrink-0 text-[11px] text-[#999]">{label}</span>
      <input
        className="flex-1 min-w-0 bg-[#2b2b2b] border border-[#555] rounded px-1 py-0.5 text-xs"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onCommit(e.target.value)}
        {...(testId ? { "data-testid": testId } : {})}
      />
    </label>
  );
}

function SelectField({ label, value, options, onCommit, testId }: { label: string; value: string; options: [string, string][]; onCommit: (v: string) => void; testId?: string }): ReactElement {
  return (
    <label className="flex items-center gap-1">
      <span className="w-14 text-[11px] text-[#999]">{label}</span>
      <select
        className="bg-[#2b2b2b] border border-[#555] rounded px-1 py-0.5 text-xs"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        {...(testId ? { "data-testid": testId } : {})}
      >
        {options.map(([v, name]) => (
          <option key={v} value={v}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): ReactElement {
  return (
    <section className="border-b border-[#3a3a3a] px-2 py-2" data-testid={"section-" + title.toLowerCase()}>
      <h3 className="text-[11px] font-bold text-[#e8b34b] mb-1.5">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </section>
  );
}

// ---------- 文本组件辅助 ----------

/** 直接文本内容（content 属性或 textnode 子组件拼接） */
function directText(cmp: Component): string {
  const content = (cmp.get("content") as string | undefined) ?? "";
  if (content) return content;
  let out = "";
  cmp.components().forEach((k: Component) => {
    if (k.get("type") === "textnode") out += (k.get("content") as string | undefined) ?? "";
  });
  return out;
}

/** 写文本：优先 textnode 子组件，其次 content 属性 */
function setText(cmp: Component, v: string): void {
  const tn = cmp.components().filter((k: Component) => k.get("type") === "textnode")[0] as Component | undefined;
  if (tn) {
    // textnode 视图对 change:content 的 updateContent 无效（Text 节点无 innerHTML），
    // 需 trigger rerender 重建视图（源码 ComponentView.ts:75 change:script rerender -> reset）
    tn.set("content", v);
    tn.trigger("rerender");
  } else {
    cmp.set("content", v);
  }
}

/** 是否展示 Typography 分节：有直接文本的组件（text 类型或含 textnode/内容） */
function isTextual(cmp: Component): boolean {
  if (cmp.get("type") === "text") return true;
  if ((cmp.get("content") as string | undefined)) return true;
  return cmp.components().some((k: Component) => k.get("type") === "textnode");
}

// ---------- 主面板 ----------

export default function PropertyPanel(): ReactElement {
  const cmp = useSelectedComponent();

  if (!cmp) {
    return (
      <div className="h-full overflow-auto" data-testid="prop-panel">
        <div className="p-3 text-xs text-[#888]">未选中组件（点击画布或图层树选择）</div>
      </div>
    );
  }

  const style = styleOf(cmp);
  const isImage = cmp.get("type") === "image";
  const attrs = cmp.getAttributes() as Record<string, string | undefined>;
  const textAlignCurrent = style["text-align"] || "left";

  return (
    <div className="h-full overflow-auto" data-testid="prop-panel" data-cmp-id={cmp.getId()}>
      <div className="px-2 py-1.5 text-xs font-bold border-b border-[#3a3a3a] truncate" title={nodeDisplayName(cmp)}>
        {nodeDisplayName(cmp)}
        <span className="ml-1 font-normal text-[#777]">{cmp.get("tagName")}</span>
      </div>

      <Section title="Transform">
        <NumField label="x" value={pxNum(style, "left")} onCommit={(v) => setStyleProp(cmp, "left", v)} />
        <NumField label="y" value={pxNum(style, "top")} onCommit={(v) => setStyleProp(cmp, "top", v)} />
        <NumField label="w" value={pxNum(style, "width")} onCommit={(v) => setStyleProp(cmp, "width", v)} />
        <NumField label="h" value={pxNum(style, "height")} onCommit={(v) => setStyleProp(cmp, "height", v)} />
        <NumField label="rot" value={rotationOf(style)} onCommit={(v) => setStyleProp(cmp, "transform", v, "deg")} />
      </Section>

      <Section title="Appearance">
        <NumField label="opacity" value={pxNum(style, "opacity")} step={0.1} onCommit={(v) => setStyleProp(cmp, "opacity", v, "")} />
        <TextField label="背景色" value={style["background-color"] ?? ""} onCommit={(v) => setStyleProp(cmp, "background-color", v, "")} testId="prop-bg" />
        <TextField label="边框色" value={style["border-color"] ?? ""} onCommit={(v) => setStyleProp(cmp, "border-color", v, "")} testId="prop-border-color" />
        <NumField label="边框宽" value={pxNum(style, "border-width")} onCommit={(v) => setStyleProp(cmp, "border-width", v)} />
        <NumField label="圆角" value={pxNum(style, "border-radius")} onCommit={(v) => setStyleProp(cmp, "border-radius", v)} />
      </Section>

      {isTextual(cmp) && (
        <Section title="Typography">
          <TextField label="内容" value={directText(cmp)} onCommit={(v) => setText(cmp, v)} testId="prop-text" placeholder="文本内容" />
          <NumField label="fontsize" value={pxNum(style, "font-size")} onCommit={(v) => setStyleProp(cmp, "font-size", v)} />
          <TextField label="颜色" value={style["color"] ?? ""} onCommit={(v) => setStyleProp(cmp, "color", v, "")} testId="prop-color" />
          <SelectField
            label="字重"
            value={style["font-weight"] || "400"}
            options={[["100", "100"], ["300", "300"], ["400", "400"], ["500", "500"], ["700", "700"], ["900", "900"]]}
            onCommit={(v) => setStyleProp(cmp, "font-weight", v, "")}
          />
          <SelectField
            label="对齐"
            value={textAlignCurrent}
            options={[["left", "左"], ["center", "中"], ["right", "右"]]}
            onCommit={(v) => setStyleProp(cmp, "text-align", v, "")}
          />
          <NumField label="行高" value={pxNum(style, "line-height")} onCommit={(v) => setStyleProp(cmp, "line-height", v)} />
        </Section>
      )}

      {isImage && (
        <Section title="Image">
          {/* image 组件 src 规范写路径是 set('src')（触发 change:src -> updateSrc -> addAttributes 同步）；
              直接 addAttributes 会被 getAttrToHTML 的 getSrcResult() 覆盖回旧值（ComponentImage.ts:89） */}
          <TextField label="src" value={attrs["src"] ?? ""} onCommit={(v) => cmp.set("src", v)} testId="prop-src" placeholder="资源相对路径" />
          <div className="w-full">
            {/* 预览：相对路径按当前页面 URL 解析；Task 5 接 asset 路由 + iframe base href 后命中会话资源 */}
            {attrs["src"] ? (
              <img src={attrs["src"]} alt="预览" className="max-h-24 rounded border border-[#444] bg-[#222]" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            ) : null}
          </div>
        </Section>
      )}
    </div>
  );
}
