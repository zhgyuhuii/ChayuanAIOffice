# 上游共存与低冲突开发制度（upstream-coexistence）

> 目的：在与 genoffice 上游保持同步的同时，让本地功能开发**尽量不产生冲突**。
> 本文是约束本地开发方式 + 指导冲突裁决 + 存量重构路线的**唯一制度文件**；
> 合并作业 SOP 与台账见 `docs/upstream-sync.md`，本文与其配套使用。
> 依据：第一至第八轮合并（2026-09-07 → 09-16，累计 ~130 个上游提交、5 次快照巨件）的真实冲突数据。

---

## 1. 冲突解剖：八轮数据的规律

对 `70e5149..09485f8`（上游 630 个改动文件）与本地同期改动求交，得出 **195 个"双修热点文件"**，按冲突成本分三类：

| 类别 | 占比/代表 | 冲突特征 | 结论 |
|---|---|---|---|
| **i18n 词条文件** | 热点里约 80+ 个（`i18n/ai|app/*.ts`、`strings.ts` 内联表） | 每轮必炸、块数最大（单文件 90 块）、机械但量大；品牌值替换还会和词条改动叠加 | **结构性解决**：本地词条与上游词条物理分离（见 §3.1） |
| **应用壳层文件** | `Home.tsx`、各 app `App.tsx`、`ExcelShell`、`Ribbon`、`SettingsModal`、shell `index.ts`、`styles.css`/`home.css` | 双方都在同一函数/同一段 JSX 里加东西，hunk 级绞杀， union 拼接易断 JSX/括号 | **克制进入**：本地功能尽量以新组件挂载，不往壳层里写实现（见 §3.2/§3.3） |
| **共享 API/类型文件** | `home-api.ts`、`desktop-api.ts`、`shared/ipc.ts`、`tools.ts` | 多为"双方各加各的"——导入表/接口成员/通道名并集即可，偶有截断 | 低危，并集模板化处理（见 §4.2） |

**零冲突区（已验证）**：
- 上游独占的引擎层小修（`docx-engine`、`pdf2docx`、`pptx-engine` 解析/写入、`file-parse`）——**七轮全部干净 pick**，上游 CI 保护着这些文件，本地别去碰它们就永远不冲突；
- **本地新建文件**（330 个）：`mcp/*`、`files-pane`、`image-viewer`、`linkup.ts`、`searxng.ts`、`comment-ops.ts`、`page-setup.ts`……上游根本没有这些路径，**冲突数为 0**。
- 数据结论：**冲突集中度极高**——195/630 的热点文件贡献了 95% 以上的冲突工作量，其中 i18n + 六个壳层文件又占热点冲突的 70%+。把这两类结构性地从"上游文件"里搬出去，冲突量级会塌缩一个数量级。

---

## 2. 分区模型：每个文件都属于四区之一

| 区 | 定义 | 同步策略 |
|---|---|---|
| **A 区·上游独占** | 上游有、本地无改动（引擎、解析器、CLI 内部、测试） | 永远取上游。本地不在此区开发。 |
| **B 区·本地独占** | 上游没有的路径（本地新功能文件） | 上游永远不碰。自由演进，零同步成本。 |
| **C 区·接缝文件** | 双方都要改的共享文件（API 类型、i18n、壳层挂载点、package.json） | 冲突主战场。用 §3 的模式把"改动量"压到最小、最机械。 |
| **D 区·本地改写区** | 本地对上游文件做了实质改写（动画引擎 WPS 批次、保存管线、DockShell） | 每轮同步的裁决重灾区。必须登记（§5），逐个判断上游是否已用别的方式实现了同意图。 |

**开发前先问：我这个改动会让哪个文件进入 C/D 区？** 能不能让它落在 B 区？

---

## 3. 本地开发五条军规（面向未来）

### 3.1 i18n：本地词条物理分离，绝不改上游 shard

**现状痛点**：本地键散在 40+ 个上游 shard 里，每轮同步 = 上游 shard 更新 × 本地键保全的双向纠缠（第八轮仅 docs ai shards 就补回 733 键）。

**制度**：
1. **本地新词条一律进独立文件**：每 app 建 `src/renderer/i18n/local/<app>-local.ts`（或 `strings-local.ts`），导出 `localStrings`（结构同上游 shard，20 语言或至少 zh/en+回退）。
2. **挂载用运行时合并，不用改文件**：在 locale 装配处做一层深 spread——
   ```ts
   import { strings } from './strings'            // 上游文件，保持上游原样
   import { localStrings } from './local/local'   // 本地文件，B 区
   export const stringsMerged = deepMergeStrings(strings, localStrings)
   ```
   上游更新 shard → git 干净合并；本地加键 → 只写自己的文件。**两区永不相遇。**
