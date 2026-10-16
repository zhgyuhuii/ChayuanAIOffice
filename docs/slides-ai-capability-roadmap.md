# Slides AI 能力升级 · 总路线图共识（v3）

> 状态：共识已达成，代码未动。本文档为逐题对齐的完整结论，任何一项调整请按编号引用。
> 日期：2026-09-06

---

## 0. 一句话总纲

「任何模型都能编辑 PPT」在本仓库的架构含义：**chat/vision 模型当操盘手跑工具循环（四协议已通），其他类型模型（生图/生视频/TTS/ASR）作为能力插件被工具调用**；一期补齐模型线（能力矩阵/降级/截断/音视频）+ 内容线（视频生成/URL 素材）+ 质量线（模型角色化/版式库/讲稿/跨页审计）共十三项。

---

## 1. 现状分析结论

### 1.1 架构底座

- 自研 PPT 编辑器（apps/slides，Konva 画布）+ 自研 OOXML 引擎（pptx-engine 读写 .pptx zip，pptx-render 渲染树）。
- AI 编辑闭环已存在：`agent-core` 通用 function-calling 循环（anthropic / gemini / openai-compatible / openai-responses **四种**协议，50+ vendor，BYOK）→ 39 个 slides 工具 → `apply_ops`（约 50 个 JSON op 原子事务）+ `execute_slide_script`（沙箱 JS DSL）→ 主进程快照回滚 + 写后几何审计（layout-audit）+ 视觉 QC（slide-qc）。
- 生成双轨：云端（chaoffice HTML→pptx）+ 本地（BYOK LLM 写 JSON page-spec → pptx-engine 直建）。本地页生成走 `runLlmOnce` 单发，**不依赖 function calling**。
- 图像能力已有：网图/图库搜索（ai-search：chaoffice→Serper→DDG）+ 生图三通道（gemini-native / dashscope 异步轮询 / openai images，`packages/ai-provider/src/imagegen.ts`）+ chaoffice 云兜底。

### 1.2 三大缺口（分析时点）

1. 无任何 SVG 插入路径（图标预设光栅化 PNG；MEDIA_MIME 无 svg；无 svgBlip 支持）。
2. `setAnimations` 动画 op 已实现但 `aiCallable:false`，模型设不了元素动画。
3. 视频/音频/3D op 存在但未对 AI 开放。

---

## 2. 全网调研结论

1. **SVG 进 PPTX 的 OOXML 标准**：`a:blip` 主引用指 PNG fallback，`blip/a:extLst` 挂 `asvg:svgBlip`（ns `.../drawing/2016/SVG/main`）指 svg part；双 part + 双 relationship + ContentTypes 声明。PNG fallback 是必须项（老版 PowerPoint/WPS 兜底显示）。
2. **LLM 直写 SVG**：图标/logo/图示类一次成功率高；复杂插画需"渲染→视觉审→迭代修"闭环；业界共识必须有自动质量回路。
3. **PPTAgent（EMNLP 2025）**与本项目架构同构（LLM 工具调用编辑参考文档），本项目覆盖面更完整。
4. **动画 OOXML**（`p:timing` 时间节点树）高层库均不支持、需裸 XML 构造——本项目引擎已会写这棵树，动画开放是"解锁"不是"新建"。
5. **协议能力矩阵天然不对称**：anthropic 只有 chat+vision（物理上无生图/生视频/TTS/ASR/embedding 端点）；gemini 最全；openai-compatible 生态最广但碎片化。"全部类型 × 全部协议"对等支持不存在；正确形态 = 能力声明矩阵 + 明示降级/回退。

---

## 3. DeepSeek 不能生成 PPT · 根因

