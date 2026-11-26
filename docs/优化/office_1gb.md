# 察元 AI Office (`chayuan-office`) 超大文档（1GB+）架构演进与施工设计方案（代码校准版）

> **版本说明**：本文档基于仓库真实代码路径（`file:line`）核查结果全面修订。剔除了存量已具备能力的重复建设，修正了模块归属错位，解决了 `document.xml` 流式重压缩吞吐率与保存耗时目标之间的数学矛盾，并补充了 Web/Server/CLI 多端形态约束与真实工程量评估，可直接作为立项评估与分阶段施工蓝图。
>
> **二次校准（2026-11-25）**：并入二次审查六项发现——①补齐门禁声明上限第一墙（`maxPartBytes: 512MB`）与两遍全量解压开销；②P2 增设「只读窗口」验收门（P2 时点兑现「打不开→能打开」）；③双模式切换判据改解析前可得信号；④PDF 增量保存按文件系统分档并补线性化假设；⑤全篇行号按工作区实测校正；⑥`StringSliceMeta` 尺寸、场景 A 假设标注等小项。

---

## 1. 现状基线校准：存量能力、模块勘误与真实硬缺口

在对全仓代码进行逐行核查后，`chayuan-office` 并非在所有子系统上都处于「全量内存裸奔」状态——团队在历史迭代（包括处理 2.7GB EMF 事故与 409 页 PPT 9GB 内存事故）中已经落地了相当一部分流式与窗口化基础设施。立项前必须先划清**「存量已具备」**与**「真实待攻坚缺口（True Delta）」**的边界。

### 1.1 模块职责勘误与基线对照表

