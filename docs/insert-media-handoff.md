# 插入媒体 P2/P3 交接文档

> **【2026-09-06 更新】P2/P3 已全部实施完毕**（同日提交），本文转为实施记录。
> 实施要点与本文施工图的差异：
> 1. P2.1 档案 3 家照建；P2.2 的 6 家适配器端点全部按官方文档核实后实装
>    （runway/vidu/pixverse/sora/veo/chatoffice），并给 `MediaJobResult` 增加
>    `downloadHeaders`（sora content / veo files 的鉴权下载仅主进程可见）。
> 2. P2.4 任务注册表落地为 `packages/ai-host/src/video-tasks.ts`，新增
>    `ai:video-retry/-preview` 两个通道（共 5 个）；并发 3/后台存活/落盘/
>    `ai:video-tasks-changed` 广播均按共识实现；结果文件写
>    `userData/media/videos/<taskId>.mp4`。
> 3. P2.5 预览采用「≤48MB 读盘转 dataURL」方案（未走 custom protocol），
>    插入时 slides 复用该 dataUrl 直接走 `slides:add-media-bytes`
>    （op 扩展可选 posterBase64/posterExt），未新增插入通道。
> 4. P2.3 的 chatoffice 视频保持数据驱动；`runtime.runVideoJob` 为
>    video-tasks 的解析入口。
> 5. P2.6 以 vendor-catalog `keyFields` 声明 + ModelSettingsPage 折叠实现。
> 6. 遗留：veo/vidu 图生视频（imageUrl 已在 MediaJobRequest 预留）；
>    本地 tab 视频；>48MB 预览降级外链。手动 smoke 第 5 条待真机账号验证
>    （智谱/可灵测试账号当时欠费/401，tmp-realkey 在线测试为环境态失败，非回归）。
> 7. **无 key 的全链路替代验证**：`packages/ai-host/tests/video-integration.test.ts`
>    起本地假 vendor（模拟 OpenAI videos 契约），走真实 runtime + 任务注册表
>    （设置解析→模型解析→key 下传→submit→poll→落盘→preview→401 失败路径），
>    全部断言通过。真机 smoke 只剩「真实厂商响应形状」一项待账号确认；
>    想跑真机验证：注册任一有免费额度的厂商（fal/vidu/pixverse）自行在设置页填 key 即可。

> 写给下一个会话：P1（对话框改造+搜索修复）已全部落地并推送，
> 本文是遗留工作的施工图。开工前先读 `docs/insert-media-dialog-plan.md`
> （共识计划+决策记录）与本文。**另注意：slides AI 一期线与本线并行**
> （其交接文档 `docs/slides-ai-phase1-handover.md`，commit 970e803/9571c3a），
> 它的 MediaJobClient/generate_video 工具与本线 P2 高度相关，动手前先 `git log`
> 确认它没有新的提交，避免再次互相覆盖。

## 当前状态快照（截至本提交）

### 已完成（P1，勿重做）
- 搜索兜底链 `chatoffice→Serper→Bing→Openverse` + 逐层 `attempts` 诊断
  （`packages/ai-search/src/index.ts` 的 `imageSearch`；`bing.ts`/`openverse.ts` 新文件）。
- 图库密钥每家独立模态+测试连接+未配置才引导（`packages/ui/src/InsertImageDialog.tsx`
  的 `keyModal`/`guideKeyModal`/`testKey`）。
- 参数 spec 单一事实源 `packages/ai-provider/src/media-params.ts`
  （`imageParamSpec`/`videoParamSpec`，vendor+modelId 正则规则表）。
- imagegen 动态 params + 多张（`imagegen.ts`：`ImageGenRequest.params`、
  `ImageGenResult.urls`）；`runtime.generateImage` 支持显式模型选择。
- `runtime.listMediaModels()`：目前**只返回 kind:'image'**（含 spec 主进程内嵌）。
- 共享 IPC `ai:media-models` / `ai:media-generate`（`packages/ai-host/src/index.ts`，
  URL→dataUrl 下载在主进程 `downloadAsDataUrl`）。
- 三宿主桥接全部改形（docs `shared/ipc.ts`+`preload`+`Ribbon.tsx`；slides 同构；
  sheets `desktop-api.ts`+`preload`+`ExcelShell.tsx`）。
- 设置页「搜索服务」区块（`ModelSettingsPage.tsx` 的 `saveSerperKey` +
  `model-settings-strings.ts` 的 `search*` 词条）。
- 既有 bug 修复：`normalizeV2` 透传 `stockApiKeys`/`searchApiKeys`（否则保存即丢）；
  kling JWT 改 Web Crypto；`protocols/shared.ts` 去 `NodeJS.ReadableStream`。

### 视频侧已有地基（并行线+本线）
- `packages/ai-provider/src/media-jobs.ts`（~460 行）：通用异步任务抽象
  `runMediaJob`（submit→poll 循环，deadline/interval 可配），**已注册 7 家适配器**：
  aliyun-bailian(137) / zhipu(178) / minimax(220) / volcengine(261) / kling(326，
  JWT 双字段 key 格式 `"accessKey:secretKey"`) / luma(374) / fal(418)。
