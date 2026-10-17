# 经验记录：Agnes AI（爱思）供应商「无法配置」排查与修复

> 2026-09-15。现象：本项目设置页配置 `https://api.agnes-ai.cn/v1` + Key 后无法获取模型列表/调用模型，而隔壁 chayuan-harness 一切正常。本文记录根因、修复与可复用的排查方法。

## 续记（2026-10-17）：`stream: null` 整单 400（bool_type）复发与本仓库加固

现象：agnes 报 `HTTP 400`，内层 `litellm.BadRequestError: OpenAIException - 1 validation error for ChatCompletionRequest / stream / Input should be a valid boolean [type=bool_type, input_value=None]`，外层 `upstream_error`。

1. **因果链（历史实锤，2026-10-10 chatop-dev-data 剪贴板/room 留档）**：部分客户端把未设的 bool/str 槽序列化成 JSON `null`（Go `*bool` 空槽），agnes（new-api 型网关）把 `stream: null` 原样转发给 LiteLLM/pydantic 严格上游 → 整单 400。同批留档还有「9 validation errors」变体：Responses 形态部件（`output_text`）混进 chat messages。chayuan-harness 的 chatop-models 代理已于 10-11（ad1f5bf）修复：**顶层 null 视同未传剥掉 + `stream: chatBody.stream === true` 恒收布尔 + toWireMessages 归一消息部件**——三条口径即「历史处理方法」。
2. **本仓库缺口**：office 侧四个 one-shot 直连 chat/completions 的 body 不带 `stream` 字段（`chatOpenAiCompatible`、`understand.ts` 媒体理解、`media-protocols.ts` 媒体分析、`asr.ts` qwen3-asr）。显式流式路径一直发 `stream: true` 没事；one-shot 缺省会中转网关「缺失布尔 → null」的二次序列化雷。已按历史方法全部补 `stream: false`，dsh-plugin/embedded 旧拷贝同步打补丁（正式重打走 `npm run package:embedded`）。
3. **回归测试**：`tests/chat.test.ts`（one-shot body `stream:false`）、`tests/understand.test.ts`（新文件，同断言 + image_url 部件形状）、`tests/minimax-capabilities.test.ts`（期望 body 补字段）。
4. **排查备忘**：报错前缀能定位来源——office ai-provider 是 `HTTP <status>: <body>`（原文透传），harness 代理是 `vendor <id> <status>: ...`（重包装）；本机留档位置 `chatop-dev-data/.../os-data/clipboard_history.json` 与 `chatop-share/room.json`（用户复制的报错都会留在这里，带时间戳）。另：生产实例插件与仓库构建 MD5 一致（修复已在位），agnes 各 live 模型 10-17 实测 chat 面对缺失/null stream 均宽容（pro 系无渠道），但 pro 等通道仍可能是严格 pydantic 上游——显式布尔是不变量，不赌网关宽容。
5. **门禁**：ai-provider 582 用例全绿 + tsc 0。

## 续记（2026-10-17 下午）：打包后「仍报 stream 400」真凶——档案协议误配 openai-responses，agnes `/v1/responses` 转换器恒发 `stream:null`

现象：1.0.6 全平台包（asar/模块/cli 字节级验证均带上述 `stream:false` 修复）装上后，agnes-3.0-flash 仍报同一 400。用户给 key 实弹排查：

1. **排除仓库**：直连 `POST /v1/chat/completions` 五种形态全 200——`stream:false`、缺省、`stream:true`+`stream_options`、显式 `stream:null`、带 tools。网关当前对 null 都宽容，本仓库不可能产出该错。
2. **复现**：`POST /v1/responses`（Responses 形态）→ 逐字节复现用户报错；显式 `stream:true` 也 400 同错。即 agnes 的 Responses→Chat 转换器**无条件丢弃 stream**，客户端无解；该端点对 chat 模型是死的。
3. **根因**：`ai-settings.json` 里用户自建 agnes 档案 `protocol: "openai-responses"`（设置页默认本是 `openai-completions`，ModelSettingsPage.tsx:193，系手改或配置接管带入）。应用因此打 `/responses`。**修复**：档案协议改回 OpenAI Chat Completions，或直接用内置「爱思 Agnes AI」厂商条目（catalog `api:'openai-completions'` + 预设）。
4. **方法论**：`HTTP <status>:` 前缀只证明「office ai-provider 传的话」，不证明「office 造的错」——先看档案的 protocol/baseUrl 实际指向哪条端点路径，再谈网关行为；报错签名（`ChatCompletionRequest`+`stream bool_type`）与端点路径是两个独立维度。本仓库 `stream` 显式布尔修复仍是不变量，保留。