1. **根因①（决定性）**：deepseek-reasoner 不支持 function calling（官方文档），发不起 `generate_deck` → AgentLoop 纯文本轮结束 → "光说话不干活"。且 `inferModelType('deepseek-reasoner')` 返回普通 `'chat'`——**现有类型推断认不出无 FC**，UI 无过滤无警告。
2. **根因②（高发）**：AgentLoop 不传 maxTokens（loop.ts），runtime 兜底 8192，恰为 deepseek-chat 输出上限 → `generate_deck` 长参数（12 页 briefs JSON）极易截断（finish_reason=length）→ 重试 2~3 次后放弃。
3. **根因③（窄道脆弱）**：registry 已靠 `thinking:{type:'disabled'}` 定点补丁规避 DeepSeek V4"思考模式+工具轮 400 死锁"；`modelEchoesReasoning` 正则只认 `deep-seek-v4` 前缀，其他模型 id 形态漏网。
4. **链路认知**：即使 chaoffice 云生成可用，`generate_deck` 的发起者仍是操盘模型本身——云通道救不了发不起工具调用的模型。

---

## 4. 路线图排序

**一期（模型线 13 项）→ 二期（SVG 线）→ 三期（备忘录）。**
理由：模型线是窄改动且直接治 DeepSeek 病根；SVG 是新工程量大，且其质量闭环依赖一期的 vision/generation 能力定义。

---

## 5. 一期清单（13 项，全部已对齐）

### 模型线（1-5）

| # | 事项 | 已确认的决定 |
|---|---|---|
| 1 | **能力矩阵** | vendor × 协议 × 类型声明矩阵；**新增 FC 支持维度**（现有类型推断认不出 reasoner 无 FC）；UI 置灰 + 悬浮原因说明（不隐藏）。落点：registry.ts / vendor-catalog.ts / ModelSettingsPage |
| 2 | **无 FC 自动降级** | 【用户选择，否决"设置时阻止"】允许任何模型当操盘手；运行时检测无 FC 自动切"JSON 文本→容错解析"降级模式；面板标注兼容模式。落点：agent-core loop / AiPanel |
| 3 | **降级工具集** | 核心 10 工具：generate_deck / regenerate_slide / apply_ops / get_deck_context / read_attachment / web_search / image_search / insert_web_image / **generate_video** / **read_url**。页面生成本来走 runLlmOnce 单发（不依赖 FC），降级可行性已验证 |
| 4 | **FC 判定** | vendor/协议层静态声明为主（已知无 FC 名单）；运行时**连续 2 轮零工具调用**作动态兜底（避开澄清反问误判）；切入后标注兼容模式 |
| 5 | **maxTokens 修复** | runtime 兜底 8192 改为按 vendor/模型能力表显式配置；generate_deck 工具描述强制分批（每批 ≤4 页）；截断报错文案加指引。落点：runtime.ts / slides-skill.ts |

### 内容与素材线（6-10）

| # | 事项 | 已确认的决定 |
|---|---|---|
| 6 | **音视频附件理解** | 【细则 B】音频：gemini / openai-compatible（input_audio）/ openai-responses 三协议直通；视频：gemini 原生 inline_data 直通 + **openai 系逐厂商适配**【用户选择，dashscope qwen-vl 部件 + 智谱 video_url 先行验证架构】；anthropic 物理无音视频端点，明示不支持；**不引入 ffmpeg**。OpenAI 本家物理上无视频输入端点 |
| 7 | **MediaJobClient** | 通用异步任务抽象：submit / poll / cancel + 进度回调 + 产物统一 `{kind,url,mime,meta}`；vendor 适配器只写四件事：鉴权头 / 提交体 / 轮询映射 / 产物字段。已验证全部视频生成 API 均为同一"提交任务→轮询→下载"三段式（与 imagegen.ts 的 dashscope 生图模式同构） |
| 8 | **视频生成通道** | 已有 4 家 vendor 适配：百炼（wanx-t2v）/ 智谱（CogVideoX）/ MiniMax（海螺 video-01）/ 火山（Seedance）；新增 vendor 条目：可灵 Kling（JWT+任务轮询）/ OpenAI Sora 2（POST /v1/videos 异步）/ Runway / Luma / Vidu / PixVerse / Fal.ai（聚合）；`generate_video` AI 工具 + `addMedia` op 解锁（aiCallable）+ 生成进度卡复用 generate_deck 模式 |
| 9 | **视频成本闸** | 【按建议】`generate_video` 执行前弹确认卡（模型/时长/分辨率/预估费用），可勾选"本会话不再询问"。视频单价高（Sora/可灵一条几元~几十元），与生图不同权 |
| 10 | **read_url 工具** | ai-search 加 URL 抓取通道（主进程 fetch → 正文抽取，复用 file-parse 抽取器）+ slides skill 挂工具；补齐"链接→PPT"素材链路（此前只有 web_search 摘要，无法读指定 URL） |