- `capabilities.ts` 的 `VIDEO_GEN_VENDOR_IDS` 有 13 家 → **缺 6 家适配器**：
  runway / vidu / pixverse / gemini(veo) / openai(sora) / chatoffice。
- `vendor-catalog.ts` 已补 kling(82)/luma(92)/fal(102) 档案 → **缺 3 家**：
  runway / vidu / pixverse。
- `videoParamSpec` 已有基础版（aspectRatio+durationSeconds，kling/luma 多 1:1）。
- `settings-v2.ts` **没有** `isVideoGenModel` 导出（有 `isImageGenModel` 仿写模板）。

## P2：视频生成链路（共识决定：13 家全做、后台存活+完成通知、并发上限 3）

### P2.1 vendor 目录补 3 家
`vendor-catalog.ts` 照 kling/luma/fal 条目样式补 runway / vidu / pixverse
（id、displayName、defaultUrl、keyUrl、docsUrl、分组 global）。各家用当前官方
API 文档核实 URL，不要凭记忆写死。

### P2.2 media-jobs 补 6 家适配器
在 `media-jobs.ts` 照现有 `registerMediaJobAdapter({...})` 模式补齐：
- runway / vidu / pixverse：查官方文档的 submit/poll 端点与鉴权头。
- gemini(veo)：`predictLongRunning` + operation 轮询。
- openai(sora)：videos API（POST /v1/videos → GET /v1/videos/{id} → 下载 content）。
- chatoffice：**共识决定——实装时验证**。代理若在模型列表真返回视频型模型才展示
  （discovery 数据驱动），否则该 vendor 视频模型不出现在选择器。
每家顺带在 `media-params.ts` 的 `videoParamSpec` 细化该 vendor 特有参数
（时长/分辨率/with_audio/quality…），spec 字段 id 必须与适配器从 `params` 取值的
id 一致。

### P2.3 视频模型进选择器
1. `settings-v2.ts` 新增导出 `isVideoGenModel(entry)`（仿 `isImageGenModel`，
   `matchesModelType(type, 'video-generation')`）。
2. `runtime.listMediaModels()` 扩展：video 循环用 `VIDEO_GEN_VENDOR_IDS` 过滤 +
   `videoParamSpec(vendorId, modelId)` 填 spec，返回 `kind:'video'` 条目。
3. 对话框 `InsertImageDialog.tsx`：现有 optgroup 是「图像生成」组，加「视频生成」
   组（`MediaModelOption.kind` 已经是字段，UI 按 kind 分组即可）。选视频模型时
   顶部按宿主显示插入能力提示（见 P3.4，需对话框拿到宿主 kind）。

### P2.4 ai-host 视频任务注册表（新模块，建议 `packages/ai-host/src/video-tasks.ts`）
共识决定逐条落实：
- **后台存活**：任务注册表在主进程内存态（每 app 一份，不跨重启），对话框关闭
  不杀任务，完成后 `webContents.send('ai:video-tasks-changed', ...)` 通知，重开
  对话框取结果。
- **并发上限 3**：超出拒收（返回明确错误码）。
- IPC：`ai:video-submit`（{vendorId,modelId,profileId,prompt,params} → runMediaJob，
  任务 id 返回后立即返回，轮询在主进程）、`ai:video-tasks`（列表：状态+已耗时+
  结果 url）、`ai:video-cancel`（abort 轮询；vendor 支持取消则连带取消远端任务，
  不支持的置之不理）。
- 429：任务标失败、可重试（保留原参数）。
- **结果落盘**：共识决定视频结果统一先落盘（app data 目录），URL 结果记录原 URL。
  主进程已有 `downloadAsDataUrl` 模式（`ai-host/src/index.ts`），视频需要的是
  写文件版（流式写盘 + 返回文件路径），base64 走 IPC 会爆体积。
- 视频结果体积大：**不要**把视频 base64 塞进 `ai:media-generate` 现有通道；
  走独立任务通道。

### P2.5 对话框视频结果 UX
- 任务列表区（进行中[排队/生成中+已耗时]/已完成/失败可重试），对应 `ai:video-tasks`。
- 视频结果用 `<video controls preload="metadata">` 预览，源指向落盘文件
  （渲染进程需新增读视频文件的通道，或 data URL 仅限小文件——倾向文件路径+custom
  protocol/stream，见 P3.1 的媒体加载方案）。
- 「插入」按钮按宿主 kind 分支（P3.4）。
- i18n：`insert-image-strings.ts` 补 zh/en 词条（组件本身只有 zh/en 双语）。

### P2.6 kling 双字段凭证 UI
media-jobs 的 kling 约定 API key 字段 = `"accessKey:secretKey"` 冒号拼接。
共识决定：设置页供应商表单对 kling 渲染双字段（accessKey/secretKey 两个输入框，
保存时拼接）。实现点：`ModelSettingsPage.tsx` 的 key 表单区按 `selectedVendor.id
=== 'kling'` 分支；或在 vendor-catalog 条目加 `keyFields` 声明驱动（推荐，declarative
风格与目录一致）。