## 续记（2026-10-09）：视频模型「服务不可用」误判——videojob.ts 三处契约错配

现象：用户侧实测生图/视频模型都能用，但走本仓库 `generateVideoWithModel` 的视频生成必然失败，曾被误判为「视频生成模型服务不可用」。根因是 `packages/ai-provider/src/videojob.ts` 与 Agnes 网关的三处契约错配：

1. **`mode` 候选全错**：Agnes 的 `POST /v1/videos` 强制要求 `mode`，合法值 `text` / `keyframe` / `reference`（官方 wiki [agnes-video-25-flash](https://wiki.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash.md) 明文）。原 `MODE_CANDIDATES = ['quality','pro','t2v']` 三个全被 400「mode 无效」拒绝，走查穷尽后抛「rejected every engine mode」。`keyframe`/`reference` 需媒体参数（首尾帧/参考图）不能裸跑，只有 `text` 可走查——已改为 `['text', ...]`（quality/pro/t2v 保留给其他 new-api 型网关）。另：Flash 模型 `size` 必须是字符串 `"720P"`（传 `1280x720` 直接 400），但本仓库调用方不传 size 走网关默认，未受影响。
2. **完成 URL 藏在 `metadata.url`**：官方文档说顶层 `url`，实测完成响应里视频地址嵌在 `metadata.url`（顶层无 url 字段），`pollJob` 的 pickString 会拿空 → 走 `/content` 兜底。已补嵌套提取。
3. **任务注册表传播延迟**：创建成功（`queued`）后立即轮询可能 404「任务不存在」，个别任务甚至永久丢失。原逻辑一次 404 即抛错中止整个多分钟任务。已加 60s 限时宽限：宽限内 404 继续轮询，超时仍 404 才判失败。

排障方法补充：

- **网关参数契约以官方 wiki 为准，别猜**：`https://wiki.agnes-ai.cn/llms.txt` 是全量文档索引（Mintlify 托管，可直接 curl .md 源文），视频/图像模型的请求参数表都在各自模型专页。
- **免费档限频极紧会放大误判**：连续 ~3 次请求即 429「请求过于频繁」，冷却约 60s。边试参数边撞 429 很容易得出「服务不可用」的错误结论——排障脚本要节流（≥5s 间隔）。
- 回归测试在 `tests/runtime-model-kind.test.ts`：主用例按真实 Agnes 契约 mock（只认 `mode:text`、首次轮询 404、完成 URL 在 `metadata.url`），另一用例锁住「text 被拒不弃疗、走查到 quality」的候选走查行为。注意视频轮询真实 sleep（POLL_INTERVAL_MS=3s），双轮询用例需 `it(..., 15_000)` 超时。
- **上述人肉排查已自动化**：`packages/ai-provider/src/vendor-discovery.ts` 实现了「指纹识别（/models + 目录匹配）→ llms.txt 文档发现（catalog docsUrl 域名 → wiki/docs/root 猜测）→ 错误驱动参数探测（校验报错分类：mode/size/media/seconds/429 退避）→ 厂商档案 JSON」全流程，`VideoGenRequest.modeCandidates` 可消费档案产出。CLI：`DISCOVERY_API_KEY=... npx tsx packages/ai-provider/scripts/discover-vendor.ts https://api.agnes-ai.cn/v1 profile.json --full`。2026-10-09 对真实 Agnes 实跑收敛：`videoModes=[text,keyframe,reference]`（wiki 表格解析）、`sizeHints=[720P]`、`resultFieldPaths=[metadata.url]`（真实完成任务验证），全程 5s 节流零 429。


## 结论（TL;DR）

1. **API 本身没有任何问题**。`GET /v1/models`、`POST /v1/chat/completions`（流式/非流式）、CORS（`access-control-allow-origin: *`）、UA/TLS 指纹全部正常。先实测端点再读代码，能砍掉一半排查面。
2. **真正的坑有两处**：
   - **catalog 条目残缺**：本项目 v2 供应商目录（`packages/ai-provider/src/vendor-catalog.ts`）里 `agnes-ai` 条目 `defaultUrl: ''` 且无 `presets`。设置页选中后 API 地址栏空白（placeholder 是无关的 `https://api.example.com/v1`），不手填 URL 就点「获取模型/保存」直接被 `errApiUrl`/`errApiKey` 拦下——表现为「无法配置」。而 harness 的 dsh-plugin 目录预填了 URL + 4 个精选模型 + `NO_MODELS_API` 静态列表，所以 harness 直接能用。
   - **空消息序列化 bug**：`openai-compatible.ts` 对「空 text 且无附件」的用户消息会发出 `content: []`（空 parts 数组），Agnes 网关直接 400 `message content parts cannot be empty`。这是排障时抓请求体发现的，已改为序列化为 `content: ''`。
3. **免费档限流放大了问题**：Agnes 免费用户速率限制很紧（连续十几次请求即 429「您已达到免费用户的 API 速率限制」）。本项目此前没有 presets 兜底，一旦限流「获取模型」失败 → 整个厂商不可配置。harness 靠静态预设列表天然免疫。

## 本项目的双供应商体系（重要背景）

chaoffice 有**两套**供应商定义，新接供应商时极易加错位置：

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
2. **复现用真 UI**：仓库 e2e 基建（`_electron.launch(apps/shell)` + `CHAOFFICE_USER_DATA` 指向临时目录）起真应用，按 `data-vendor-row` / `data-model-base` / `data-model-fetch` 等 data 属性驱动设置页。注意：**首次打开有 Star 推广弹窗会拦截点击**，先关掉；等消息要等「内容变化」而不是「元素出现」，否则会竞态误判。
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
   `ChaOffice`，全新机器上 userData 目录为空时 `cpSync(同目录, 同目录)` 抛「src and dest
   cannot be the same」未捕获 → 主进程崩；第二次启动目录非空才恢复。修复：同目录跳过 +
   逐项拷贝（`cpSync` 对已存在目录会把 src 整个嵌进 dest，不能整目录拷）。
2. **Node `cpSync` 的软链陷阱**（dsh/harness 形态）：`dereference: true` 会把目录软链改写成
   **指向源树真实路径的绝对链接**；默认（不 dereference）**同样会**！必须 `verbatimSymlinks: true`
   才逐字保留。sidecar 的 `node_modules/@chaoffice/*` 是 npm workspace 相对软链，被改写成
   绝对链接后只在构建机有效。harness 的 `BundledPluginSpec` 因此加了 `preserveSymlinks`。
   注意 pnpm store 型 vendor（kb/models）仍需 dereference 扁平化——两种需求并存。
3. **BFF/sidecar 纯 Node 崩**：`ai-search` 包根 → media-tools → `electron-utils` 包根 →
   drop-open 顶层 `import 'electron'`，Docker BFF 与 dsh sidecar 一启动就炸。修复：electron
   绑定惰性化（`electron-binding.ts` 的 createRequire 缝，测试可 `vi.mock`）。教训：**包根
   index 不要顶层 import 'electron'**，或纯 Node 消费方一律走子路径导入。
4. **sidecar 依赖缺口**：`package-embedded.mjs` 的合成 workspace 不装 slides 应用依赖，
   pptx 渲染链 `render-build → tiff-decode → pngjs` 与 `fonts → @chaoffice/ui/fonts/*.ttf`
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
   最终落地方案（弱机分工）：**web 包在有工具链的机器上产出，服务器只做轻量运行时组装**
   （Dockerfile.light：npm ci --omit=dev + 预置 dist/web，无 builder 阶段），镜像语义与官方
   Dockerfile 运行时阶段一致。
6b. **嵌套 esbuild 的版本错配**（上面 5 的深层变体）：lock 里 vite/tsx 嵌套的 esbuild
   （0.28.1）只有 darwin/win32 平台条目；且这些嵌套平台包被标 `dev: true`，`npm ci
   --omit=dev` / `npm prune --omit=dev` 都会跳过 → 运行时 tsx 报「Host version 0.28.1
   does not match binary version 0.25.12」。修复：lock 补嵌套 linux 条目 + 镜像内显式
   就位对应版本二进制（slim 镜像无 curl，用 `npm pack --registry npmmirror` + tar）。
   排障口诀：esbuild 版本错配先 `find node_modules -path "*esbuild/package.json"` 列
   全部副本，再对每个宿主包查它的平台 optional 是否在位。
7. **同一机器双实例**：chatop 桌面的受管 dsh 硬绑 3080 端口，dev 实例与打包实例并存时
   互相抢端口 → 双方 dsh web 各自 ~24s 崩溃重启循环。排障时表现为 sidecar 反复 ready 换
   端口；先 `pgrep -af dsh` 查共存实例再看 chaoffice 本身。

## 续记（2026-10-17 傍晚）：dsh 形态融合真机联调——四个连环坑与模型联动打通

背景：office dsh 形态 ↔ harness 的默认模型联动（agent-default-model 双向同步）在真机
（察元AI OS dev 桌面 + 受管 dsh profile）端到端联调，连环踩掉四个坑，全部修复并有回归：

1. **401 cookie 围栏**：dsh web 的 /api/ 用浏览器签名 cookie 鉴权（client-connection 的
   BrowserAuth：进程 launch token 在 `GET /?token=` 换 `dsh-auth-<authority>` cookie，
   有效期按天）。服务端直调恒 401。修复：host.js 经 `ctx.inject(['connection'])` 拿
   `authenticatedUrl()` 铸带 token 的 URL 写进 rpc-origin 文件（chatop-shell 云通道同款），
   sidecar 侧换票缓存、401 失效重换。
2. **rc 网关线协议**：dsh 0.1.5+/rc 端点与信封 method 是**斜杠**形式（`settings/mutate`，
   点形式 404 not found）、payload 必须 `{args:{...}}` 单字段包裹。chatop web 客户端
   `harness-rpc.js` 头注有真机实证，office rpc 闭包照抄适配。
3. **settings.yaml 已废弃**：现行 dsh 配置持久化在 profile 的 **Cordis patch**
   （`profiles/web/cordis.patch.yml`），开机把遗留 settings.yaml 一次性导入后改名
   `.imported`（dsh-settings 包 README 明文）。手工播种 settings.yaml 会被开机吃掉。
   office 融合读侧改为文件优先、`settings/describe` RPC 兜底（llm-pi-ai providers +
   agent-default-model 双 ns；describe 响应 value.namespaces[]）。
4. **harness stage 签名盲区**：桌面开机按内容签名重铺 bundled 插件，chaoffice 的签名只
   覆盖 `dist`——但 sidecar 运行面是 tsx 直跑的 **src**，同版本源码修复永远铺不进
   staged（bundled-plugin.ts 自己的注释就警告过同款事故）。修复：signatureDirs 补
   `vendor/chaoffice-sidecar/{apps,packages}`。真机验证时 `rm -rf` staged 目录可强制重铺。

真机验证链路（全部通过）：office 视图融合 agnes 路由（describe 兜底）→ office 切模型
→ cordis.patch.yml 的 agent-default-model 实时翻转 → `/ai/stream` 真实调 agnes
（apiKeyEnv → .credentials.yaml 凭据解析）→ harness 通道 `settings/update` 改默认 →
office 视图即时跟随。触发 origin 文件写入的条件：office 应用窗口打开（client 半边轮询
`/api/chaoffice/status`）；CDP `window.__chatop_shell__.openApp('chaoffice')` 可无人值守
驱动（Electron `--remote-debugging-port=9222`）。

排障口诀：dsh 侧问题先分清「鉴权（401/换票）→ 协议（404/斜杠+args）→ 存储层
（settings.yaml vs cordis.patch.yml）→ 铺货（staged 副本是否真的换新）」四层，逐层 curl
/页面上下文 fetch 隔离。
