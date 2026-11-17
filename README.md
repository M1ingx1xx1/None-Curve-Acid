# None-Curve Acid

一个独立的小网站：画布上用底层字体 **A** 排一段文字，用鼠标笔刷涂抹，笔刷碰到的地方字形逐点插值成 **字体 B**（None-Curve 导出的 TTF），同时带上酸洗（acid wash）式的荧光流动渐变、辉光和笔刷边缘的彩色晕弧。它和 None-Curve 完全分开，不含 NC 的任何其他功能。

> 目前还没有 None-Curve 导出的示例 TTF，所以默认用两款 Google Fonts 做测试：A = Roboto，B = STIX Two Text（都在 `public/fonts/`，SIL OFL 授权，许可证在同目录）。拿到 NC 的 TTF 后，在 Fonts → B 里点 **File** 上传即可。

## 本地运行

需要 Node 22+。

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run lint       # ESLint
npm run typecheck  # tsc（src 与 tests）
npm run build      # typecheck + 生产构建到 dist/
```

## 怎么用

- **Fonts**：B 是必填（上传 TTF / OTF / WOFF / WOFF2，或选 Google Fonts / 内置字体）；A 同理。上传的字体不会保存，刷新后回到上次的内置或 Google 字体。
- **Brush**：模式 Hold（保持到 Clear）/ Decay（按衰减时间和曲线淡出）/ Follow（悬停即画，笔刷用弹簧跟随指针）/ Auto（自动沿直线来回扫）。Hold、Decay 需要按住拖动。半径、硬度、晕开（Bleed）、颜色额外宽度（Colour reach）、边缘不规则、强度。Auto：设起点（Start X / Y）和角度（8 个方向快捷键 + 0–360° 滑杆，0° 从左到右，90° 从下到上）、速度；笔刷从起点沿角度走到对面边缘外一个半径处，再原路返回，往复循环，轨迹按 Fade time / Fade curve 淡出；鼠标一动就接管，停下 1.5 秒后交还。
- **Morph**：A→B 过渡带宽度、形变上限（0.5 = 最多到 A、B 的平均形状）、形变曲线、「按整字插值」对比开关、填充规则（nonzero / even-odd）。
- **Acid**：色标（拖动位置、点条添加、选中改色或删除、反转）、4 组预设、Gradient Slant（0/45/90/135/180 快捷 + 滑杆）、流速、噪声、辉光、字外溢出（Spill，0 = 只在字内着色）。
- **Canvas**：4:5 / 1:1 / 9:16 / 16:9 / 自定义，输出高度；墨色、背景色、透明底。画布内部分辨率就是输出分辨率，预览只是缩放显示。
- **录制与导出**：顶栏 Record 点一下开始、再点停止，录多长导出多长（按帧时钟取样，见下）。默认 MP4，浏览器写不了 MP4 时退回 WebM。透明底时会提示 MP4 不支持透明，可选「Keep transparency」录 WebM（VP9 带 alpha），否则 MP4 录制期间铺上背景色。PNG 导出当前帧，透明底时 PNG 也透明。
- **设置**：自动保存在浏览器（localStorage）；Export / Import settings 导出导入 JSON；Reset all 一键重置。

## 实现概要

| 部分 | 文件 |
|---|---|
| A、B 排版与配对（只在字体 / 文字 / 排版参数变化时重算，按字形对缓存） | `src/acid/scene.ts` |
| 锚点配对（A、B 锚点数不同时互相补点） | `src/morph/pair.ts` |
| 每帧逐锚点插值：`位置 = A + t·(B − A)`，t 在锚点的 A 位置采样 mask | `src/acid/scene.ts` `morphGlyph` |
| 笔刷硬度曲线、A→B 过渡带、形变曲线、形变上限 | `src/acid/brush.ts` |
| 低分辨率 mask（morph / color 两通道），保持 / 衰减，脏矩形 | `src/acid/mask.ts` |
| WebGL2：stencil 填充（nonzero / even-odd）→ 4× MSAA 覆盖率；1/4 尺寸辉光模糊；一个合成着色器完成墨色、酸洗渐变（域扭曲噪声、流动、色斑）、字内辉光、字外光晕 | `src/acid/renderer.ts` |
| 每帧调度：笔刷（指针 / 弹簧 / 自动路径）、mask 衰减、只重算 mask 变化区域内的字 | `src/acid/engine.ts` |
| 录制（WebCodecs + Mediabunny） | `src/export/videoEncode.ts` |
| 设置模型、校验、持久化 | `src/state/settings.ts`, `src/state/persist.ts` |

几点说明：

- 字不会被放大：B 按 A 的 em 等比放在 A 的字宽中央，只有锚点在 A、B 两个轮廓之间移动。
- 颜色与形变用同一个 mask 的两个通道：color 通道半径是 morph 的 `1 + Colour reach` 倍，所以色晕比形变范围宽一点。边缘噪声固定在画布坐标上，重叠的笔触边缘一致。
- 变体字体（如 Roboto）的轮廓没有合并，字怀可能由两个重叠轮廓围成。NC 的 `attachPairs` 会让 B 的字怀贴着 A 的边长出来，在这种字体上 t = 0 时会把 A 的字怀填黑。这里加了 `flatAt`：贴附端不是"扁的"（面积超过自身 5%）时改为从中心点长出 / 缩回。`tests/morph.test.ts` 用 nonzero 绕数在网格上逐点验证 t = 0 恰好是 A、t = 1 恰好是 B。
- 录制按帧时钟取样：每帧画完立即抓取，时间戳是它所在的 tick，持续到下一个样本；编码器跟不上时跳过 tick、前一个样本自动拉长。实测 2.0 s / 3.18 s / 2.51 s 的录制解码时长分别为 2.000 / 3.167 / 2.500 s（按帧取整）。
- 性能：1080×1350 下每帧（含 GPU 同步）平均 5–13 ms，1728×2160 约 5 ms；预览目标 60 fps，录制 30 / 60 fps 可选。

## 从 None-Curve 复制的代码

来源：`None-Curve`（同一作者的仓库）。下表列出来源文件和改动。

| 本仓库 | None-Curve 来源 | 改动 |
|---|---|---|
| `src/morph/pair.ts` | `src/specimen/morph.ts`（`planMorph`、`ringOf`、`pointAt`、`sideAt`、`bestShift`、`inOrder`、`Pairs`、`directPairs`、`unionPairs`、`pairContours`、`reversed`、`windsClockwise`、`closestOn`、`attachPairs`、`MORPH_LIMITS`） | 只保留直线轨迹 + `'nearest'` 对应（即 `src/specimen/trajectory.ts` 的 `STRAIGHT`）；去掉 Whorl 网格、glideOutline、plan data、中间态 settle；新增 `flatAt` |
| `src/morph/types.ts` | `src/geometry/types.ts` | 只取 `Point`、`PolygonContour`、`PolygonGlyph` 的最小子集 |
| （不需要） | `src/specimen/glide.ts`、`src/specimen/trajectory.ts` | glide 的"按时间整体推进"由逐锚点 t 取代；trajectory 只用到 `STRAIGHT` 的 `'nearest'`，已内联进 `pair.ts` |
| `src/acid/easing.ts` | `src/acid/easing.ts` | 原样 |
| `src/acid/gradient.ts` | `src/acid/gradient.ts` | 色标带位置（原版等距） |
| `src/acid/motion.ts` | `src/acid/motion.ts`（`Spring2`） | 新增 Auto 模式的往复直线路径 `sweepPath` |
| `src/font/errors.ts`, `src/font/googleUrl.ts` | 同名文件 | 原样 |
| `src/font/sniff.ts` | 同名文件 | `FontFormat` 类型内联 |
| `src/font/google.ts` | 同名文件 | "All" 子集只加载主子集（latin），不做多子集合并 |
| `src/font/parse.ts` | `src/font/parse.ts` | 大幅裁剪：单字体，不含 SVG、子集包、collection 选择、自带 kerning（用 fontkit layout 的 kerning） |
| `src/components/GoogleFontsDialog.tsx`, `src/components/Icon.tsx` | 同名文件 | 对话框文案小改 |
| `src/export/download.ts` | 同名文件 | 原样 |
| `src/export/videoEncode.ts` | `src/export/videoEncode.ts`、`src/export/videoFormat.ts` | 保留编码器选择、MP4→WebM 回退、VP9 alpha、码率；换成实时录制（帧时钟取样），去掉离线声音渲染 |
| `src/styles.css` 前半部分 | `src/styles.css` | 颜色变量、基础控件、group / field / switch / segmented、按钮、字体提示、Google Fonts 对话框；后半部分布局是本工具自己的 |
| `eslint.config.js`, `tsconfig*.json`, `.prettierrc.json` | 同名文件 | 原样 |
| `public/fonts/*` | `tests/fixtures/fonts/*` | Roboto、STIX Two Text 及其 OFL 许可证 |

没有复制：`src/export/png.ts`（NC 从 SVG 栅格化；这里直接用 WebGL 画布 `toBlob`）、`src/export/recorder.ts` 和 `AcidRecord.tsx` / `RecordControls.tsx`（依赖 NC 的声音引擎和 MediaRecorder；录制按钮在顶栏重写）。

## 已知限制

- 上传的本地字体不会持久化（只记住内置 / Google 字体选择）。
- WOFF2 的变体字体，fontkit 无法实例化到指定字重，会用默认实例（Google 通常会给静态字重文件，影响不大）。
- 文字逐字形配对，关闭了连字（liga / clig / calt），以保证 A、B 字符一一对应。
