# PPT 图像来源与三端不登录生成 · 立项共识（v1）

> 状态：共识已达成（2026-09-06，8 轮逐题收敛），本文为实施合同。
> 里程碑：M-A slides 主体 → M-B docs/sheets 兜底 → M-C 验收回归，各自全绿后推送。
>
> **实施状态（2026-09-07 收口）**：
> - M-A slides 主体 ✅（commit 23d51b8：五值设置/来源解析分配/imagery 分支/三态 spec/消毒光栅化/选择器+本地池/IPC，31 新测试）。
> - M-B docs/sheets 兜底 ✅（commit 24bfc9d 落 generate_svg 双端+web 回退+svg-bank dataref；本 commit 补齐 #9「复用全局默认」：docs docs-skill/imageSkill 读 `AiSettingsV2.imageSource`——显式 web/model/svg 在两端系统提示词加指令行并约束 generate_image 失败回退链（svg 默认跳过 web 档，绝不静默换源），local/auto 不加指令（交互场景无本地池概念，按 auto 行为）；口头改源=模型按用户措辞在三工具间选择+generate_deck 的 image_source 参数即存默认）。
> - M-C 验收回归 ✅：模型源欠费失败→briefs 降级+报告标注+不切 web、本地池不足→briefs+标注、svg 模式全 briefs+模式标注、image_source 口头改源即存默认 等集成测试补齐（generate-deck +5）；docs web 回退/svg 跳过/generate_svg 三分支（+6）+docs-skill 指令行（+2）、sheets 回退链/指令行（+5）；全量回归 agent-core 80 / ai-provider 182 / ai-search 60 / pptx-render 244 / ui 79 / slides 642+8skip / docs 1425 / sheets 1986 全绿（sheets 另有 15 个 xlsx Rust sidecar 用例因本机无 cargo 未构建原生二进制而失败，stash 验证在 HEAD 同样失败，属环境缺口非代码回归）；slides/docs/sheets 三 app tsc 无错误。断网+单对话模型的真机验收仍需人工跑（口径见 §M-C）。

## 0. 一句话总纲

PPT 整份生成的配图来源显式化为**网络 / 模型 / 本地 / 矢量图形(SVG) / 自动**五值（全局默认 + 生成时按次覆盖），任何来源失败统一落 SVG 兜底；SVG 按**语义单元级**最小单元由页面写手内联生成、每个元素独立可编辑；三端（slides/docs/sheets）未登录配图全部可用——断登录 + 只配一个对话模型即可完成含配图的整份生成。

## 1. 背景（前情 Arrearage 事件）

- 用户以 deepseek 对话模型生成 PPT，逐页报阿里百炼 `Arrearage`（欠费）HTTP 400。根因：AI 设置的 `qc/image/video` 角色及（当时的）generation 角色解析到欠费的 aliyun-bailian 配置；管线对"图像从哪来"没有显式概念，隐形依赖配置角色。
- 本期把图像来源显式化后该依赖消除；`qc/image/video` 角色指向欠费账户属用户侧配置问题，与代码无关（提醒自查）。
- 摸底三事实：① `generate_svg` 工具不要求登录（gate 的只有 `generate_image`/`analyze_media`，slides-skill.ts GSK_ONLY_TOOLS）；② 本地页面 spec 只接受 `http(s)` 图片 URL（page-spec.ts，非 http 丢弃）；③ 生成 PPT 无独立表单，入口是 AI 对话流。

## 2. 已共识的决定（编号引用）

| # | 决定 | 内容 |
|---|---|---|
| 1 | 入口与粒度 | **全局设置存默认值 + 生成时按次覆盖**（两层并存） |
| 2 | 选项集 | **网络 / 模型 / 本地 / 矢量图形(SVG) / 自动** 五值；"自动"= 有已配置图像模型→模型，否则→网络，再否则→SVG；**本地不参与自动链**（没人选文件夹就没有池子） |
| 3 | 失败降级 | 任何显式来源失败/零结果 → **统一落 SVG**；SVG 也失败 → 无图排版（现有 fail-open）；**绝不静默切到另一个可能花钱的来源**；降级原因写进生成报告（如"第 3 页：图像模型欠费，已用矢量图形兜底"） |
| 4 | 最小单元 | **语义单元级**：每个 SVG = 一个独立视觉单元（图标/图示组件/装饰块），一页 2–8 个（写手内联上限 6），各自可选中/移动/改色/删除；SVG 内部不拆 path；网络照片/模型 PNG/本地图 = 一图一元素 |
| 5 | SVG 生成位置 | **页面 spec 写手内联**（generatePageLocal 同一次调用，提示词按来源分支）；每页 ≤6 个、单个 ≤1.5k 字符；坏 SVG 按元素校验丢弃，不连累整页 |
| 6 | 数据通道 | spec 图像元素扩展为 `url` 或内联载荷（`svg` / `dataUri`）二选一；build 层字节直通 pptx-engine `addPicture`，SVG 走已验证的 SVG+PNG 双 part 通道；配套：SVG 消毒（剥脚本/外链）+ PNG 限分辨率 |
| 7 | 本地交互 | **选文件夹 → 扫描 → 缩略图预览确认（默认全选可勾掉）→ 图片池按槽位自动分配**（够用优先、多余忽略、不足槽位落 SVG） |
| 8 | 覆盖持久化 | **覆盖即更新全局默认**（上次使用优先），设置窗口随之刷新 |
| 9 | 不登录边界 | 核心生成本就 BYOK 零登录；本期把来源策略复制到 **docs/sheets 插图路径**（未登录时 `generate_image` 的位置由 网络/本地/SVG 兜底，复用全局默认，对话可口头改源）；云工具仍为登录增值 |

