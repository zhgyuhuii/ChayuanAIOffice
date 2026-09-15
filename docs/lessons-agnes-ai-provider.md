# 经验记录：Agnes AI（爱思）供应商「无法配置」排查与修复

> 2026-09-15。现象：本项目设置页配置 `https://api.agnes-ai.cn/v1` + Key 后无法获取模型列表/调用模型，而隔壁 chayuan-harness 一切正常。本文记录根因、修复与可复用的排查方法。

## 结论（TL;DR）

1. **API 本身没有任何问题**。`GET /v1/models`、`POST /v1/chat/completions`（流式/非流式）、CORS（`access-control-allow-origin: *`）、UA/TLS 指纹全部正常。先实测端点再读代码，能砍掉一半排查面。
2. **真正的坑有两处**：
   - **catalog 条目残缺**：本项目 v2 供应商目录（`packages/ai-provider/src/vendor-catalog.ts`）里 `agnes-ai` 条目 `defaultUrl: ''` 且无 `presets`。设置页选中后 API 地址栏空白（placeholder 是无关的 `https://api.example.com/v1`），不手填 URL 就点「获取模型/保存」直接被 `errApiUrl`/`errApiKey` 拦下——表现为「无法配置」。而 harness 的 dsh-plugin 目录预填了 URL + 4 个精选模型 + `NO_MODELS_API` 静态列表，所以 harness 直接能用。
   - **空消息序列化 bug**：`openai-compatible.ts` 对「空 text 且无附件」的用户消息会发出 `content: []`（空 parts 数组），Agnes 网关直接 400 `message content parts cannot be empty`。这是排障时抓请求体发现的，已改为序列化为 `content: ''`。
3. **免费档限流放大了问题**：Agnes 免费用户速率限制很紧（连续十几次请求即 429「您已达到免费用户的 API 速率限制」）。本项目此前没有 presets 兜底，一旦限流「获取模型」失败 → 整个厂商不可配置。harness 靠静态预设列表天然免疫。

## 本项目的双供应商体系（重要背景）

chatoffice 有**两套**供应商定义，新接供应商时极易加错位置：

| 体系 | 文件 | 消费方 | 现状 |
|---|---|---|---|
| v1（legacy） | `packages/ai-provider/src/providers.ts` + `registry.ts`（`AI_PROVIDERS`/`AI_PROVIDER_ADAPTERS`） | 基本只剩 `ai-search` 遗留路径和部分单测 | 前次 commit 55f7487 把 agnes 加在了这里，**UI 根本不读它** |
| v2（现行） | `packages/ai-provider/src/vendor-catalog.ts`（`VENDORS`） | 设置页 `packages/ui/src/ModelSettingsPage.tsx`、settings-v2 profiles、dsh/harness 融合 | **新供应商应加在这里** |

判断方法：设置页选厂商 → `VENDOR_BY_ID.get(selected)` → 表单 seed 自 `vendor.defaultUrl / vendor.presets / vendor.api`。v1 的 `AI_PROVIDERS` 完全不参与这条链路。

## 修复内容

1. `vendor-catalog.ts` 的 `agnes-ai` 条目补全（对齐 harness dsh-plugin 的可用配置）：
   `defaultUrl: 'https://api.agnes-ai.cn/v1'`、`nameZh: '爱思 Agnes AI'`、`keyUrl`（www.agnes-ai.cn）、`docsUrl`（wiki.agnes-ai.cn）、`free: 'freekey'` + `freeNote`、`presets: [agnes-2.5-flash(免费), agnes-3.0-flash(免费), agnes-2.5-pro-beta, agnes-2.5-pro]`。
   - `presets` 的双重作用：厂商选中即有可选模型；`fetchModels` 失败（限流/断网）时自动回落（`ModelSettingsPage.tsx` 的 catch 分支）。
   - Agnes 的 `/v1/models` 实测可用，**不进** `NO_MODELS_API`（与 harness 不同：harness 走纯静态列表，本项目保留 live 发现 + presets 兜底，更优）。
2. `protocols/openai-compatible.ts`：空 parts 用户消息改发 `content: ''`。
3. 测试：`tests/vendor-catalog.test.ts` 新增目录卫生不变量（非「有意留空」白名单厂商必须有 defaultUrl 或 presets——agnes 这种残缺条目以后进不来目录）+ agnes 条目对齐断言；`tests/stream.test.ts` 新增空消息序列化回归。

## 排查方法复盘（可复用）