3. **存量迁移**：（**shell 已完成试点** 2026-09-16：280 键×20 语言→`i18n-local-strings.ts`，470 测试绿；工具 `tools/extract-local-i18n.mjs`；其余 app 逐个迁移）`strings.ts`/各 shard 里凡由本地功能引入的键（`feedback*`、`mcpMg*`、`secNew`、`brandName`、`welcome*`、`tabCtx*` 等，清单见台账 §8）分批迁去 local 文件；迁一个删一个。
4. zh/zh-TW 与其他语言的品牌值差异在 local 文件内直接写死正确值（察元AIOffice / ChaAI Office），不再依赖全库替换。

### 3.2 品牌：显示名收敛到一个模块

**现状痛点**：品牌串散布 1000+ 处，上游每次把 `ChaAI Office` 写进新文件，我们就得逐处替换（第八轮 70+ 处/次）；替换脚本还两次误伤 `t('...')` 键引用。

**制度**：
1. 新建 `packages/ui/src/brand.ts`（B 区）：
   ```ts
   export const BRAND = { zh: '察元AIOffice', intl: 'ChaAI Office', id: 'chaoffice' } as const
   export function brandName(lang: string): string { ... }
   ```
2. **上游新文件带来的品牌串**：同步时照常机械映射（一次性），但**本地新写的用户可见文案一律用 `brandName(lang)`**，不再手写品牌串。
3. 豁免清单不变：`@chatoffice/*`、`window.chatOffice`、字体族名、`GENOFFICE_*`、`genspark.ai`、CLI bin 名（台账 §9）。

### 3.3 壳层挂载点：功能实现进组件，壳层只留一行挂钩

**现状痛点**：`Home.tsx` 26 块冲突、`ExcelShell` 4 块 130+ 行绞杀，都是因为功能实现（树、二维码、新建分组、折叠选区拾取）直接写进了上游同款壳层文件。

**制度**：
1. **每个 app 建立唯一挂载文件** `src/renderer/local-mounts.tsx`（B 区）：本地组件在这里统一声明与布线。
2. 壳层文件（`App.tsx`/`Home.tsx`/`ExcelShell.tsx`）里只允许出现**单行引用**：
   ```tsx
   {localMounts.homeSidebarExtra()}   // LOCAL: 本地侧栏扩展（文件树/二维码/新建组）
   ```
   同步冲突时，这种单行 hunk 一眼可解（两边都要/取一边都不伤实现）。
3. 新功能默认形态排序：**独立路由/标签页 > 独立面板组件 > 单行挂载 > 壳内实现（禁止）**。
4. 与上游同名 UI 的扩展（如 Ribbon 加按钮）：上游若已有 `trailingActions`/`actionsRef` 类扩展位则必须走扩展位；没有的，登记到 §6 重构清单（向上游形态对齐的扩展位抽取）。

### 3.4 CSS：本地样式进独立文件

`styles.css`/`home.css` 是巨型单文件，双方追加即冲突。制度：
1. 本地组件样式写进组件同目录的 `*.css` 并由组件 import（Vite 自动打包），或每 app 一个 `local.css`（B 区）在 `main.tsx` 最后一行 import。
2. **禁止**再往上游 `styles.css`/`home.css` 追加本地选择器；存量本地段（如 `.editor-col`、`.name-box*`、`.tree-*`、`.proj-*`）迁去 local.css。
3. 好消息：上游新组件已自带独立 css（`files-pane.css`、`image-viewer.css`），此模式与上游方向一致。

### 3.5 依赖与构建文件

1. `package.json`/`package-lock.json`：维持 Q5 例外（永不字面 pick；本地依赖集中在 dependencies 尾部"LOCAL deps"注释段，同步时手工并）。workspace 包名 `@chatoffice/*` 永不回退。
2. `tsconfig`/`vite.config`/`vitest.config` 的 paths/alias：本地新增 alias 集中追加在文件尾部 `// LOCAL aliases` 注释段，同步时只看这一段。

---

## 4. 冲突裁决决策树（Q3 三档的细化，同步时照走）

```
冲突 hunk 落在哪个文件？
├─ A 区（上游独占，本地无标记）      → 取上游（=干净 pick，无需裁决）
├─ B 区（本地独占，上游没有此路径）  → 不可能冲突；出现说明上游新增了同路径 → §5.3 特例裁决
├─ C 区（接缝文件）
│   ├─ 导入表 / 接口成员 / 通道枚举  → 并集模板（两边都留，机械）
│   ├─ i18n                          → §3.1 配方：上游 shard 取新版 + 本地键织回（锚=节 opener 后）
│   └─ 壳层单行挂载点                → 两边都留（本地单行 + 上游新功能行）
└─ D 区（本地改写区）
    → 读双方的"意图"而不是"文本"：
      ①上游意图本地已实现？          → 取本地，记空 pick 对账
      ②上游实现更优/是本地超集？     → 取上游 + 本地增量重放（三方 merge-file），本地测试逐条改编
      ③两套正交意图并存？            → 并集（双方都留），如 animate 引擎变体+direction
      ④语义互斥（如同名函数两种约定）→ 停下，单独问用户（台账 §10 记裁定）
```