| 子系统 | 真实代码归属（修正前版错位） | 存量已实现能力（无需重复造轮子） | 1GB+ 场景下的真实剩余硬缺口（True Delta） |
| :--- | :--- | :--- | :--- |
| **归档门禁与拼接** | `packages/zip-gate`<br>`packages/docx-engine/src/zip-splice.ts` | `zip-gate` 是零依赖防炸弹校验器；`zip-splice.ts:2-4` 已具备按 stored bytes 原样拷贝未改条目的种子设计 | **声明上限硬拒（第一墙）+ 硬拒 ZIP64**：`DEFAULT_ZIP_LIMITS` 的 `maxPartBytes: 512MB` / `maxTotalBytes: 1.5GB`（`zip-gate/src/index.ts:38-39`）按中央目录**声明尺寸**在膨胀前硬拒（`index.ts:113-118`）——主流 1GB docx 的 `document.xml` 解压 1~2GB $< 4\text{ GB}$，根本不需要 ZIP64，被拒纯粹是声明上限；`index.ts:156-164` 与 `zip-splice.ts:89-97,120-122` 另显式拒绝 ZIP64（$> 4\text{ GB}$ 归档）；且 `verifiedSize` 对每个条目全量膨胀验真（`index.ts:119-121`），JSZip 解析再膨胀第二遍=可开 band 两遍全量解压；缺少 `mmap` 与 DEFLATE 随机寻址检查点 |
| **Word 解析与补丁** | `packages/docx-engine`（注：`file-parse` 仅用于 AI 附件抽文本，`file-parse/src/docx.ts:20-69`） | 基于 `originalXml` + `docxIndex` 的高精度块级字节保真回写（`patch.ts` 约 3000 行，覆盖表格补丁、`rawPPr` 等） | **全量驻留触碰 V8 极限**：`parse.ts:445` 将 `document.xml` 整体读为 `string`（上限 $\approx 512\text{ MB}$）；每块挂载 `originalXml`（`types.ts` `Block` 接口 `:2242-2252`）；渲染进程持有 `internal.originalBytes` 全包字节与 `documentXml` 全文（`parsed.internal`，解构于 `patch.ts:1009`）；`patch.ts:2565,3062,3213` 拼接 + 全量内存 `generateAsync` 重建整包 `Uint8Array` |
| **Word 渲染与排版** | `apps/docs`<br>`packages/font-metrics` | 分帧渐进挂载（`phased-content.ts:40-44`，首帧 64 块 + 每帧 128 块）；超重保护阈值（`large-document.ts:17-18`）；主进程 sfnt 竖向度量预取（`font-metrics/src/metrics.ts:121`）+ Canvas `measureText`（`line-metrics.ts:180`） | **无视口虚拟化、大文档直接拒开**：单 ProseMirror `EditorState` 装载全量节点，无旧块卸载；当前策略为权重 $> 115,000$ 降级只读、$> 230,000$ **直接拒绝打开** |
| **表格引擎** | `apps/sheets/native/xlsx-engine`（Rust stdin/stdout JSON 行协议 Sidecar）+ `packages/xlsx-gateway` | **已实现分块与视口驱逐**：Sidecar 已按 `CHUNK_ROW_COUNT = 256` 流式落盘索引（`lib.rs:61`），Open 仅回元数据，按 $\le 100\text{k}$ 上限 `read_range` 拉取（`desktop-api.ts:61`）；Univer Canvas 已实现可见窗口加载与旧窗口驱逐（`univer-sync.ts`，`evictFilteredViewport` 等）；写前备份已走内核级 `fs.copyFile`（`xlsx-package-io.ts:462`） | **`sharedStrings` 全量驻留**：Rust 侧 Open 时一次性将全部共享字符串解析进 `Arc<Vec<SharedString>>`（`workbook.rs:507`、`lib.rs:704`）；行 JSON 协议在高密度数值拉取时仍有序列化开销；`IronCalc` 依赖图常驻优化 |
| **演示文稿与媒体** | `apps/slides`<br>`packages/pptx-engine`<br>`apps/docs/src/main/lazy-media.ts` | **图片协议与流式保存已存在**：Slides 图片已走 `chaoffice-slide-media://`（`slides-main.ts:1443-1453`）；Docs 媒体 $\ge 1\text{ MB}$ 已走 `chaoffice-docx-media://`（`lazy-media.ts:28`）；缩略图已用 `IntersectionObserver` 窗口化（`use-visible-thumbs.ts:4-6`）；PPTX 保存已走 `generateNodeStream` 流式写出（`pptx-engine/src/index.ts:819`） | **音视频仍走 Base64 IPC**：`slides:media-data` 仍返回全量 `data:${mime};base64,...`（`slides-main.ts:4362-4379`）；图片缓存 `Map` 只增不减无驱逐（`image-loader.ts:103-111`）；缺少 `?maxW` 按需降采样；EMF 栅格化仍有 $\approx 40\text{ MB}$ Base64 预算风险（`image-loader.ts:24-28`） |
| **PDF 引擎** | `apps/pdf`（含唯一使用 `HarfBuzz wasm` 做字体子集化的路径 `wasm-path.ts:22-38`） | 数字签名路径已手工实现过 PDF 增量更新拼装先例（`pdf-sign.ts:387` 起） | **全量字节拼装 + 全量重写**：渲染进程分片 IPC 后仍拼成完整 `Uint8Array`（`file-bytes.ts:30-33`）；普通编辑保存走 `pdf-lib` 全量 load + 全量 save（`save-pdf.ts:1615` 等） |
| **文件写入与 Agent** | `packages/electron-utils`<br>`packages/agent-core` | 原子写已采用 `temp + fsync + rename`（`atomic-write.ts:126-155`）；Agent 已有 `captureSnapshot` 大纲级快照机制（`agent-core/src/loop.ts:1567`） | 核外模式下编辑器不再持有全文，需为 `agent-core` 补齐基于本地 SQLite FTS5 的核外块检索接口 |

---

## 2. 核心设计约束：多端形态与存量阈值对齐

在设计核外（Out-of-Core）架构前，必须遵守本仓库的两项工程边界，避免破坏现有产品矩阵：

### 2.1 Desktop / Web / Server / CLI 多端隔离策略

本仓库同时构建 **Electron Desktop**、**Web 端（`build:web`）**、**Server Docker**，且 `packages/docx-engine` 同时被 CLI 与格式转换包（如 `doc2docx` 等）直接依赖。`mmap`、Rust 原生 Sidecar、本地 SQLite 在浏览器沙箱中均不可用。因此必须采用 **接口抽象 + 运行时适配器（Storage & Parse Provider）** 架构：

1. **Desktop 端（Electron + Rust Native/Sidecar）**：启用完整的「Mmap + DEFLATE 检查点 + 核外索引 + 流式补丁保存」，突破 $1\text{ GB}+$ 限制。
2. **Server / CLI 端（Node.js / Rust Addon）**：复用与 Desktop 相同的 Rust 核心库（N-API 或 Sidecar），使服务端批处理与 `doc2docx` 转换同样具备流式低内存能力，同时保留旧版内存 API 的兼容门面（Facade）以免破坏下游调用方回归。
3. **纯 Web 端（Browser）**：通过 `File.slice()`（底层为浏览器 Blob 磁盘引用，不占 JS 堆）配合 Web Worker 中的 Rust WASM 流式解析器读取局部区间；受限于浏览器 OPFS（Origin Private File System）配额，超过内存预算时优雅降级为「分页流式只读/局部块编辑」或沿用现行阈值提示。