### 生成质量线（11-13）

| # | 事项 | 已确认的决定 |
|---|---|---|
| 11 | **模型角色化（P0-1）** | settings modelDefaults 新增 `generation`（页面 spec 撰写）与 `qc`（视觉审稿）两角色，四协议通用。现状问题：`selectionForGen()` 只对 anthropic profile 生效（AiPanel.tsx:783-790），非 anthropic 操盘时页面 spec 由操盘模型自己写——"操盘手水平 = 页面质量天花板"。未配置时回落操盘手 |
| 12 | **内置版式库接入生成链路** | page-spec 的 layout 字段接 pptx-engine builtin-layouts 确定性坐标骨架，模型只填内容——同时提升版式稳定性、跨页一致性并降 token。现状：本地生成是 LLM 自由坐标发挥 |
| 13 | **自动讲稿 + 跨页一致性审计** | generate_deck 管线顺带产出 speaker notes 落地（setNotes op 已有）；layout-audit 跨页扩展（字号梯度跳跃/配色漂移/标题栏位置节奏/页码连续），纯确定性逻辑 |

### 一期明确不做

embedding 通道、TTS/ASR 调用通道、本地抽帧/转写（ffmpeg）、raw XML patch op、SVG 插入、本地版式感知的素材转换。

### 四协议全覆盖细则（用户约束）

- **细则 A**：maxTokens 能力表按 vendor 配值，协议层各自映射正确字段（anthropic `max_tokens` / gemini `maxOutputTokens` / openai 系 `max_tokens`|`max_completion_tokens` / responses `max_output_tokens`）——四协议字段已就绪，零新工程。
- **细则 B**：音视频部件落到"部件 × 协议"细表（见第 6 项）。
- **细则 C**：降级模式、FC 判定、工具集在 agent-core 层实现，天然四协议一致，不按协议分支。

---

## 6. 厂商清单盘点（86 家现状 + 遗漏）

现有 86 家（国内 25 / 国际 31 / 聚合 30 / 本地自建），chat 类覆盖已全。遗漏按价值分四层：

- **A 层 · 视频/图像生成主力（一期第 8 项已纳）**：可灵 Kling、OpenAI Sora 2、Google Veo 3（gemini vendor 已在清单，只加通道）、Runway、Luma、Fal.ai（聚合）、Black Forest Labs（FLUX 图像）、**Recraft（唯一原生 SVG 生成模型，对二期 SVG 线有战略价值）**、生数 Vidu、爱诗 PixVerse、Stability。
- **B 层 · 语音（二期 TTS/ASR 价值）**：ElevenLabs、Deepgram、AssemblyAI。
- **C 层 · 推理平台（按需）**：DeepInfra、Novita AI、Nebius、SambaNova、AI21、Databricks、Snowflake Cortex；本地侧缺 LM Studio。
- **D 层 · 国内大模型（按需）**：讯飞星火、昆仑万维天工、商汤日日新。

**新增 vendor 条目按能力线分批**：视频类一批（第 8 项 6 家）；图像类随生图与 SVG 线（BFL/Recraft/Ideogram/Stability）；语音类随 TTS/ASR；C/D 层按用户需求。

