# 主页与编辑器 UI 与 ZCode 深度一致化方案

日期：2026-11-19 · 状态：已三次自评通过，进入实施

## 0. 背景与目标

以 `/Users/zyh/work/zcode-ref`（ZCode 桌面端，Apache-2.0）为视觉与交互基准，把察元AI Office 的
**主页**（shell renderer `Home`）与**编辑器视图**（左 AI 对话栏 + 右编辑画布）对齐到同一种视觉语言：

1. 左侧树：行高/圆角/hover/选中态、分区头图标钮、展开 chevron、宽度与折叠行为
2. 上方图标：左树折叠开关（PanelLeftClose/Open 形状）等顶部图标形状一致
3. 中间对话框：问候语居中版式 + 圆角卡片输入框（rounded-2xl、0.5px 边框、柔和阴影、focus 描边、圆形发送钮）
4. 新建项目 / 新建文件夹逻辑一致：项目 = 「名称 + 文件夹（内嵌目录浏览）」对话框；文件夹 = 树内联创建
5. 编辑器：左栏对话消息样式（用户气泡右对齐 rounded-xl、助手直排无气泡）与输入框卡片一致
6. 编辑器右侧新增可展开/隐藏的文件栏，样式对齐 zcode-ref 文件树（28px 行、深度缩进、chevron 旋转），
   右上角开关图标（PanelRightClose/PanelRightOpen）与激活态（!bg-selected）一致

**许可**：zcode-ref 为 Apache-2.0，lucide 图标为 ISC；新文件头部注明移植出处即可。

## 1. 约束（上游同步纪律）

- 本仓与上游无共同祖先，逐 cherry-pick 同步；**新文件优先（B 区零冲突）**。
- C/D 区文件（Home.tsx、home.css、TabBar.tsx、各编辑器 App.tsx 等）只允许**一行式挂载点**修改，
  每处带 `// LOCAL(<date>, <base>): <intent>` 四要素标记。
- 颜色铁律：chrome 禁止裸 `#hex`（`tools/check-theme-colors.mjs` 门禁）——新 CSS 全部走
  `packages/ui/src/tokens.css` 既有 token 或 `color-mix()` 派生。
- 本地 i18n 只进 `i18n-local-strings.ts`（B 区）；本地 CSS 全部收进**新文件** `zcode-theme.css`。
- 不引入 Tailwind / lucide-react 依赖：zcode 类名值**翻译**为等价 CSS；图标用内联 SVG 组件。

## 2. 目标侧（zcode-ref）关键实测值（照抄依据）

| 项 | zcode-ref 实测 | 察元侧落点 |
|---|---|---|
| 侧栏默认宽 264px，折叠到 4px，拖拽手柄 hover 竖线 | `WorkspaceShellLayout.tsx:144-146` | `home-layout.ts` SIDEBAR_DEFAULT 232→264（B 区文件） |
| 树行 h-8 rounded-lg hover:bg-surface-hover，激活 bg-selected | `ProjectNodeContent.tsx:232` | `.home .sidebar` 域 CSS |
| 行内 hover 操作钮（Ellipsis/ListTree/MessageCirclePlus）opacity-0→100 | `ProjectNodeContent.tsx:331` | 同上（现有行尾钮统一此行为） |
| New Task 整行钮（MessageCirclePlus + 文案 + hover） | `NewTaskButtonGroup.tsx:17-46` | 新组件 `SidebarNewChatButton` |
| 列表头：标题 + Search/ListFilter size-3.5 ghost 图标 | `ProjectSidebarListHeader.tsx:30-107` | `.sidebar-seg` 重塑为同款头行 |
| 折叠图标 PanelLeftClose/PanelLeftOpen | `DesktopTopOverlay.tsx:80` | `TabBar.tsx` PaneToggleIcon 路径替换（局部函数，低冲突） |
| 草稿居中：顶部 29dvh 弹性留白 + max-w-2xl 输入卡 | `ConversationTimeline.tsx:2057`、`conversationLayout.ts:3` | `.chat-pane` 域 CSS |
| 输入卡 rounded-2xl border-[0.5px] bg-input shadow 柔和 + focus 描边 | `ChatPromptEditor.tsx:424` | `.chat-composer`/`.ai-input-box` 域 CSS |
| 发送钮圆形 bg-brand + ArrowUp | `ChatPromptEditor.tsx:454-471` | `.ai-send-btn` 域 CSS（ArrowUp 图形） |
| 用户气泡 rounded-xl border bg-surface 右对齐 max-w-xl | `ConversationUserInputBubble.tsx:30` | `.chat-bubble.user` / `.ai-msg-user` 域 CSS |
| 文件树行 h-7 rounded-lg 深度缩进 0.75rem/级 + chevron 旋转 90° | `WorkspaceFileTreeRowView.tsx:250-312` | `.files-pane`/`.file-tree` 域 CSS |
| 右栏开关 PanelRightClose/Open，激活 !bg-selected | `WorkspaceSidePaneToggleButton.tsx` | 新组件 `EditorFilesPane` 开关钮 |
| 新建项目对话框：名称 Input + 文件夹行 + 添加文件夹 + 取消/创建 | `ProjectEditor.tsx:400-719` | 新组件 `ProjectCreationDialog`（内嵌目录浏览用 `home:folder-list` IPC） |