1. **先分层实测**：curl 打 `/models` 和 `/chat/completions`（带与不带 Origin/自定义 UA）→ 再用 `npx tsx` 直跑本项目 `discoverModels()` 源码 → 都绿则问题在 UI/装配层，别在协议代码里空转。
2. **复现用真 UI**：仓库 e2e 基建（`_electron.launch(apps/shell)` + `CHATOFFICE_USER_DATA` 指向临时目录）起真应用，按 `data-vendor-row` / `data-model-base` / `data-model-fetch` 等 data 属性驱动设置页。注意：**首次打开有 Star 推广弹窗会拦截点击**，先关掉；等消息要等「内容变化」而不是「元素出现」，否则会竞态误判。
3. **抓真实请求体**：`app.evaluate` 里包一层 `globalThis.fetch` 记录目标域名请求体，一行定位「发的和以为的不一样」（本次就是靠它看到 `content: []`）。
4. **对比「能用的那个项目」的 catalog 条目字段**（defaultUrl/presets/NO_MODELS_API/keyUrl/free），差异就是答案的候选集。
5. **注意 git 查询的工作目录**：在 e2e/ 子目录里跑 `git log -- <path>` 会把 pathspec 当相对路径，查不出历史还误导结论。

## 其他备注

- 免费档 429 的中文报错来自 Agnes 侧；连续测试时按 ~1 次/分钟节流，或提醒用户升级 Token Plan。
- `agnes-2.0-flash` 只在 live 列表里有（不在官方精选四模型里），实测可用；自动选默认模型按字母序会选到它，属正常行为。
- v1 体系里已有的 `agnes` 条目（providers.ts/registry.ts，commit 55f7487）无害保留，有对应单测；但后续新供应商别再加那边。

## 排障续记：三种打包形态联调新踩的坑（同日）

修复 Agnes 后按形态验证，又排掉五个跨仓库问题，全部记录在此：

1. **打包版全新首启必崩**（安装包形态）：`apps/shell/src/main/index.ts` 的改名迁移列表含当前名
   `ChatOffice`，全新机器上 userData 目录为空时 `cpSync(同目录, 同目录)` 抛「src and dest
   cannot be the same」未捕获 → 主进程崩；第二次启动目录非空才恢复。修复：同目录跳过 +
   逐项拷贝（`cpSync` 对已存在目录会把 src 整个嵌进 dest，不能整目录拷）。
2. **Node `cpSync` 的软链陷阱**（dsh/harness 形态）：`dereference: true` 会把目录软链改写成
   **指向源树真实路径的绝对链接**；默认（不 dereference）**同样会**！必须 `verbatimSymlinks: true`
   才逐字保留。sidecar 的 `node_modules/@chatoffice/*` 是 npm workspace 相对软链，被改写成
   绝对链接后只在构建机有效。harness 的 `BundledPluginSpec` 因此加了 `preserveSymlinks`。
   注意 pnpm store 型 vendor（kb/models）仍需 dereference 扁平化——两种需求并存。
3. **BFF/sidecar 纯 Node 崩**：`ai-search` 包根 → media-tools → `electron-utils` 包根 →
   drop-open 顶层 `import 'electron'`，Docker BFF 与 dsh sidecar 一启动就炸。修复：electron
   绑定惰性化（`electron-binding.ts` 的 createRequire 缝，测试可 `vi.mock`）。教训：**包根
   index 不要顶层 import 'electron'**，或纯 Node 消费方一律走子路径导入。
4. **sidecar 依赖缺口**：`package-embedded.mjs` 的合成 workspace 不装 slides 应用依赖，
   pptx 渲染链 `render-build → tiff-decode → pngjs` 与 `fonts → @chatoffice/ui/fonts/*.ttf`
   都缺。修复：slides-src 合成清单声明 pngjs/utif2/harfbuzzjs + PACKAGES 增加 `ui`。
   教训：sidecar 每次改动后**必须从 staged 目录裸起一次**（`node --import tsx ... main.ts`）验证。
5. **package-lock.json 缺 linux 平台原生包**：lock 在 mac/win 机器上增量生成，不含
   `@rollup/rollup-linux-*`、`@esbuild/linux-*` 条目 → 任何全新 linux 环境 `npm ci` 后
   vite 直接 MODULE_NOT_FOUND（esbuild 靠 install.js 的注册表自愈，rollup 无兜底）。
   修复：lock 手工补 linux-x64/arm64 平台条目（镜像 darwin 条目的最小形状）+ Dockerfile
   构建层显式补装 x64 原生包（按 lock 解析出的版本号钉死）。
6. **小内存服务器构建 Docker 镜像**：1.8G RAM 的 aidooo.com 跑 builder 阶段 vite 渲染
   （峰值 >1.1G）触发内核 OOM 连坐生产容器。加 4G swap 后通过。经验：上云构建先看
   `free` 与 `dmesg -T | grep -i oom`，OOM 的表象是「日志停在 rendering chunks、进程消失」。
7. **同一机器双实例**：chatop 桌面的受管 dsh 硬绑 3080 端口，dev 实例与打包实例并存时
   互相抢端口 → 双方 dsh web 各自 ~24s 崩溃重启循环。排障时表现为 sidecar 反复 ready 换
   端口；先 `pgrep -af dsh` 查共存实例再看 chatoffice 本身。