---

## 7. 默认决策（累计，可随时推翻）

1. 降级模式轮数预算比正常模式更紧（防无 FC 模型循环漂移烧 token）。
2. 降级模式下 slide-qc 沿用现状（无视觉模型时只做几何审计）。
3. 能力矩阵 UI 用"置灰 + 悬浮原因"，不隐藏模型条目。
4. 降级工具集含 generate_video（确认卡兜底成本）与 read_url。
5. 视频产物走 addMedia op 插入；生成进度卡复用 generate_deck 的 onProgress 模式。
6. vendor 条目按能力线分批（见第 6 节）。

---

## 8. 二期（SVG 线）· 方向已定，开工前逐题再确认

> **2026-09-06 落地记录**：经用户指示"继续开发未完成任务、不要中断"，按本节既有建议直接实施为决定并全部落地——Q2 svgBlip 双 part 标准（a:blip PNG fallback + extLst asvg:svgBlip）+ 渲染端"SVG 优先/PNG 兜底"（buildPicture 单点改动，主画布/SlideThumb/export-render 三端同源生效，主进程 MediaResolver 已有 SVG data URL 通道）；Q3 整体图片处理（改色=重生成 + replacePictureBytes 原位换 svgBytes，raster 替换自动剥离遗留扩展）；Q4 LLM 直写 SVG（generate_svg 工具：rasterizeSvg 渲染诊断→反馈自纠 ≤2 次→仍败引导降级 generate_image/形状，产物走 addPicture op 的 svgText 双 part）+ Recraft vendor（唯一原生 SVG 生成，IMAGE_GEN 通道）；Q5 setAnimations 全量解锁（aiCallable:true，24 条/页硬护栏）；Q7 兼容基线按建议（PNG fallback 兜老版本）。WordArt 生成 op（addWordArt：大字号/粗体/填充/描边渲染支持子集；prstTxWarp 几何仍不生成）。顺带修复：generate_video 的 addMedia 调用传 x/y/w/h 而 op 要求 EMU offset——运行时必失败的存量 bug。全套回归：pptx-engine 848 / pptx-render 237 / agent-core 80 / ai-provider 177 / ai-search 51 / ui 69 / slides 622+8skip 全绿。

- **Q2 SVG 落地形态**（建议 svgBlip 双 part 标准）→ 连锁：渲染端"SVG 优先/PNG 兜底"两级绘制 + **导出/打印/缩略图路径（export-render / SlideThumb，本次补遗）**；
- **Q3 SVG 再编辑性**（建议一期整体图片处理，不转 custGeom；改色靠重生成 + 原位替换复用 replacePicture）；
- **Q4 SVG 生成来源**（建议 LLM 直写 + 渲染→视觉审→≤2 轮迭代→降级插位图闭环；Recraft vendor 落地后多一条专用向量模型选项）；
- **Q5 动画开放范围**（建议 setAnimations 全家族一次开放 + 每页数量护栏 + 39 工具瘦身议题）；
- **Q7 兼容性基线**（建议 PowerPoint 2019+/WPS 最新版，老版本靠 PNG fallback）；
- **WordArt 生成 op** 与本线打包（引擎解析渲染已支持 parse.ts:3094+，只缺生成端）。

## 9. 三期（备忘录）

1. **数学公式 OMML 三端立项**：当前引擎零支持（全链 grep 无 math 代码），用户连插入公式都做不到；教育/学术/技术 PPT 刚需，工程量大（解析+渲染+生成）。
2. **音频/旁白整链**：讲稿（一期第 13 项）→ TTS → 嵌入页面音频（addMedia）→ 放映自动播报；孤立接 TTS 没有 PPT 场景消费方。
3. **素材版式转换**：PDF/网页 → PPT 的版式感知重建（当前 read_attachment 只有文本抽取，丢版式）。
4. **整册多版本对比**（"换一版"；现有 regenerate_slide 仅单页）。
5. **3D 模型开放**（addModel3d op 存在 aiCallable:false；低频卖点）。