## 3. 派生默认细则（无异议即按此执行）

- **"模型"来源接线**：复用现有"默认模型→图像"角色与 `ai:generate-image` BYOK 通路（`runtime.generateImage` 返回 `{url}`），**URL 通路直通**——生成结果按 URL 参与槽位分配与 build 拉取，无需 dataUri；prompt 注入 Style Skill 配色。
- **dataUri 白名单**：`image/png|jpeg|webp|svg+xml`，单元素 ≤ 数 MB（本地照片压缩到长边 ≤2048px）。
- **光栅化选型**：**渲染层复用现有 SVG→PNG 光栅化**（insert-actions 已验证的链路），写手产出的内联 SVG 在渲染层消毒+光栅化后随 spec 传主进程（元素携带 `svg` + `pngDataUri` 双载荷），**不引入 resvg/sharp 新原生依赖**——这是对共识 #6"选型动工时定"的落定。
- **消毒规则**：剥 `<script>`、事件属性（`on*`）、外部引用（`xlink:href`/`src`/`@import`/外部字体），仅保留纯矢量内容；消毒先于光栅化。
- **进度呈现**：每页进度项带实际来源；降级明细进生成完成报告（chat 条目），不新增弹窗。
- **设置存储**：`AiSettingsV2.imageSource?: AiImageSource`（缺省 `'auto'`），随 `ai-settings.json` 持久化；设置窗口"默认模型"页（ModelDefaultsPage）加选择项。
- **网络来源**：沿用现有 `image_search` 通道与跨批去重，不动。
- **规划阶段**：`image_queries` 机制不变（SVG 来源下写手把关键词语义转为内联 SVG 主题）。

## 4. 明确不做（v1）

- 项目素材库（持久化本地图片池）——二期。
- SVG path 级拆解成原生形状。
- 链式降级到"会花钱的来源"（模型失败落网络/本地等）。
- 云工具（analyze_media、云端整页）的 BYOK 等价物。
- 全局默认与按次覆盖的双入口同步提示 UI（覆盖即默认，无需同步提示）。

## 5. 施工清单

### M-A · slides 主体

| # | 文件 | 动什么 |
|---|---|---|
| 1 | `packages/ai-provider/src/settings-v2.ts` | `AiSettingsV2` 加 `imageSource`；类型 `AiImageSource` 导出；迁移兼容 |
| 2 | `packages/ui/src/ModelDefaultsPage.tsx` + `model-settings-strings.ts` | "图片来源"默认项（五值+说明），覆盖即更新默认的回显 |
| 3 | `apps/slides/src/main/slides-main.ts` + `src/preload/index.ts` + `src/shared/ipc.ts` | 新 IPC `slides:scan-image-folder`（格式/尺寸过滤 + 缩略图 base64） |
| 4 | `apps/slides/src/main/page-spec.ts` | 图像元素三态（`url`/`dataUri`/`svg`+`pngDataUri`）校验与 build 字节直通；dataUri 白名单 |
| 5 | `packages/pptx-render/src/svg-sanitize.ts`（新） | SVG 消毒纯函数（M-B 复用） |
| 6 | `apps/slides/src/renderer/ai/slides-skill.ts` | generate_deck 来源解析与分支（web 现状/model 生成/local 池分配/svg 跳搜索+写手分支）；每页来源与降级原因入进度与报告 |
| 7 | `apps/slides/src/renderer/ai/AiPanel.tsx` + 新组件 `ImageSourcePicker.tsx` | 来源选择器（初始=全局默认，变更即保存=覆盖即默认）；本地文件夹扫描+预览确认面板；写手 spec 后处理：内联 SVG 消毒+渲染层光栅化附 `pngDataUri` |
| 8 | i18n `apps/slides/src/renderer/i18n/strings-ai.ts` 等全语言 | 新 key |
| 9 | 测试 `apps/slides/tests/`、`packages/ai-provider/tests/`、`packages/pptx-render/tests/` | source 解析/自动链/降级链/三态 spec 校验/消毒/池分配 |

### M-B · docs/sheets 兜底

| # | 文件 | 动什么 |
|---|---|---|
| 1 | `apps/docs/src/renderer/ai/tools.ts`（`generate_image` :182 附近） | 未登录/云关时兜底链：网络（image_search 现成）→ SVG 插图；读全局默认源，支持对话口头改源 |
| 2 | `apps/sheets/src/renderer/ai/image-skill.ts`（`generate_image` :44 附近） | 同上 |
| 3 | 能力核实 | docs/sheets op 引擎 SVG+PNG 双 part 支持与否；缺失则补齐引擎能力（动工第一天核实） |

### M-C · 验收与回归

- **验收口径**：断开登录 + 只配一个对话模型（deepseek）→ PPT 整份生成（含配图与降级标注）、docs 成文、sheets 建表、三端配图全部可成。
- 降级单测：模型欠费/超时 → 落 SVG → 报告标注；本地池不足 → 落 SVG；坏 SVG → 丢元素不炸页。
- 回归基线：slides / docs / sheets / ai-search / ai-provider / pptx 相关现有测试全绿。

## 6. 前情遗留（与本期无关，提醒）

AI 设置里 `qc/image/video` 三个角色仍指向欠费的 aliyun-bailian 账户，请在设置窗口自行改掉或停用该配置。