### 2.2 双模式切换阈值：与现存预算体系严格对齐

摒弃拍脑袋的固定文件体积阈值，直接与仓库现有的多维预算体系挂钩，只有触及水位线时才激活核外重型管线（小文档继续走现有零 IPC 极速内存快路径）：

* **媒体懒加载阈值**：维持 `lazy-media.ts:28` 现行的可解码媒体总计 $\ge 1\text{ MB}$ 标准，并统一收口音视频流。
* **Docs 核外模式激活阈值**：切换判据必须是**解析前可得**的信号——权重是解析后产物，用它判档存在循环依赖（不解析完算不出权重）。改为中央目录元数据（各 entry 声明未压缩尺寸、条目数、ZIP64 标记）+ 首屏廉价扫描块计数：当声明总解压量在预算内且首扫权重 $\le 80,000$ 时维持现有全内存模式；超线（原 $115,000$ 只读线前移）、单 entry 声明 $> 512\text{ MB}$ 或包含 ZIP64 条目时，**不再降级只读或拒开（移除 $230,000$ 拒开硬限制）**，无缝切入核外流式管线。
* **Sheets 核外字符串池阈值**：对接 `apps/sheets/src/renderer/load-budget.ts:53-71` 的 $\le 500,000$ 格自动全载预算——当 `sharedStrings.xml` 未压缩体积 $> 16\text{ MB}$ 或条目数 $> 200,000$ 时，Sidecar 自动切换为 Mmap 偏移索引模式。

---

## 3. 分模块精准攻坚方案（按真实缺口设计）

### 3.1 PDF 引擎（`apps/pdf`）：流式 Range 打开 + 通用增量保存 + 碎片整理

这是全仓**先例最成熟、风险最低、收益立竿见影**的改造项。

1. **渲染层废除全量 `Uint8Array` 拼接（改写 `file-bytes.ts:30-33`）**
   * 主进程不再通过分片 IPC 把整个 $1\text{ GB}$ PDF 搬运并拼接到渲染进程内存中，而是暴露基于文件描述符（`fs.read` 指定 `position` 与 `length`）的 `PDFDataRangeTransport` 通道，或通过自定义流式协议响应 `Range: bytes=start-end`。
   * 配置 `pdf.js` 开启 `disableAutoFetch: true`、`disableStream: false`，仅加载末尾交叉引用表（`xref`）及当前视口前后各 2 页的内容流，离屏页严格调用 `pdfPage.cleanup()`。
2. **复用 `pdf-sign.ts:387` 先例，将普通编辑保存升级为增量更新（改写 `save-pdf.ts`）**
   * 放弃 `pdf-lib` 对全文件执行 `PDFDocument.load(fullBytes)` + `save()`。
   * 当用户修改注释、表单或单页真文本（配合 `wasm-path.ts` 现有的 `HarfBuzz wasm` 局部字形子集化）时，仅提取被修改页的 Indirect Object ID，构建增量对象体（Modified Objects + 新增 Font Subset Stream + Incremental XRef Table/Stream + 指向原文件末尾偏移的 `/Prev` Trailer）。
   * 保存耗时按文件系统分档：CoW 文件系统（macOS APFS `clonefile` / Linux `FICLONE`）下先经 `atomic-write.ts` 临时文件机制复制原文件再 `append` 数十 KB 增量字节，近零拷贝成本，$1\text{ GB}$ PDF 保存 $< 100\text{ ms}$；**非 CoW（NTFS/ext4）下整包拷贝即 ~1s 起**，此类平台改用「原文件就地 `append` + 保存前记录原尺寸日志、失败按日志截断回滚」，目标 $< 1.5\text{ s}$。
   * 注：`PDFDataRangeTransport` 按需读取效率以**线性化 PDF（Linearized）**为佳；非线性化文件 pdf.js 需顺序扫描恢复 xref，验收样本应包含非线性化用例。
3. **增量膨胀治理（Eventual Compaction 策略）**
   * 增量追加会导致多次保存后已废弃的旧对象留在文件中。记录增量修订次数 `revisionCount` 与累计追加体积 `deltaBytes`：当 `revisionCount >= 15` 或 $\text{deltaBytes} > 0.25 \times \text{originalSize}$ 时，在后台空闲时或关闭文档时提示/静默触发一次 Rust 流式线性重写（Linear Compaction GC），清理孤儿对象。

---

### 3.2 演示文稿与媒体管线（`apps/slides` & `docs`）：补齐最后 40% 缺口

