# 媒体模型统一调用能力 —— 差距分析与开发方案

> 状态:方案(未实施)
> 目标:全部编辑器(docs / sheets / slides / pdf / markdown / html / 首页对话)的 AI 对话,
> 能动态调用设置中已配置的**任意类型模型**——图像生成、视频生成、语音合成(TTS)、
> 语音识别(ASR)、图片理解、视频分析——并正确返回结果、按指令操作编辑内容。
> 铁律:新增功能全部走新文件(B 区),既有文件只允许一行挂载点引用,最大化避免上游同步冲突。

## 一、现状差距分析

### 1.1 基础设施盘点(已存在、可复用的部分)

| 基础件 | 位置 | 状态 |
|---|---|---|
| 模型类型识别(chat/vision/image/video/tts/asr/…) | `ai-provider/model-type.ts` `inferModelType` | ✅ 完备 |
| 各类型默认模型解析 | `ai-provider/settings-v2.ts` `resolveDefaultModel(settings, kind)`,kind 含 image/videoGeneration/tts/asr/imageUnderstanding/videoUnderstanding/svgGeneration | ✅ 完备 |
| 能力树(厂商可服务哪些能力) | `ai-provider/capability-tree.ts`(imageGen/videoGen/imageUnderstanding/videoUnderstanding/svgGeneration) | ✅ 设置页在用 |
| 图像生成适配器(OpenAI images / Gemini / DashScope 原生) | `ai-provider/imagegen.ts` `generateImageWithModel` | ✅ 完备,六端已在用 |
| 视频任务注册表(提交→轮询→广播→取消→重试,后台存活) | `ai-host/video-tasks.ts` + `ai-provider/media-jobs.ts`;docs/sheets/slides 主进程已注册 `videoTasks` deps | ✅ 共享件,但只有 slides 有 agent 工具 |
| 多模态消息管线(images/audio/video 附件随聊天输入) | `agent-core` `loop.run(instruction, images, media)` → 协议层 media parts | ✅ 附件理解已通(走**当前聊天模型**) |
| 生图结果本地存储(file:// 回执,字节不过 IPC) | `electron-utils/generated-images` | ✅ 可推广到音视频 |
| 超时/SSRF 防护/429 重试/错误本地化 | `media-protocols.ts` withTimeout、`safe-remote-url`、video task retriable、`errNo*` 系列 | ✅ 模式成熟 |

### 1.2 能力矩阵(✅ 可用 / ❌ 缺失 / ➖ 不适用)

| 能力 | 设置项 | 运行时适配器 | 统一 IPC | docs | sheets | slides | pdf | md | html | home |
|---|---|---|---|---|---|---|---|---|---|---|
| 聊天(含附件多模态输入) | ✅ | ✅ | ai:stream | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 图像生成 | ✅ | ✅ | ❌ 各端各自通道 | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ | ✅ |
| 视频生成 | ✅ | ✅ | ⚠️ slides 专有 | ❌无工具 | ❌ | ✅ | ❌ | ❌ | ➖ | ❌ |
| 图片理解(独立理解模型) | ✅ imageUnderstanding | ❌ 无消费方 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 视频分析(独立分析模型) | ✅ videoUnderstanding | ❌ 无消费方 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 语音合成 TTS | ✅ tts | ❌ 无适配器 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 语音识别 ASR | ✅ asr | ❌ 无适配器 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| SVG 兜底 | ✅(默认值无消费方,靠聊天模型内联画) | ✅ 栅格化 | — | ✅ | ✅ | ✅ | ❌ | ✅ | ➖ | ❌ |

### 1.3 结论:**当前不能达到要求**,差距五类

1. **通道碎片化**:图像生成有 5 条平行通道(docs:ai-generate-image / ai:generate-image /
   sheets 桌面通道 / markdown+pdf byok handler / ai:media-generate),行为一致但各自为政;
   新增能力类型若照此模式复制,维护成本线性上涨。
2. **视频只在 slides**:任务注册表本是 ai-host 共享件,但 agent 工具只有 slides 有。
3. **理解类默认值零消费**:`imageUnderstanding` / `videoUnderstanding` 在设置里可选,
   但没有任何代码调用。当前"看图/看视频"实际走的是**当前聊天模型**的多模态能力,
   用户单独配置的理解模型被完全忽略——这是与需求偏差最大的点。
4. **TTS / ASR 只有设置项,没有运行时**:无适配器、无通道、无工具、无落地场景。
5. **工具层重复实现 + 门控不一**:每端自己写工具 schema/executor/门控,已有三轮
   修复都源于此(sheets 硬编码隐藏、pdf 文案、slides 云端门控)。

## 二、目标架构(架构师视角)

### 2.1 设计原则

- **一次解析,处处可用**:设置 → 能力解析 → 统一 IPC → 适配器,四层单向依赖;
  渲染端只认"能力探测 + 通用通道",不认厂商。
- **适配器注册表而非 if-else**:每类能力一个 `call(ResolvedModelCall, input)` 签名,
  新厂商 = 注册表加一行,各端零改动。
- **复用优先**:图像直接复用 `generateImageWithModel`;视频直接复用 `video-tasks` 注册表;
  理解复用协议层 media parts 与 `geminiUploadFile`;存储复用 generated-images 模式;
  超时/SSRF/429/错误本地化全部沿用既有件。
- ** honest gating**:工具动态出没 = 能力探测结果;没有模型就如实报"未配置",
  永不静默换通道、永不甩锅云端(近三轮修复确立的原则)。
- **新文件铁律**:下述全部新增逻辑进新文件;既有文件只留一行挂载。

### 2.2 分层设计

```
渲染端(每端一个新文件)
  apps/<app>/renderer/ai/media-skill.ts      ← 工具 schema + 执行器 + 动态门控
      │  window.desktop.mediaCapabilities()   ← 探测(决定工具出没)
      │  window.desktop.mediaSubmit/Understand/Tts/Asr(...)
      ▼
主进程统一通道(ai-host 新文件)
  packages/ai-host/src/media-ipc.ts          ← ai:media:* 五个通道 + 并发闸门 + 作业登记
      │  resolveMediaCapability(settings, kind)   ← 能力解析(ai-provider 新文件)
      ▼
适配层(ai-provider 新文件,复用既有件)
  capability-runtime.ts   能力→ResolvedModelCall(纯函数)
  understand.ts           图片/视频理解(复用协议层 media parts + geminiUploadFile)
  tts.ts / asr.ts         语音适配器注册表(openai-compatible / gemini / dashscope / …)
  imagegen.ts(既有)      图像
  media-jobs.ts(既有)    视频
      ▼
存储/安全(electron-utils 既有)
  generated-images 模式推广 → 媒体文件落 userData/media,file:// 回执
  fetchWithSsrfGuard / withTimeout / KEEP_KEY 红脱
```

### 2.3 各端落地形态

工具 = 一个能力一个工具(schema 小、token 省、门控诚实):

| 工具 | 返回 | 各端落点 |
|---|---|---|
| generate_image | file:// / data URL | 既有插入工具直连(docs/markdown 图片块、sheets add_image、slides insert_web_image、pdf insert_image);html/home 对话卡片 |
| generate_video | 任务 id → filePath + poster | slides 插页;其余端对话卡片(文档格式不支持嵌视频) |
| analyze_media(图/视频理解) | 分析文本进上下文 | 全端通用(模型据此继续操作内容) |
| transcribe_audio(ASR) | 文本进上下文 | 全端通用(转写结果按指令插入/改写) |
| generate_speech(TTS) | 音频 file:// | slides 插入音频元素(PPT 旁白);其余端对话卡片播放 |

html 编辑器:保留 generate_image(结果 URL 进 img 标签)与文本类工具;音视频落点不适用,按能力探测自动不挂载。

## 三、开发计划(五个阶段,均在新文件实施)

### Phase 0 — 能力解析与探测(地基,约 0.5 天)

- 新文件 `packages/ai-provider/src/capability-runtime.ts`:
  `resolveMediaCapability(settings, kind: MediaKind): ResolvedMediaCall | undefined`,
  内部复用 `resolveDefaultModel` + `findProfile` + `resolveSecret`;纯函数、可单测。
- 新文件 `packages/ai-host/src/media-capability-ipc.ts`:
  `ai:media-capabilities` 通道,返回 `{image,video,imageUnderstanding,videoUnderstanding,tts,asr}` 布尔图 +
  各能力的模型 label;挂接既有 ai-settings watcher,设置变更即时生效。
- 验收:六端渲染端一行预加载即可拿到能力图;单测覆盖每种 kind 的解析与未配置分支。

### Phase 1 — 收敛图像/视频到统一通道(约 1–2 天)

- 新文件 `packages/ai-host/src/media-ipc.ts`:
  - `ai:media:generate`(kind=image)→ 直接调 `generateImageWithModel`,结果走 generated-images 存储;
  - `ai:media:video-submit` / `ai:media:video-events` → 转调既有 `video-tasks` 注册表
    (把 markdown/pdf/html 的 `videoTasks` deps 补齐,一行注册);
  - 通道内做并发闸门(见 2.4)。
- 每端新文件 `apps/<app>/src/renderer/ai/media-skill.ts`:`createMediaSkill({caps})`,
  含 generate_image / generate_video 工具与动态门控;在既有 `composeSkills(...)` 处加**一行**挂载。
- 既有各端图像通道保留(兼容期),新工具一律走新通道;上游合并面 = 每端一行。

### Phase 2 — 图片理解 / 视频分析(约 1–2 天)

- 新文件 `packages/ai-provider/src/understand.ts`:
  `understandMedia(call: ResolvedMediaCall, {media: MediaBlob[], requirements}) → {text}`,
  复用协议层既有 media parts 构造(openai-compatible image_url/视频方言、gemini inline_data/
  `geminiUploadFile` 大文件直传);**用配置的理解模型,不是当前聊天模型**。
- 可选策略位 `allowChatFallback`:理解模型未配置但当前聊天模型带视觉时是否降级,
  默认关;开启时输出明确标注"由聊天模型代分析",不静默。
- `ai:media:understand` 通道;media-skill 挂 `analyze_media` 工具(输入 https/file 路径,
  复用 `loadMediaReference` 的 SSRF/大小防护模式)。

### Phase 3 — 语音 ASR / TTS(约 2–3 天)

- 新文件 `packages/ai-provider/src/asr.ts`、`tts.ts`,适配器注册表:
  - 首批:openai-compatible 形状(`/audio/transcriptions`、`/audio/speech`,多数网关镜像此形状,
    覆盖面最大)+ Gemini(generateContent AUDIO 模态);
  - 预留:dashscope cosyvoice/paraformer、volcengine、minimax 等厂商专有适配器插槽。
  - 统一签名:`transcribe(call, {bytes, mime, language}) → {text}` / `synthesize(call, {text, voice, format}) → {bytes, mime}`。
- `ai:media:asr` / `ai:media:tts` 通道;音频落盘 `userData/media`,回执 file://,
  **音频字节永不进模型上下文**(ASR 只回文本;TTS 回路径+时长)。
- 工具:`transcribe_audio` 全端挂载(转写文本随即可按指令插入/改写);
  `generate_speech` slides 优先(PPT 旁白:新增插入音频元素的 placement op,走 slides-skill 新文件);
  其余端先做对话卡片播放。

### Phase 4 — 打磨(约 1 天)

- i18n:新键走 `i18n/local*` 运行时合并文件(coexistence 规则 #2),工具文案 20 语言。
- 文档:capability-catalog 增补;本文件状态翻"已实施"。
- 门禁:六端 typecheck + 测试 + lint + 品牌检查全绿。

### 2.4 非功能性设计(并发/性能/异常)

- **并发**:`media-ipc` 内置每厂商信号量(图像默认并发 3,视频沿用 video-tasks 单厂商队列,
  TTS/ASR 并发 2);整份生成的批量配图已用 Promise.all,通道级闸门防供应商限流风暴。
- **性能**:字节不过 IPC(落盘 + file:// 回执,video-tasks 与 generated-images 既有模式);
  大视频走 `geminiUploadFile` 直传而非 base64;设置热更新走既有 watcher,探测零轮询。
- **异常**:错误分类固定六类并本地化——未配置(errNoXModel,如实)/ 鉴权失败 / 供应商 4xx
  (透传 body detail,复用 http-error)/ 429(retriable,视频已有)/ 超时(withTimeout)/
  中止(signal 全链路透传,中止后绝不落笔——既有原则);静默降级只允许出现在
  显式开启的策略位上。
- **安全**:远端媒体一律 `fetchWithSsrfGuard`;密钥只在主进程,KEEP_KEY 红脱不变;
  文件类型按魔数嗅探而非扩展名。

### 2.5 冲突面控制(铁律对照)

| 改动 | 文件 | 冲突面 |
|---|---|---|
| 全部适配器/解析 | ai-provider 4 个新文件 | 零 |
| 全部通道/闸门 | ai-host 2 个新文件 | 零 |
| 全部工具/门控 | 每端 media-skill.ts ×6 | 零 |
| 挂载 | 每端 composeSkills 一行;3 个主进程 videoTasks deps 一行 | 一行级,规则 #1 允许 |
| i18n | local* 合并文件 | 零 |

## 四、需要拍板的决策点

1. **理解模型未配置时**是否允许"当前聊天模型代分析"(建议:允许但必须明示,默认开)。
2. **TTS 首批落地范围**:仅 slides 旁白插入,还是全端对话卡片播放同步做(建议:先 slides + home 卡片)。
3. **厂商优先级**:openai-compatible 形状先行(覆盖网关最多),还是先做某个国产厂商直连。