---

## 10. 关键代码索引

| 主题 | 位置 |
|---|---|
| Agent 循环（turn 预算/压缩/守卫/快照回滚） | packages/agent-core/src/loop.ts |
| 四协议流式实现 | packages/ai-provider/src/protocols/{anthropic,gemini,openai-compatible,openai-responses}.ts |
| vendor 目录与协议映射 | packages/ai-provider/src/{vendor-catalog,registry}.ts |
| DeepSeek 定点整形（thinking:disabled / reasoning 回显） | packages/ai-provider/src/registry.ts:45-140 |
| 生图三通道（dashscope 异步模式先例） | packages/ai-provider/src/imagegen.ts |
| 模型类型推断（无 FC 盲区所在） | packages/ai-provider/src/model-type.ts |
| 默认模型角色坑位（chat/image/video/tts/asr） | packages/ai-provider/src/settings-v2.ts:415-421 |
| 生成模型覆盖只对 anthropic 生效（P0-1 现状） | apps/slides/src/renderer/ai/AiPanel.tsx:781-790 |
| 39 工具与 generate_deck 管线 | apps/slides/src/renderer/ai/slides-skill.ts |
| page-spec 本地生成 | apps/slides/src/main/page-spec.ts |
| op 注册表/原子事务 | apps/slides/src/main/ops/{registry,executor}.ts |
| 动画 op（待解锁） | apps/slides/src/main/ops/slide-ops.ts（setAnimations，aiCallable:false） |
| 几何审计/视觉 QC | apps/slides/src/renderer/ai/{layout-audit,slide-qc}.ts |
| 内置版式库（待接入生成） | packages/pptx-engine/src/builtin-layouts.ts |
| 搜索（web/image/stock） | packages/ai-search/src/ |

---

## 11. 参考来源（调研）

- [Microsoft SVGBlip（OpenXML SDK）](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.office2019.drawing.svg.svgblip?view=openxml-3.0.1)
- [python-pptx SVG 插入 issue #394](https://github.com/scanny/python-pptx/issues/394) / [NeuxPower：为何 SVG 让文件变大](https://neuxpower.com/blog/why-does-adding-svg-images-to-powerpoint-sometimes-make-the-file-so-large)
- [PPTAgent: Generating and Evaluating Presentations Beyond Text-to-Slides（EMNLP 2025）](https://arxiv.org/html/2501.03936v1)
- [Evaluating LLMs on Vector Graphics Generation（EMNLP 2024）](https://aclanthology.org/2024.emnlp-main.213.pdf) / [LLM4SVG](https://arxiv.org/html/2412.11102v3) / [SVGMaker：Claude vs ChatGPT 生成 SVG](https://svgmaker.io/blogs/can-claude-or-chatgpt-generate-production-ready-svgs)
- [MS Learn：Working with animation](https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-animation) / [OOXML CT_SlideTiming schema](https://www.datypic.com/sc/ooxml/t-p_CT_SlideTiming.html)
- [DeepSeek Tool Calls 官方指南](https://api-docs.deepseek.com/zh-cn/guides/tool_calls/)（reasoner 不支持 tool calls）
- [OpenAI Sora 2 视频生成 API](https://developers.openai.com/api/docs/guides/video-generation)（POST /v1/videos 异步）
- [Kling AI API 规范](https://docs.qingque.cn/d/home/eZQCQxBrX8eeImjK6Ddz5iOi5?identityId=1oEG9JKKMFv)（JWT + 异步任务）/ [阿里云百炼 Kling 视频 API](https://help.aliyun.com/en/model-studio/kling-video-generation-api-reference/)
- [Microsoft 365 Copilot 架构](https://learn.microsoft.com/en-us/microsoft-365/copilot/microsoft-365-copilot-architecture)（编排 LLM + grounding + DALL·E 插入，与本项目 agent 循环同构）