既然 `chaoffice-slide-media://` 与 `chaoffice-docx-media://` 已经落地，无需推倒重建，重点定点清除三个内存泄漏与卡顿源：

1. **音视频彻底去 Base64 化（重构 `slides-main.ts:4362-4379`）**
   * 废弃返回 `data:${mime};base64,...` 的 `slides:media-data` IPC 接口。
   * 在现有的 `chaoffice-slide-media://` 协议处理器中增加标准 HTTP **`206 Partial Content`（Byte-Range）** 支持：对于 ZIP 内以 `STORE`（未压缩，常见于 `.mp4`/`.mp3`）方式存储的媒体，直接基于原 ZIP 文件偏移量 `fs.createReadStream({ start, end })` 零内存切片直出；对于 `DEFLATE` 存储的媒体，首次访问时后台流式落盘至会话临时目录后按 Range 供给 `<video>` / `<audio>` 标签。
2. **图片解码缓存驱逐与按需降采样（修复 `image-loader.ts:103-111`）**
   * 将 `image-loader.ts` 中只增不减的图片缓存 `Map` 替换为 **带字节预算上限（如最大 $128\text{ MB}$ 解码位图预算）的 LRU Cache**，淘汰条目时若为 `ImageBitmap` 显式调用 `.close()` 释放显存。
   * 在 `chaoffice-slide-media://` 与 `chaoffice-docx-media://` 协议层支持 `?maxW=1600` 查询参数（利用 Electron `nativeImage` 或 Rust `image` 库在主进程缩放后再送入渲染器，将 $8\text{ K}$ 原图的单张 RGBA 显存从 $\approx 130\text{ MB}$ 压至 $< 6\text{ MB}$）。
   * **保留现有缩略图渲染一致性**：继续沿用 `use-visible-thumbs.ts:4-6` 的 `IntersectionObserver` 窗口化方案，**不强行替换为 Rust 离屏 WebP 生成**，以完整保留前端现有的 EMF 栅格化与主题色动态重着色（Theme Recoloring）管线一致性；针对 `image-loader.ts:24-28` 的 EMF 栅格化，将其输出从 Base64 字符串改为落盘临时缓存文件并通过媒体协议加载。

---

### 3.3 表格引擎与归档门禁（`apps/sheets` / `packages/zip-gate`）：`sharedStrings` 核外化、门禁预算化与 ZIP64 放行

基于 `apps/sheets/native/xlsx-engine` 已有的 `CHUNK_ROW_COUNT = 256` 分块架构与 Univer 视口窗口驱逐能力，无需大改前端架构，聚焦三处精准手术：

1. **`sharedStrings` Mmap 偏移索引化（改造 `workbook.rs:507`、`lib.rs:704`）**
   * 当共享字符串表超过阈值时，不再一次性构造 `Arc<Vec<SharedString>>` 字符串对象池。
   * Open 阶段由 `xlsx-engine` 将 `xl/sharedStrings.xml` 流式解压到会话临时文件并执行 `memmap2::Mmap` 映射，内存中仅保留紧凑偏移索引 `Vec<StringSliceMeta>`（每项 `offset: u64` + `end_or_flags` 共 $16\text{ Bytes}$——`offset` 单项装不下终点与富文本 run 边界；$500$ 万个唯一字符串索引 ≈ $80\text{ MB}$，仍远低于全量字符串池驻留）。
   * 当 `read_range` 命中具体单元格窗口时，才按索引从 `Mmap` 切片按需解码对应窗口内的数十至数百个 UTF-8 字符串。
2. **归档门禁预算化改造（`zip-gate` + `docx-engine/zip-load.ts`，打开路径第一优先）**
   * `DEFAULT_ZIP_LIMITS` 的 `maxPartBytes: 512MB` / `maxTotalBytes: 1.5GB`（`zip-gate/src/index.ts:38-39`）按中央目录声明尺寸在膨胀前硬拒（`index.ts:113-118`）——主流大 docx 的 `document.xml`（解压 1~2GB，$< 4\text{ GB}$，无需 ZIP64）今天正是被这道声明上限挡住。核外流式模式下以**流式膨胀预算**替代绝对上限：保留防炸弹语义（声明尺寸与实际膨胀比双校验），超预算即断流拒绝。
   * **校验与解析合并为一遍**：现行 `verifiedSize` 对每个条目全量膨胀验真（`index.ts:119-121`），JSZip 解析再膨胀第二遍——中段大文件「打开慢」近半耗时在校验。核外路径改为边解压边验真（流式累计实际字节数与声明值实时比对，超差即拒），两遍并一遍。
   * 升级 `zip-gate` 支持解析 `0x06064b50`（ZIP64 End of Central Directory）与 `0x0001` 扩展头，合法放行 $> 4\text{ GB}$ 归档。