**D 区改写登记格式**（写进改写处 + 台账）：
```ts
// LOCAL(2026-09-15, 6f1ec154): WPS 动画批次——variant/rewind 字段与 filter 编码，
// 上游 09485f8 起以 direction/presetXml 实现"方向/逐字保留"同类意图；
// 下次同步先比对上游 presetSubtypeOf 覆盖面，若已覆盖 variant 则可收敛删除此处。
```
要素：时间、基点 commit、改了什么、上游同意图的动向、收敛条件。**有这四要素的 hunk，下次同步 5 分钟裁决；没有的，半天考古。**

---

## 5. 特例与边界

5.1 **上游新增了与本地同路径的文件**（B 区撞车）：以"谁的测试更全/谁被更多处引用"定去留；通常取上游 + 本地增量重放（本地文件若有独有功能，先把独有部分提成本地新文件再取上游）。
5.2 **本地删除了上游文件/导出**（如弃用 genspark 云通道、删 animation-ops）：在台账 §10 记"弃用裁定+理由"；每次同步检查上游是否又把它接进新代码（第八轮即出现 `GskGenerateImageOptions` 残留引用），发现即再剪。
5.3 **本地已弃用的上游功能**：同步时上游对其的新增测试/调用一并拒绝，登记"拒绝清单"，防止逐轮重复剪枝。

---

## 6. 存量梳理与重构路线（对已开发部分的整理）

按"投入产出比"排序的 **C/D 区收缩计划**（每完成一项，该类冲突即从同步成本中消失）：

| 优先级 | 项目 | 消除的冲突类 | 预估规模 |
|---|---|---|---|
| P0 | **i18n 本地键迁移**（§3.1）：把 8 轮积累的本地键从上游 shard/strings.ts 迁入各 app `i18n/local/` | 每轮 ~100 文件冲突 → 0 | 大（键多但机械，可脚本化+key-parity 测试护航） |
| P0 | **品牌模块 brand.ts**（§3.2）：新文案即日生效；存量随迁 | 每轮 70+ 处机械替换 → 0 | 小 |
| P1 | **shell 本地样式迁 local.css**（§3.4）：`.tree-*`/`.proj-*`/`.name-box*`/`.editor-col` 等 | home.css/styles.css 冲突 → 0 | 中 |
| P1 | **Home 本地功能组件化**：ZCode 树、扫码关注、新建分组抽成 `components/local/*`，Home.tsx 只留挂载行 | Home.tsx 每轮 26 块 → 单行 | 中 |
| P2 | **ExcelShell 本地段组件化**：Picture Tools/Chart Design 切换逻辑、折叠选区拾取抽组件 | ExcelShell 冲突 → 单行 | 中大 |
| P2 | **D 区改写标记补全**：按 §4 格式补齐 animation/save-pipeline/DockShell 等改写处的 LOCAL 标记 | 裁决时间 -80% | 小 |
| P3 | **共享 API 类型分区**：`home-api.ts` 里本地专属段（project API/feedback types）拆 `home-api-local.ts`，上游类型留原位 | home-api 冲突 → 导入并集 | 小 |

**约束条款（写给后续所有会话/开发者）**：
- 在 C/D 区文件里新增"实现性"代码（>5 行的函数/组件/样式块）前，必须先尝试 §3.3 的组件化路径；
- 无法拆离的修改必须带 `// LOCAL(...)` 四要素标记并回写台账；
- 每轮同步结束，把本轮新出现的 C/D 冲突文件对照本表，能迁的迁——**同步成本应逐轮下降，否则说明军规执行走样**。

---

## 7. 与上游关系的长期形态

目标形态：**上游 = 引擎与基座（A 区），本地 = 产品差异化层（B 区）+ 一层薄接缝（C 区）**。
- 引擎修复/新格式支持：持续收割（干净 pick，成本≈0）；
- 上游新产品功能（如 MCP、FilesPane）：以组件/包形态收割，经本地挂载点接入，不采纳的部分明确弃用并登记；
- 本地差异化功能（察元品牌、国内搜索、反馈通道、WPS 对齐、保存管线）：全部活在 B 区；
- C 区面积只减不增：每次同步后审计一次（§6 表格打勾），季度级回顾一次分区划分是否需要调整（上游若官方提供扩展位，C 区进一步塌缩）。
