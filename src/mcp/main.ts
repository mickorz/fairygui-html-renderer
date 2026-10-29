import path from "node:path";
import { createInterface } from "node:readline";
import { toolListComponents, toolLocate, toolRender, toolScreenshot } from "./tools.js";

// fairygui-html-renderer MCP server（阶段 D）
// stdio 传输：换行分隔 JSON-RPC 2.0；实现 initialize / tools/list / tools/call
// 接入：pi mcp add fairygui -- npx tsx src/mcp/main.ts（或 .pi/mcp.json）

const root = path.resolve(process.env.FGUI_PROJECT_ROOT ?? "CC-Default");
const ctx = { rootDir: root };

const TOOLS = [
  {
    name: "list_components",
    description: "列出 FairyGUI 工程的包；传入 package 名时列出该包内的组件清单（id/name/是否导出/相对路径）",
    inputSchema: {
      type: "object",
      properties: { package: { type: "string", description: "包名（可选，缺省列出所有包）" } },
    },
  },
  {
    name: "locate_component",
    description: "按名称/ID/路径在全工程搜索 UI 节点，返回唯一稳定键（key）、可读路径（path）与所在组件；用于定位后再渲染或截图",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "搜索关键词，如 closeButton、n4、BagWin.frame" } },
      required: ["query"],
    },
  },
  {
    name: "render_component",
    description: "按稳定键渲染节点所在组件为 HTML（自带 focus 定位），返回 file:// 预览地址与节点设计坐标信息",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string", description: "locate_component 返回的稳定键 key" } },
      required: ["key"],
    },
  },
  {
    name: "screenshot_component",
    description: "渲染 + Chrome headless 截图，返回 PNG 绝对路径与节点信息；用于视觉验证 UI 定位结果",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "locate_component 返回的稳定键 key" },
        width: { type: "number", description: "视口宽（默认 1280）" },
        height: { type: "number", description: "视口高（默认 800）" },
      },
      required: ["key"],
    },
  },
];

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

function reply(id: RpcMessage["id"], result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function replyError(id: RpcMessage["id"], code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

function callTool(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "list_components":
      return toolListComponents(ctx, { package: args.package as string | undefined });
    case "locate_component":
      return toolLocate(ctx, { query: String(args.query ?? "") });
    case "render_component":
      return toolRender(ctx, { key: String(args.key ?? "") });
    case "screenshot_component":
      return toolScreenshot(ctx, {
        key: String(args.key ?? ""),
        width: args.width !== undefined ? Number(args.width) : undefined,
        height: args.height !== undefined ? Number(args.height) : undefined,
      });
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

function handle(msg: RpcMessage): void {
  const { id, method, params } = msg;
  if (!method) return;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fairygui-html-renderer", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
      return; // 通知不回复
    case "tools/list":
      reply(id, { tools: TOOLS });
      return;
    case "tools/call": {
      const name = params?.name ?? "";
      try {
        const result = callTool(name, params?.arguments ?? {});
        reply(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (err) {
        reply(id, {
          content: [{ type: "text", text: String((err as Error)?.message ?? err) }],
          isError: true,
        });
      }
      return;
    }
    default:
      if (id !== undefined) replyError(id, -32601, `方法不存在: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg: RpcMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // 非法行忽略
  }
  handle(msg);
});
rl.on("close", () => process.exit(0));