3. **按需演进 Sidecar 帧协议**
   * 现行 stdin/stdout JSON 行协议配合 $\le 100\text{k}$ 单元格上限已能稳定工作；仅当压测证实百万行高频滚动受限于 JSON 解析耗时时，再以渐进扩展方式引入长度前缀二进制帧（Length-Prefixed Binary Frame v2），避免对稳定运行的 Sidecar 做无必要重写。

---

### 3.4 Word 核外解析与字节保真流式保存（`packages/docx-engine` 重构）

这是突破 $1\text{ GB}+$ `.docx`「生死线」的核心战役。必须在**完全继承 `patch.ts` 现有字节保真语义**的前提下，解除渲染进程对 `originalXml`、`documentXml` 和 `internal.originalBytes` 的内存依赖。

#### 3.4.1 核外块锚点与 DEFLATE 随机寻址检查点

1. **修正数据结构（防溢出）**：每个顶层块在 `document.xml` 未压缩字节流中的锚点移除 `originalXml: string`，改用定长结构，且针对跨百页巨型表格将预估高度升级为 `u32`：

```rust
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct BlockByteAnchor {
    pub block_id: u64,
    pub docx_index: u32,
    pub byte_start: u64,          // 未压缩 document.xml 中的起始 UTF-8 偏移
    pub byte_end: u64,            // 结束 UTF-8 偏移
    pub block_kind: u8,           // Paragraph / Table / Sdt / SectPr
    pub flags: u8,                // 是否含复杂域/批注/懒媒体引用
    pub estimated_height_px: u32, // 使用 u32 防止超大长表格超过 65535px 溢出
}
```

2. **DEFLATE 检查点随机读取（zran 模型）**：
   后台 Rust 线程首次流式解压 `word/document.xml` 时，每间隔 $2\text{ MB}$ 未压缩数据记录一个 `DeflateCheckpoint`（含压缩流 `compressed_offset: u64`、`bit_offset: u8` 及经 LZ4 压缩的 $32\text{ KB}$ 滑动窗口字典）。提取任意位置的块原始 XML 切片耗时约 $5 \sim 15\text{ ms}$（解压最多 $2\text{ MB}$ 数据流），索引总内存仅 $\approx 8\text{ MB} / \text{GB}$。

#### 3.4.2 重点澄清：流式补丁保存的吞吐率矛盾与两条技术路径

在 $1.2\text{ GB}$ 大文档保存耗时上，必须严格区分两种真实文档构成，并解决单线程重压缩算力瓶颈：

* **场景 A：媒体主导型大文档（经验假设：占实际用户大文件的 $90\%$ 以上，未经 telemetry 验证，以 M0 样本实测修正；如 $1.15\text{ GB}$ 图片/嵌入对象 + $50\text{ MB}$ `document.xml`）**
  依托 `zip-splice.ts` 已有的设计思想（扩展为流式文件管道输出并支持 ZIP64）：所有未修改的 `word/media/*` 条目直接按原 ZIP 中的 **Stored Compressed Bytes 零解压对拷**（NVMe 顺序读写 $< 0.5\text{ s}$；SATA SSD 约 $2\text{ s}$+）；仅对 $50\text{ MB}$ 的 `document.xml` 执行未脏字节拷贝 + 脏块替换 + 流式重压缩（耗时 $\approx 0.4\text{ s}$）。**总保存耗时 NVMe 口径 $0.8 \sim 1.5\text{ s}$，SATA 口径约 $2.5 \sim 3.5\text{ s}$**。