## P3：三端插入管线（共识：slides 真插 / docs 封面帧+链接 / sheets 报错）

### P3.1 slides(pptx) 真嵌入视频
- pptx 引擎在 `packages/pptx-engine`（现有 `addImageBytes` 管线旁）新增
  `addVideoBytes`：media part（`ppt/media/media*.mp4`）+ `p:video`/DrawingML
  `a:videoFile` 关系 + poster 帧图片。poster：API 封面帧优先（各家返回字段不一，
  适配器 `MediaJobResult.meta` 里带出），缺省用内置占位图。
- 渲染器（slides renderer/konva 侧）新增视频节点：播放控件、poster 常显。
- 注意：对话框 `onInsert` 目前只发 `dataUrl`（图片）。需要扩展为
  `onInsert(dataUrl, meta)` 的 meta 带 `{kind:'video', filePath?, url?, poster?}`，
  各宿主据此分支（three hosts 的 InsertImageDialog 调用点都要跟上）。

### P3.2 docs(docx) 封面帧+超链接
- 插入封面帧图片（poster 逻辑同上）+ 视频超链接（URL 结果直用外链；data URL
  结果链接落盘副本路径，并提示跨机不可用）。
- docx Protected 块体系（docs 编辑器 `docProtected` image 块所在处）加 video-link
  块类型；Tiptap 渲染为「图片+链接」组合节点。

### P3.3 sheets(xlsx) 明确报错
- 格式硬天花板：选视频模型时（对话框内）即内联提示"表格不支持插入视频，仅幻灯片
  可嵌入、文档将插入封面帧链接"；点插入时再兜底报错一次。
- 实现：对话框新增 prop `hostKind: 'docs' | 'sheets' | 'slides'`（三宿主调用点
  各自传），提示文案进 `insert-image-strings.ts`。

### P3.4 收尾
- 对话框改名已落地（"插入媒体"）；本地 tab 仍仅图片（共识本期不放开视频文件，
  如要放开在 `onFile` accept + 校验分支）。
- `docs/insert-media-dialog-plan.md` 的分期表勾掉对应项，状态行更新。

## 验证清单（下一个会话直接照跑）

```bash
# 包级测试（当前基线：51/173/69 全绿，P2/P3 改动后不得回退）
cd packages/ai-search    && npm test   # 51
cd packages/ai-provider  && npm test   # 173
cd packages/ui           && npm test   # 69
# 宿主测试（1417/608/1991 全绿）
cd apps/docs   && npm test
cd apps/slides && npm test
cd apps/sheets && npm test
# 类型检查（exactOptionalPropertyTypes 严格模式）
cd packages/ai-provider && npx tsc --noEmit
cd packages/ui && npx tsc --noEmit
```

手动 smoke（任一 app → 插入图片窗口）：
1. 网络图片 tab 搜中文词 → Bing/Openverse 命中；断网/无 key 时空结果下方出现
   逐层诊断（chatoffice 未登录 · Serper 未配置 · Bing 失败 · Openverse 失败）。
2. Pexels chip（未配置时）自动弹独立小窗 → 填错 key 点测试连接 → 红「连接失败」；
   填对 → 绿「连接成功」→ 保存。
3. AI tab 模型下拉（选了 qwen-image 的账号）→ 参数区出现「尺寸」select
   （1664*928 等枚举）+「数量」；生成多张时网格多张。
4. 设置页（模型设置）右栏底部「搜索服务」配 Serper key → 重开对话框搜索质量变化；
   重启 app key 仍在（落盘验证）。
5. P2 完成后：AI tab 选视频模型 → 提交任务 → 关窗 → 完成通知 → 重开取结果 →
   slides 插入可播放 / docs 出封面帧链接 / sheets 内联报错。

## 已知坑（前车之鉴，务必读）

1. **`exactOptionalPropertyTypes: true` 全仓严格**：可选字段不能显式传
   `undefined`，一律条件展开 `...(x ? {k: x} : {})`（`signal` 就是这么写的）。
2. **新增任何 key 类设置字段**必须三处同步：`settings-v2.ts` 的 `normalizeV2`
   透传（否则**保存即丢**——stockApiKeys 曾中招）+ `runtime.ts` 的 `redact`
   + `mergeKeys`（KEEP_KEY `'__keep__'` 哨兵语义）。
3. **`packages/ui` 会跨包编译 ai-provider 源码**：ai-provider 里不能引
   `node:crypto`/`Buffer`/NodeJS 命名空间（kling JWT 因此改过 Web Crypto）。
4. **对话框保持 vendor 无关**：参数 spec 主进程算好内嵌进 `listMediaModels`
   返回值，UI 只按 `MediaParamField` 渲染。
5. **并行线**：slides AI 一期线（MediaJobClient 是它先起的头）在同工作区活动，
   动手前 `git pull` + `git log --oneline -3` 确认没有新提交；发现它的提交把
   本线文件卷进去了，先 `git show --stat` 弄清归属再继续。
6. commit 风格：`feat：中文详述——要点1；要点2`（对齐 970e803/9571c3a 风格）。