## 3. 工作分解

### W1 共享层（packages/ui，全部新文件）
1. `packages/ui/src/zcode-icons.tsx` — 内联 SVG 图标：PanelLeftClose/Open、PanelRightClose/Open、
   MessageCirclePlus、Search、ListFilter、ChevronDown/Right、Ellipsis、Folder/FolderOpen、FolderPlus、
   Pin、Plus、ArrowUp、X、ListTree。路径取自 lucide（ISC）。
2. `packages/ui/src/zcode-theme.css` — 视觉移植总表（分域）：
   - `.home` 域：侧栏行/头钮/分段 Tab/右键钮/FileTreePane 行/resizer/滚动条
   - `.chat-pane` 域：landing 版式 + composer 卡 + 发送钮 + 建议提示行
   - `.ai-panel` 域（六编辑器共用）：消息气泡、composer 卡（与 home 同规则）
   - `.files-pane` 域 + `.editor-side-pane` 域：行样式、edge tab、开关钮、抽屉动画
3. `packages/ui/src/index.ts` barrel 追加导出（1 行，LOCAL 标记）。

### W2 主页（apps/shell/src/renderer/src）
1. 新 `home-zcode/ProjectCreationDialog.tsx`：遮罩 + max-w-lg 卡 + 名称输入（h-9 rounded-lg）+
   内嵌目录浏览器（起始 homedir，`chaOffice.folderList` 列目录；若该 IPC 有根目录守卫则回退
   `chaOfficeProject.pickFolder` 原生选择器——实现时二选一）+ 取消/创建 footer。
   创建走既有 `window.chaOfficeProject.createProject(name, rootPath)`。
2. 新 `home-zcode/SidebarNewChatButton.tsx`：侧栏顶整行「新建对话」钮（MessageCirclePlus），
   直调 `useHomeChatStore` 新建会话。
3. `Home.tsx`（C 区，~5 行 LOCAL）：import ×2；新建项目按钮 onClick 改开新对话框；侧栏顶部挂
   SidebarNewChatButton；尾部 render ProjectCreationDialog。
4. `TabBar.tsx`（C 区）：`PaneToggleIcon` 函数体换 lucide panel-left-close/open 路径（单用途函数，冲突面极小）。
5. `home-layout.ts`（B 区）：SIDEBAR_DEFAULT 232→264。
6. `main.tsx`（C 区）：+1 行 import `@chaoffice/ui/zcode-theme.css`（沿用既有 ui CSS import 模式）。
7. i18n：新串进 `i18n-local-strings.ts`（B 区）。

### W3 编辑器（docs 试点 → 复制）
1. 新 `packages/ui/src/editor-side-pane/EditorFilesPane.tsx`：
   - 组合上游 `<FilesPane>`（桥 `window.filesPaneApi` 已在每个编辑器 preload 在位）
   - 开关钮 SidePaneToggle（PanelRightClose/Open，激活 `--active-bg`），开合态 localStorage 持久化（per app key）
   - 展开态：右侧 264px 抽屉（absolute，border-left，200ms 滑入），压缩式让位通过宿主容器类
     `.has-editor-side-pane` + zcode-theme.css 内各编辑器一条 padding/margin 规则实现
2. docs App.tsx（C 区）：+1 import、容器挂 EditorFilesPane、ribbon trailingActions 前插开关钮（~3 行 LOCAL）。
3. `.ai-panel` 消息样式：`.ai-msg-user` 气泡化、`.ai-msg-assistant` 直排，全部在 zcode-theme.css。

### W4 其余五编辑器
sheets/slides/markdown/pdf/html 各：+1 import、+1 挂载、+1 trailingActions、+1 css import
（每文件 ≤4 行 LOCAL，全部为一行式挂载模式）。