* **场景 B：纯文本/巨表主导型极端文档（解压后仅 `document.xml` 单文件就高达 $1.8\text{ GB}$）**
  若采用常规单线程 `deflate`（约 $60 \sim 120\text{ MB/s}$）将拼接后的 $1.8\text{ GB}$ XML 全量重压缩，仅压缩耗时就高达 **$15 \sim 30\text{ s}$**！为什么不能简单地把脏块前后的原压缩比特直接剪接上去？
  > **技术陷阱揭示（LZ77 跨块回溯污染）**：外部 Word 生成的野生 `document.xml` DEFLATE 流并非在段落边界做 `Z_FULL_FLUSH`。当第 $k$ 块被用户修改后，原文件中第 $k+1$ 块的原始压缩比特流极可能包含指向第 $k$ 块末尾 $32\text{ KB}$ 范围内的 `(length, distance)` 回溯指针！如果直接比特拼接，解压第 $k+1$ 块时就会引用错误字典导致文档损坏。

  针对场景 B，立项阶段通过技术原型（PoC）在以下两条严密方案中择一落地：
  1. **方案 B1（稳健工程首选：多核并行分段 `Z_FULL_FLUSH` 硬件加速压缩）**
     流式拼装出新的 `document.xml` 字节流时，按每 $4\text{ MB}$ 切分为独立块，投入 Rust `rayon` 线程池配合 `zlib-ng`（支持 AVX2 / NEON 指令集加速），以 `Z_SYNC_FLUSH` / `Z_FULL_FLUSH` 边界并行压缩后按序拼接比特流。在主流 8 核桌面 CPU 上吞吐率可达 **$600\text{ MB/s} \sim 1.1\text{ GB/s}$**，$1.8\text{ GB}$ 纯 XML 保存耗时可压至 **$1.8 \sim 3.0\text{ s}$**，且 100% 兼容标准 ZIP 解压器，无比特流边界腐败风险；并且保存后的新文件天然带有独立分段边界，二次保存可直接跳过所有未脏的 $4\text{ MB}$ 压缩段！
  2. **方案 B2（极致进阶：带 $32\text{ KB}$ 脱敏过渡区的压缩域比特拼接）**
     若追求首次保存亦免重压缩：对脏块输出新的 DEFLATE 块后，**额外向后解压并重编码原流紧随其后的 $32\text{ KB}$ 未修改文本（Lookahead Sanitization Zone）**，直到抵达下一个检查点并以空 `Z_SYNC_FLUSH` 块（`00 00 FF FF`）对齐字节边界后，此时后续原压缩流的 $32\text{ KB}$ 滑动窗口已完全由未修改字节填满，方可安全续接后续数 GB 的原始压缩比特流。*（注：该方案需严格处理比特移位重打包，复杂度高，须先做独立模糊测试验证后才可入主线。）*

#### 3.4.3 保持 `patch.ts` 3000 行特性不退化的迁移策略

`packages/docx-engine/src/patch.ts` 承载了极其复杂的表格单元格合并补丁、`rawPPr` 段落属性继承、懒媒体占位还原等细节，用 Rust 一次性重写 3000 行逻辑极易引发大面积回归。采用**「存储流化 + 脏块局部复用 TS 补丁器」**的分步架构：
* **未修改块（占 $99.9\%$）**：渲染进程根本不感知其 XML，由 Rust 保存引擎直接按 `BlockByteAnchor` 的 `[byte_start, byte_end]` 从原流拷贝字节。
* **已修改脏块（通常仅几十个）**：保存前，主进程通过检查点从原 `document.xml` 按需提取这几十个脏块对应的 `originalXml` 切片，**直接喂给现有的 TypeScript `patch.ts` 单块补丁函数**生成字节保真的新 XML 片段，再交由 Rust 流式拼装器写出！这样既实现了 $1\text{ GB}$ 核外流式保存，又 **100% 复用了 `patch.ts` 现有的局部补丁逻辑，将重写风险降到最低**。

---

### 3.5 编辑器视口虚拟化（`apps/docs`）：解耦保存契约与滑动窗口

这是全案**交互复杂度与风险最高**的模块，必须在完成 `3.4`（使保存不再依赖渲染进程持有完整 `parsed.internal.originalBytes` 与全量 `state.doc`）之后方可推进。**P2 交付的只读窗口形态（按锚点取块 → 渲染 → 驱逐，无编辑无 Undo）作为本阶段的独立验收门先行落地**——它是「打不开→能打开」核心目标的最短兑现路径，也为 P3 的编辑窗口化先垫平滚动锚点补偿等基础机制。

1. **前置解耦：重构 Renderer $\leftrightarrow$ Main 保存契约（`parsed.internal` 下沉，现渲染进程于 `patch.ts:1009` 解构持有全文与全包字节）**
   * 将 `sessionId` 作为文档唯一句柄；`originalBytes` 与全量块锚点表下沉至主进程/Rust 会话层。
   * 渲染进程仅维护 `DirtyBlockRegistry: Map<blockId, SaveBlockPatch>`。当块在编辑器中被修改时，通过 ProseMirror `appendTransaction` 钩子标记脏状态；即使该块随后因滚动被移出 ProseMirror 活跃窗口，其修改后的块级 JSON/补丁依然持久化在会话级 `DirtyBlockRegistry`（超量可溢写 IndexedDB/主进程临时表）中。
