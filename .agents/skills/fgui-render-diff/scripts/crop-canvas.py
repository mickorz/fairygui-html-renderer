# 画布精定位裁剪：在编辑器窗口截图中从画布外（均匀舞台区）向内扫描第一个画布底色像素，
# 精确定位画布左上角，按理论尺寸裁出组件画布（1:1 缩放时理论尺寸=组件源尺寸）
# 用法: python crop-canvas.py <win.png> <out.png> <理论宽> <理论高> [粗略x] [粗略y]
import statistics
import sys
from PIL import Image

win_path, out_path = sys.argv[1], sys.argv[2]
TW, TH = int(sys.argv[3]), int(sys.argv[4])
hint_x, hint_y = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (620, 280)

img = Image.open(win_path).convert("RGB")
W, H = img.size
px = img.load()

def diff(a, b):
    return abs(a[0]-b[0]) + abs(a[1]-b[1]) + abs(a[2]-b[2])

# 画布底色与舞台色：从画布中心与画布左外采样
cx, cy = hint_x + TW // 2, hint_y + TH // 2
canvas_px = px[min(cx, W-1), min(cy, H-1)]
stage_px = px[max(hint_x - 80, 0), min(cy, H-1)]
print("canvas color:", canvas_px, "stage color:", stage_px)

def is_canvas(c):
    return diff(c, canvas_px) < 60

def is_stage(c):
    return diff(c, stage_px) < 60

if not is_canvas(canvas_px) or diff(canvas_px, stage_px) < 60:
    sys.exit("[失败] 画布底色与舞台背景对比不足，粗定位可能不对")

# 多线扫描：偏移组，各自扫描后取中位（抗单线内容干扰）
offsets = [-60, -30, 0, 30, 60]

def scan_edge(fixed_from, fixed_to, moving_from, moving_to, axis):
    # axis='x'：沿 x 从 moving_from 向 moving_to 扫（fixed 是 y 值列表）
    # axis='y'：沿 y 扫（fixed 是 x 值列表）
    found = []
    for f in [fixed_from + o for o in offsets]:
        f = min(max(f, 0), (H-1 if axis == 'x' else W-1))
        if not (0 <= f < (H if axis == 'x' else W)):
            continue
        if axis == 'x' and not is_stage(px[moving_from, f]):
            continue  # 起点必须在舞台区（该行画布外区域被面板占据则跳过）
        if axis == "y" and not is_stage(px[f, moving_from]):
            continue
        step = 1 if moving_to > moving_from else -1
        m = moving_from
        while 0 <= m < (W if axis == 'x' else H):
            c = px[m, f] if axis == 'x' else px[f, m]
            if is_canvas(c):
                found.append(m)
                break
            m += step
    if not found:
        return None
    return statistics.median(found)

# 左缘：x 从画布外(舞台区)向右扫，找第一个画布色
x_left = scan_edge(hint_y, hint_y + TH, max(hint_x - 80, 0), hint_x, 'x')
# 上缘：y 从画布外(上方舞台区)向下扫
y_top = scan_edge(hint_x, hint_x + TW, max(hint_y - 80, 0), hint_y, 'y')
# 右缘：x 从右侧外向左扫（右侧是检查器面板非舞台色，起点校验放宽）
x_right = None
xr_found = []
for y in [cy + o for o in offsets]:
    if not (0 <= y < H):
        continue
    x = min(hint_x + TW + 80, W - 1)
    while x > hint_x:
        if is_canvas(px[x, y]):
            xr_found.append(x)
            break
        x -= 1
if xr_found:
    x_right = statistics.median(xr_found)

print("edges: x_left=%s y_top=%s x_right=%s" % (x_left, y_top, x_right))
if x_left is None or y_top is None:
    sys.exit("[失败] 左缘或上缘扫描未命中")

x_left, y_top = int(x_left), int(y_top)
if x_right is not None:
    mw = int(x_right) - x_left + 1
    print("measured width: %d (theory %d)" % (mw, TW))
    if abs(mw - TW) > 12:
        print("[警告] 右缘校验偏差大（%d vs %d，可能被选中框/内容干扰），以左上+理论尺寸为准" % (mw, TW))

crop = img.crop((x_left, y_top, x_left + TW, y_top + TH))
crop.save(out_path)
print("saved %s %dx%d (crop from (%d,%d))" % (out_path, TW, TH, x_left, y_top))