### W5 门禁
`npm run check:theme-colors`、`npm run lint`、`npm run typecheck`（若有）/ tsc -b、
`npm run build:web`（验证 web/dsh 链）、`npm test`（受影响包）。

## 4. 明确不做（范围裁定）

- 不替换 TabBar/窗控结构（产品形态差异：察元多 tab 壳 vs zcode 单任务窗口）
- 不引入 automations/plugin-store 入口（无对应功能；云项目 nav 保持现状仅重塑样式）
- 不替换 WelcomeLanding 产品卡信息架构（仅版式/字号/留白对齐 zcode draft）
- 不动 Home 对话/项目/最近的数据模型与交互逻辑（仅样式一致 + 新建项目对话框换新）
- FileTreePane（B 区本地件）直接重塑其行样式（CSS 层），不改其逻辑

## 5. 真机测试计划

1. `npm run dev` 起 Electron 壳（或 `npm run dev:web` 起 web 宿主）。
2. 主页：截图左树（行高/hover/分段头/新树钮）、拖拽调宽、折叠开关图标形状、中间问候语+输入卡
   （focus 描边/圆形发送钮）、新建项目对话框全流程（命名→选目录→创建→树中出现）、树内新建文件夹。
3. 编辑器：docs 打开 → 左 AI 栏消息气泡样式、输入卡样式；右上角开关钮展开/收起文件栏（图标形状、
   激活态、滑入动画）；树中定位当前文档；六编辑器逐一冒烟。
4. 暗色主题切换复验（新 CSS 全 token 化，自动适配）。

## 6. 三次自评记录

### 自评 R1（范围与一致性缺口）
- 发现缺口①：原方案漏了「右上角展开隐藏图标」的**激活态**（!bg-selected）——已补进 W3 开关钮规格。
- 发现缺口②：新建项目对话框若只走原生 pickFolder，与 zcode-ref「内嵌目录浏览」不一致——已改为
  优先内嵌浏览器（复用 `home:folder-list` IPC），原生选择器仅作 IPC 守卫回退。
- 发现缺口③：`.ai-msg-user` 气泡在 zcode 中有 max-w-xl 上限——已补。
- 裁定：TabBar 图标只换 PaneToggleIcon 函数体（唯一调用点 L536），不做 CSS mask hack（脆弱）。

### 自评 R2（上游冲突安全）
- Home.tsx 改动收敛为 5 行（2 import + 1 onClick + 1 挂载 + 1 render），全部可带 LOCAL 标记；
  与上游 Home.tsx 演进冲突面：下游合并时这些行是追加式冲突，裁决成本最低。
- TabBar.tsx PaneToggleIcon 函数体替换是唯一「替换式」改动；若上游改该函数，冲突二选一，
  可接受（函数 20 行、单一用途）。
- 六编辑器 App.tsx 各 ≤4 行追加式改动；新组件/CSS/i18n 全部新文件 → 上游同步零冲突。
- `home-layout.ts` 是本地 B 区文件（中文注释、ZCode 式注释已在），改默认值安全；
  宽度经 setTreeWidth IPC 同步主进程 contentBounds，编辑器 inset 自动跟随。

### 自评 R3（可行性与顺序）
- 风险①：`home:folder-list` 可能限制在 folderRoots 内 → 方案已带回退路径（pickFolder）。
- 风险②：六编辑器 DOM 结构不一，压缩式让位的宿主规则要逐个写 → 降级策略：先 docs 试点跑通
  `.has-editor-side-pane` 模式，其余编辑器若结构不允许压缩则该编辑器退化为覆盖抽屉（样式仍一致）。
- 风险③：`.ai-panel`/`.chat-*` 既有 CSS 特异性——zcode-theme.css 后加载 + 同特异性覆盖即可，
  避免!important 军备竞赛；个别顽固处允许一条 `!important` 并注明原因。
- 顺序裁定：W1→W2→W3→W4→W5；每步 typecheck 再前进；审查后真机。

**结论：三轮自评全部通过，按第 3 节实施。**

## 7. 变更记录（追加）

- 2026-11-19 用户令：**编辑器右侧文件栏暂时隐藏**——六编辑器（docs/sheets/slides/pdf/html/markdown）
  的 `EditorFilesPane`/`SidePaneToggleButton` 挂载与引用全部摘除；组件本体（B 区）、preload 桥、
  CSS 引入全部保留休眠。恢复 = 各 App 重新加回 import + state + 挂载行（本文件第 3 节有完整清单）。