2. **增量头尾裁剪窗口（替代全文档 `replaceWith`）**
   * 绝不能在滚动换页时对整个文档执行 `tr.replaceWith(0, doc.content.size, ...)`——那会导致光标选区丢失、输入法（IME）中断及严重的 GC 抖动。
   * **增量双向链表式挂载**：维持活跃窗口约 $160$ 个块。向下滚动越过缓冲区阈值时，仅在文档末尾执行一次 `tr.insert(doc.content.size, nextBatchNodes)`（每次仅小批量挂载 $20 \sim 30$ 个块），同时在文档头部执行 `tr.delete(0, removedHeadSize)`，并在同一帧同步读取头部被删 DOM 的精确高度差 $\Delta H$，累加至顶部占位容器 `paddingTop` 并补偿 `scrollTop`，实现**零视觉跳动、零选区丢失**的平滑滑动。
3. **跨窗口逻辑历史栈（Block-Addressed Undo/Redo）**
   * 禁用 ProseMirror 内置基于绝对文档偏移 `pos` 的 `prosemirror-history`（因为头部卸载块会导致全局 `pos` 漂移，使旧 `StepMap` 失效）。
   * 构建基于 `(blockId, localOffset)` 的块寻址历史管理器：每次用户编辑事务记录变更前后的单块 JSON 快照（或块内局部 `Step`）。触发 `Ctrl+Z` 时，若目标 `blockId` 在当前活跃窗口内，直接映射局部偏移应用反向 `Step`；若目标 `blockId` 已被卸载出视口，先驱动虚拟滚动控制器定位将该 `blockId` 所在区间水合进视口，再恢复块状态与选区焦点。

---

## 4. 修正后的性能与资源预期指标（实事求是基准）

以两类典型 $1.2\text{ GB}$ 超大 `.docx` 文档在主流 8 核 / 16GB 桌面设备（Desktop 核外模式）下的表现作为验收基准：

| 核心维度 | 现行架构表现（Baseline） | 改造后目标水位（Desktop 核外架构） | 关键技术支撑点 |
| :--- | :--- | :--- | :--- |
| **可打开性（超 23 万权重 / 声明超限 / ZIP64）** | 硬拒打开（权重 `large-document.ts:18`、门禁声明上限 `zip-gate:113-118`、ZIP64 `zip-gate:156`）或 V8 字符串超限崩溃 | **无上限打开**（支持 $> 4\text{ GB}$ ZIP64 及百万级段落；P2 先兑现只读窗口形态，P3 兑现完整编辑） | 门禁预算化 + ZIP64 放行 + Mmap + 移除 `document.xml` 整串读入 |
| **首屏可交互时间 (TTI)** | 大文档数十秒白屏或直接报错 | **$300\text{ ms} \sim 800\text{ ms}$**（首屏 64 块水合即交付，后台异步建检查点索引） | 首屏流式截断解析 + 异步核外锚点扫描 |
| **渲染进程常驻内存 (Renderer RSS)** | 随文件线性暴涨至 $> 4\text{ GB}$ OOM | **$180\text{ MB} \sim 350\text{ MB}$**（与文件体积脱钩，受窗口与 LRU 预算严格封顶） | 活跃块滑动窗口 + 图片位图 LRU 驱逐 + 剥离 `originalBytes` |
| **保存耗时（媒体主导型 $1.2\text{ GB}$）** | 内存重建整包 `Uint8Array` 崩溃或 $> 30\text{ s}$ | **$0.8\text{ s} \sim 1.8\text{ s}$**（NVMe 口径，SATA 约 ×2~3） | `zip-splice` 媒体原压缩流直拷 + 局部调用 `patch.ts` |
| **保存耗时（纯文本 $1.8\text{ GB}$ XML）** | 无法完成 | **$2.0\text{ s} \sim 3.5\text{ s}$**（多核 `zlib-ng` 分段并行压缩） | $4\text{ MB}$ 分段多线程硬件加速 DEFLATE（首次保存后二次保存 $< 1\text{ s}$） |

---

## 5. 按「真实剩余缺口 $\times$ 风险」重排的分阶段施工路线图

摒弃低估复杂度的排期，按照**「先收割低风险高收益存量先例，再做底层核外解耦，最后攻坚高风险编辑器虚拟化」**的工程顺序推进：

### P0 阶段：低风险速赢——PDF 增量流式化 + Slides 媒体闭环（预计 1.5 ~ 2 周）
* **工程目标**：不触碰复杂富文本内核，快速消灭 PDF 与大体积多媒体 PPT 的内存爆炸现场事故。
* **核心任务**：
  1. `apps/pdf`：基于 `Range` / 文件偏移改造 `file-bytes.ts` 移除渲染层全包字节拼接；参照 `pdf-sign.ts:387` 改造 `save-pdf.ts` 落地通用增量更新保存（CoW/非 CoW 分档，见 3.1）与超阈值 Compaction 回收。
  2. `apps/slides`：为 `chaoffice-slide-media://` 增加 HTTP `206 Range` 流式支持，下线 `slides-main.ts:4362` 的音视频 Base64 IPC；将 `image-loader.ts:103` 无界缓存改造为带显存预算的 LRU Cache，并将 EMF 栅格化结果改为临时文件协议供给；补充 `?maxW` 缩放参数。

### P1 阶段：基础设施破壁——归档门禁预算化 + ZIP64 放行 + Sheets `sharedStrings` Mmap 化（预计 1.5 ~ 2 周）
* **工程目标**：解除门禁声明上限第一墙（主流大 docx 被拒的直接原因），打通 $> 4\text{ GB}$ 归档，消除百万行大表格的 Rust 侧字符串内存峰值与可开 band 的两遍全量解压开销。
* **核心任务**：
  1. `packages/zip-gate` & `zip-splice.ts`：**声明上限预算化（第一优先）**——`maxPartBytes: 512MB` / `maxTotalBytes: 1.5GB`（`zip-gate/src/index.ts:38-39`，`index.ts:113-118` 膨胀前按声明尺寸硬拒）改造为核外路径的流式膨胀预算 + 压缩比门禁；**校验并一遍**——`verifiedSize` 验真（`index.ts:119-121`）与流式解析合并，消除双重全量解压；补齐 ZIP64 Central Directory 解析与校验，解除硬拒限制。
  2. `apps/sheets/native/xlsx-engine`：改造 `workbook.rs:507` 与 `lib.rs:704`，对超阈值 `sharedStrings.xml` 实现临时文件 `memmap2` + 偏移数组按需解码。

### P2 阶段：核心深水区——`docx-engine` 核外检查点索引与流式拼接保存（预计 4 ~ 6 周）
* **工程目标**：突破 V8 $512\text{ MB}$ 字符串死穴，实现 `docx` 流式首屏解析与复用 `patch.ts` 单块语义的核外保存，同时保证 CLI 与 `doc2docx` 等全仓消费方零回归。
* **验收门（关键）**：P2 完成时渲染端仍是全量挂载（编辑虚拟化在 P3），因此 **P2 的「打开」验收形态为只读窗口模式**——超大文档以流式首屏 + 只读虚拟窗口打开（无编辑无 Undo），即兑现「打不开 → 能打开」的核心目标；TTI/RSS 完整指标中与编辑相关的部分以 P3 验收为准，避免核心目标被高风险的 P3 拖住。
* **核心任务**：
  1. **PoC 先行（第 1 周）**：独立验证 Rust `DeflateCheckpoint` 随机提取性能，以及 `zlib-ng` 多核分段 `Z_FULL_FLUSH` 流式压缩（对比比特级拼接方案）的吞吐率与 Word 兼容性。
  2. **核外解析与索引（第 2~3 周）**：实现 `quick-xml` 流式扫描器，首屏优先返回前 64 块，后台生成 `BlockByteAnchor`（`u32` 高度）与 SQLite FTS5 全文检索表（对接 `agent-core` 核外检索工具）。
  3. **保存契约解耦与混合补丁管线（第 4~6 周）**：剥离渲染进程的 `internal.originalBytes` 与 `documentXml`；实现「未脏区间 Rust 流式直拷 + 脏块提取原切片调用 TS `patch.ts` 局部补丁」的混合保存管线，并编写 Desktop / Server / Web 三端 Storage Adapter 及回归测试集。

### P3 阶段：最高风险攻坚——`apps/docs` ProseMirror 滑动窗口与块寻址 Undo 栈（预计 4 ~ 6 周）
* **工程目标**：彻底移除 `large-document.ts` 的只读与拒开限制，实现十万页级文档丝滑滚动与完整编辑体验。
* **核心任务**：
  1. **独立原型验证（第 1~2 周）**：在主线外构建最小原型，攻克「增量头尾节点裁剪时的滚动锚点补偿（Scroll Anchor Compensation）」、「IME 输入态保护」与「基于 `(blockId, localOffset)` 的跨窗口 Undo/Redo 历史栈」。
  2. **主线集成与边缘特性适配（第 3~6 周）**：接入 `DirtyBlockRegistry` 会话存储；将全文查找替换下沉至 P2 构建的 Rust 流式搜索/FTS5 索引；联调跨窗口选区复制、大纲跳页与 AI Agent 局部块改写。