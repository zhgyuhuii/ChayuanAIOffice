# 察元 AI Office (`chayuan-office`) 超大文档（1GB+）性能优化与核外架构深度解析

## 1. 背景与问题定性：为什么 1GB+ 文档是现有架构的「生死线」

`chayuan-office` 采用 **npm workspaces Monorepo（TypeScript + Rust 混合架构 + Electron 宿主）**，其最具辨识度的核心架构是 **「归档原件 + 块级锚定 + 补丁式保存」** 的字节保真（Byte-Fidelity）设计。这一架构确保了在编辑 `.docx` / `.xlsx` / `.pptx` 时，未修改的复杂 OOXML 标签、宏、自定义扩展属性能够零损回写。

然而，当文档体积从常规的数兆字节上升到 $100\text{ MB}$ 甚至 $\ge 1\text{ GB}$ 量级时，传统的「内存驻留型（In-Memory）」前端编辑器架构不仅会出现卡顿，更会直接触碰底层运行时的物理硬极限而崩溃：

### 1.1 三大物理硬极限（Hard Limits）

1. **V8 引擎单字符串长度极限（约 $512\text{ MB}$）**
   在 V8 引擎中，单个 `String` 对象的最大长度被硬编码限制在 $2^{29} - 24$ 个字符（约 $5.36 \times 10^8$ 字符）。一个 $1\text{ GB}$ 的 `.docx` 或 `.xlsx` 压缩包，其内部的 `word/document.xml` 或 `xl/worksheets/sheet1.xml` 解压后往往高达 $3\text{ GB} \sim 8\text{ GB}$。一旦调用 `TextDecoder` 或作为完整字符串读入 JS，会立即抛出 `RangeError: Invalid string length`。
2. **Electron 渲染进程堆内存上限（约 $4\text{ GB}$）**
   Chromium 渲染进程默认受限于 V8 指针压缩（Pointer Compression）机制，堆上限通常在 $4\text{ GB}$ 左右。在现有的多重对象拷贝模型下，即使是一个 $250\text{ MB}$ 的纯文本/表格文档，经过 $8\times \sim 15\times$ 的内存放大后也会触发 `FatalProcessOutOfMemory`。
3. **ZIP/DEFLATE 压缩流不可随机寻址困境**
   `.docx` / `.xlsx` / `.pptx` 本质上是 ZIP 归档（超过 $4\text{ GB}$ 时升级为 ZIP64），其内部 XML 条目采用 `DEFLATE` 算法流式压缩。`DEFLATE` 依赖滑动窗口字典，天然不支持 $O(1)$ 随机字节跳转——如果不加索引改造，哪怕只想读取第 $5000$ 页的一行字，也必须从第 $1$ 字节开始顺序解压数 GB 的 XML 流。

---

## 2. 现有代码库核心瓶颈全链路拆解

结合 `chayuan-office` 各核心包职责，当前打开大文档慢、内存居高不下的根因可归纳为**「四重内存放大」**与**「全量同步水合」**：

| 涉及模块 / 目录 | 当前实现机制 | 1GB+ 场景下的致命表现 | 内存放大系数 |
| :--- | :--- | :--- | :--- |
| **`packages/zip-gate` & `file-parse`** | 原 ZIP 字节流读入内存，解压条目常驻；`document.xml` 解析为块树时，每个顶层块保存 `docxIndex` 与**原始 XML 字符串切片副本** | 产生数十万至数百万个切片字符串与 AST 对象，直接打爆 V8 老生代堆内存（Old Space）与 GC | $8\times \sim 15\times$ |
| **`apps/docs` (Tiptap / ProseMirror)** | 调用 `EditorState.create` 一次性实例化全量 `Node` 树，并在浏览器中同步挂载所有段落/表格真实 DOM，叠加 `HarfBuzz (wasm)` 排版度量 | 数十万 DOM 节点同步 Layout / Reflow，UI 主线程假死数十秒乃至数分钟 | $5\times \sim 10\times$ |
| **`xlsx-gateway` (Rust) & `apps/sheets`** | `calamine` + `IronCalc` Sidecar 解析虽快，但通过 IPC/HTTP JSON 全量序列化工作簿单元格与样式传输至前端 | 百万级单元格 JSON 序列化产生数 GB 临时字符串峰值，前端反序列化瞬间崩溃 | $10\times+$ |
| **`apps/slides` & 媒体管线** | `word/media/*`、`ppt/media/*` 高清大图全量解压为 `Uint8Array` 或转为 `data:image/*;base64` 内联注入编辑器与 `Konva` 图层 | 1GB 多媒体 PPT/Word 中 95% 为媒体资源，Base64 体积膨胀 $1.33\times$ 且无法被浏览器按视口卸载纹理 | $2.5\times \sim 4\times$ |
| **`apps/pdf` (`pdf.js` + `pdf-lib`)** | 浏览与真编辑双引擎并存，打开大 PDF 时同步执行 `PDFDocument.load(fullBytes)` 解析全量交叉引用表（XRef）与对象树 | 1GB PDF 在内存中存在两套完整二进制缓冲与对象树，首屏白屏极长 | $3\times \sim 6\times$ |
| **`agent-core` / 安全快照** | 写回前在内存中克隆原文件快照，或打开瞬间扫描全文构建 AI 上下文索引 | 瞬间翻倍拷贝 $1\text{ GB}$ `ArrayBuffer`，抢占首屏 IO 与 CPU 核心 | $2\times$ |

---

## 3. 面向 1GB+ 文档的目标架构：核外计算（Out-of-Core Architecture）

要让 $1\text{ GB}$ 甚至 $10\text{ GB}$ 的文档实现 **「亚秒级首屏打开（$< 500\text{ ms}$）」** 且 **「渲染进程常驻内存恒定在 $< 300\text{ MB}$」**，核心原则只有一条：**任何时候，渲染进程（JavaScript / DOM）只持有当前视口（Viewport）上下有限窗口的数据；完整文件永远留在磁盘与 Rust 核外引擎中。**

### 3.1 全栈分层架构图

```
+-----------------------------------------------------------------------------------+
|                        Electron Renderer Process (内存预算 < 300MB)                |
|                                                                                   |
|  +-----------------------+   +-----------------------+   +---------------------+  |
|  | apps/docs             |   | apps/sheets           |   | apps/pdf & slides   |  |
|  | 虚拟分片文档窗口       |   | Canvas 视口瓦片渲染器  |   | Range 按需分页渲染   |  |
|  | (仅挂载活跃 150 个块)  |   | (仅缓存可见 Tile 矩阵) |   | 协议流式降采样纹理   |  |
|  +-----------+-----------+   +-----------+-----------+   +----------+----------+  |
|              | 二进制紧凑帧 / 块分页请求  | Arrow/Binary IPC         | chaoffice:// |
+--------------+---------------------------+--------------------------+-------------+
               |                           |                          |
===============|===========================|==========================|==============
               v                           v                          v
+-----------------------------------------------------------------------------------+
|                 Rust Native Core / Sidecar Engine (核外存储与流式计算层)             |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  | 1. Zero-Copy Archive Manager (zip-gate-rs)                                  |  |
|  |    - OS Mmap 虚拟内存映射 (支持 ZIP64 > 4GB，零物理内存预占)                  |  |
|  |    - DEFLATE Checkpoint Span Index (每 2MB 解压流建立 32KB 窗口锚点，随机寻址)|  |
|  +-----------------------------------------------------------------------------+  |
|  | 2. Streaming Parser & Out-of-Core Indexer (file-parse-rs + SQLite/LMDB)     |  |
|  |    - quick-xml 状态机流式扫描，仅记录 64-bit [byte_start, byte_end] 偏移      |  |
|  |    - 块级元数据、大纲目录、稀疏单元格落盘至临时页缓存库 (.chaoffice-swap)      |  |
|  +-----------------------------------------------------------------------------+  |
|  | 3. Streaming Patch Writer (流式补丁拼装器)                                   |  |
|  |    - 未脏区间直接从原流 Zero-Copy 管道对拷，脏块局部替换并流式重压缩写入新文件 |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 4. 六大核心子系统深度改造方案

### 4.1 归档与存储层（`packages/zip-gate` Rust 化）：突破 ZIP64 与 DEFLATE 随机寻址

对于 $1\text{ GB}+$ 的 `.docx` / `.xlsx` 文件，绝不能把 ZIP 文件读进 `Buffer`，也不能把整个 `document.xml` 解压到内存中。

#### 方案设计：Mmap + DEFLATE 检查点索引（Span Indexing）
1. **文件虚拟内存映射（`memmap2`）**：使用操作系统级 `mmap` 打开 $1\text{ GB}+$ 文件。此时物理内存（RSS）占用接近 $0\text{ MB}$，由操作系统内核页缓存（Page Cache）按 $4\text{ KB}$ 页按需调入与淘汰。同时启用 `ZIP64` 解析支持大于 $4\text{ GB}$ 的压缩/未压缩流。
2. **流式构建 DEFLATE 访问检查点（Access Points）**：
   借鉴 `zlib` 的 `gzran` 原理，后台线程首次流式扫描超大 XML 条目时，每解压出 $2\text{ MB}$ 数据，记录一次当前的 **压缩流比特偏移量（Compressed Bit Offset）** 以及 **前 $32\text{ KB}$ 滑动窗口字典（Sliding Window Dictionary）**（可通过 `zstd` 极速压缩至约 $8\text{ KB}$ 存入内存/磁盘索引）。
   - 对于一个解压后 $4\text{ GB}$ 的巨型 `document.xml`，共产生 $2000$ 个检查点，索引总内存仅 $2000 \times 8\text{ KB} \approx 16\text{ MB}$！
   - 之后任意读取第 $3.5\text{ GB}$ 处的某个段落 XML 时，只需定位到最近的检查点，注入 $32\text{ KB}$ 字典，最多解压 $< 2\text{ MB}$ 数据即可在 $2\text{ ms}$ 内精确提取目标字节切片。

```rust
// crates/zip-gate-rs/src/checkpoint.rs
use serde::{Deserialize, Serialize};

/// DEFLATE 随机访问检查点：支持在数 GB 压缩 XML 流中实现 O(1) 近似随机跳转
#[derive(Clone, Serialize, Deserialize)]
pub struct DeflateCheckpoint {
    /// 未压缩 XML 流中的精确字节偏移量 (支持 > 4GB，使用 u64)
    pub uncompressed_offset: u64,
    /// 原 ZIP 条目压缩流中的字节偏移量
    pub compressed_offset: u64,
    /// 当前字节内的比特偏移 (0..7)
    pub bit_offset: u8,
    /// LZ77 32KB 历史滑动窗口字典（经 LZ4 压缩后约 6~10KB）
    pub compressed_window: Vec<u8>,
}

/// 顶层块字节保真锚点（完全取代前端内存中的 rawXml: string）
#[repr(C)]
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct BlockByteAnchor {
    pub block_id: u64,
    pub docx_index: u32,
    /// 在未压缩 document.xml 中的起始 UTF-8 字节偏移
    pub byte_start: u64,
    /// 在未压缩 document.xml 中的结束 UTF-8 字节偏移
    pub byte_end: u64,
    /// 块类型标记：0=Paragraph, 1=Table, 2=SectPr, 3=Sdt...
    pub block_kind: u8,
    /// 估算渲染高度（用于前端虚拟滚动条精确计算总高度）
    pub estimated_height_px: u16,
}
```

---

### 4.2 解析与字节保真层（`packages/file-parse`）：$O(1)$ 状态机与核外块索引

当前架构将每个块的原始 XML 切片保存在 JS 对象上以备未修改回写，这是内存放大的核心源头。

#### 方案设计：两阶段流式扫描（Fast First-Screen + Background Indexing）
1. **第一阶段：首屏极速交付（耗时 $< 80\text{ ms}$）**
   打开 $1\text{ GB}$ 文档时，Rust 端的 `quick-xml` 事件流解析器从 `word/document.xml` 头部开始扫描，一旦解析满前 **60 个顶层块**（如 `<w:p>` 或 `<w:tbl>`），**立即暂停或转入后台线程**，将这 60 个块的结构化 AST 返回给前端渲染首屏。用户无需等待整个 $1\text{ GB}$ 文件扫描完毕即可开始阅读甚至编辑第一页！
2. **第二阶段：后台流式建立 `BlockByteAnchor` 核外索引**
   后台工作线程以 $300\text{ MB/s}+$ 的速度流式扫过剩余的 `document.xml`，**不生成任何 AST 对象，也不保留任何 XML 字符串**，只追踪标签嵌套深度（Depth == 2 的 `<w:body>` 直接子节点），提取：
   - 每个块的 `[byte_start, byte_end]`（`u64` 整数对）；
   - 大纲标题文本（若包含 `<w:outlineLvl>` 或 `Heading` 样式，直接生成目录树供大纲视图和 AI 导航使用）；
   - 将数百万个 `BlockByteAnchor` 写入本地临时嵌入式库（SQLite WAL 模式或 `LMDB` 内存映射库）。即使文档有 $1,000,000$ 个段落，索引体积也仅有 $10^6 \times 32\text{ Bytes} \approx 32\text{ MB}$。
3. **流式补丁式保存（Streaming Patch Save）**
   保存文件时，前端仅把用户修改过的块（`dirtyBlocks: Map<blockId, newOoxmlString>`）传给 Rust。Rust 按 `byte_start` 排序遍历修改记录：
   - 未修改区间 $[prev\_end, dirty.byte\_start)$：直接从原解压流管道流式拷贝字节到新 ZIP 压缩流；
   - 已修改块：写入 `newOoxmlString` 的 UTF-8 字节；
   - 全程内存峰值不超过 $16\text{ MB}$ 缓冲区，彻底保持「字节保真」特性且支持任意 GB 级文档保存。

---

### 4.3 富文本编辑器层（`apps/docs`）：突破 ProseMirror 单文档树极限

即使后端做到了零内存驻留，如果把 50 万个段落塞进同一个 Tiptap / ProseMirror `EditorState`，仅 ProseMirror 的 `Node` 实例树就会占用 $> 2\text{ GB}$ 内存，且每次按键输入触发的 `tr.docChanged` 树结构共享拷贝与坐标重算都会带来严重掉帧。

#### 方案设计：滑动窗口文档模型（Sliding Window ProseMirror Document）
针对超大文档（当块总数 $> 2000$ 时自动激活核外虚拟分页模式）：

1. **虚拟视口控制器（Virtual Document Viewport）**
   外层容器根据 Rust 端汇报的总块数及 `estimated_height_px` 前缀和数组（Prefix Sum Array / 树状数组 Fenwick Tree，支持 $O(\log N)$ 动态更新行高与偏移定位）撑开真实滚动条高度（注意：当像素总高度超过浏览器单 DOM 极限约 $1.6 \times 10^7\text{ px}$ 时，采用**虚拟缩放滚动条比例映射**）。
2. **ProseMirror 仅装载活跃窗口（Active Window = 150 Blocks）**
   ProseMirror 实例的 `state.doc` 中**永远只存在当前视口可见块及其上下缓冲区的 150 个块**！
   - 当用户向下滚动跨越阈值（例如距离窗口底部不足 40 个块）时，向 Rust IPC 请求下一批 60 个块的 AST；
   - 使用带有 `tr.setMeta('addToHistory', false)` 的静默事务（Transaction），在文档尾部 `insert` 新块，同时在文档头部 `delete` 滚出视野最远的 60 个块（若头部被卸载的块有未保存的本地编辑，先序列化存入本地 `DirtyBlockStore` 缓存池）。
3. **跨窗口选区、查找替换与撤销栈（Undo/Redo）适配**
   - **查找与替换**：不再依赖 ProseMirror 内存树遍历，直接下沉至 Rust 引擎流式正则/Aho-Corasick 匹配，返回匹配块的 `block_id` 列表，点击跳转时直接将该 `block_id` 所在窗口水合进视口。
   - **独立块级/事务级 Undo 栈**：重写历史插件，记录基于全局 `block_id` 与块内相对 `pos` 的变更补丁，使得即使某个块滚出视口被卸载，按下 `Ctrl+Z` 时依然能定位跳回该块位置、重新挂载并恢复变更。

```typescript
// apps/docs/src/core/virtual-window-manager.ts
import { EditorView } from '@tiptap/pm/view';

export interface WindowRange {
  startBlockIndex: number;
  endBlockIndex: number; // 始终保持 end - start <= MAX_ACTIVE_BLOCKS (如 150)
}

export class VirtualDocWindowManager {
  private readonly MAX_WINDOW_SIZE = 150;
  private readonly BUFFER_THRESHOLD = 35;
  private dirtyBlockXmlCache = new Map<number, Record<string, unknown>>(); // blockId -> PM JSON

  constructor(
    private view: EditorView,
    private docSessionId: string,
    private ipcBridge: {
      fetchBlockSlice: (sessionId: string, start: number, count: number) => Promise<any[]>;
    }
  ) {}

  /** 滚动到任意全局块索引（支持百万段落秒跳） */
  async jumpToBlock(targetIndex: number): Promise<void> {
    this.flushDirtyBlocksFromCurrentWindow();

    const start = Math.max(0, targetIndex - Math.floor(this.MAX_WINDOW_SIZE / 2));
    const blocksJson = await this.ipcBridge.fetchBlockSlice(
      this.docSessionId,
      start,
      this.MAX_WINDOW_SIZE
    );

    // 优先用本地已修改缓存覆盖原始解析块
    const hydratedNodes = blocksJson.map((raw) => {
      const cached = this.dirtyBlockXmlCache.get(raw.attrs.blockId);
      return this.view.state.schema.nodeFromJSON(cached ?? raw);
    });

    const tr = this.view.state.tr.replaceWith(
      0,
      this.view.state.doc.content.size,
      hydratedNodes
    );
    // 关键：窗口换页本身绝不污染用户的 Undo/Redo 历史栈
    tr.setMeta('addToHistory', false);
    tr.setMeta('virtualWindowShift', { startBlockIndex: start });
    this.view.dispatch(tr);
  }

  private flushDirtyBlocksFromCurrentWindow(): void {
    this.view.state.doc.forEach((node) => {
      if (node.attrs?.dirty) {
        this.dirtyBlockXmlCache.set(node.attrs.blockId, node.toJSON());
      }
    });
  }
}
```

---

### 4.4 电子表格引擎层（`xlsx-gateway` & `apps/sheets`）：百万行级流式网格与二进制 IPC

1GB 的 `.xlsx` 往往包含百万行（$1,048,576$ 行）乘以数十列的数据。`calamine` 如果一次性构建全表 DOM 或通过 JSON 发给渲染进程，必然触发内存爆炸。

#### 方案设计：流式稀疏块存储 + 二进制 Tile 视口协议
1. **SharedStrings 字符串池核外映射**
   超大 `.xlsx` 中，`xl/sharedStrings.xml` 本身就可能高达 $500\text{ MB}$。Rust 端采用 `mmap` + 偏移量数组（`Vec<u64>`）索引 `sharedStrings.xml`，而不将数百万个字符串实例化到堆内存中。
2. **工作表分块懒加载（Chunked Tile Storage）**
   按 `256 行 × 32 列` 将工作表划分为二维数据瓦片（Tile）。打开文件时仅流式读取激活 Sheet 的第 `(0, 0)` 号瓦片（即 `A1:AF256`），**首屏可在 $100\text{ ms}$ 内渲染完毕**。后台线程流式扫描剩余行，将瓦片序列化压缩后写入磁盘页缓存，并在后台构建 `IronCalc` 稀疏依赖图。
3. **零 JSON 跨进程传输：采用紧凑二进制缓冲区（Flat Binary / Apache Arrow）**
   前端 Canvas 表格滚动请求某个可见区瓦片时，Rust 直接返回对齐的 `ArrayBuffer`（通过 Electron `MessagePortMain` 零拷贝传输或 `SharedArrayBuffer`）：

```
+------------------------+------------------------+-------------------------+
| Header (16 Bytes)      | Cell Type & Style IDs  | Values & String Offsets |
| rows, cols, cell_count | Uint32Array[N]         | Float64Array[N] + UTF8  |
+------------------------+------------------------+-------------------------+
```

前端 Canvas 渲染器直接通过 `DataView` / `Float64Array` 读取坐标、数值与全局去重样式表 ID 进行绘制，**全程在 V8 中产生 0 个单元格临时 Object**，百万行滚动帧率稳定在 $60\text{ FPS}$/$120\text{ FPS}$。

---

### 4.5 媒体管线与画布层（`apps/slides` / `docs`）：流式协议与实时降采样（Mipmap）

许多超过 $1\text{ GB}$ 的 `.pptx` 或 `.docx` 是因为嵌入了上百张 $4\text{ K}$/$8\text{ K}$ 未压缩位图（BMP/TIFF/PNG）或音视频文件。

#### 方案设计：彻底消灭 Base64，引入 `chaoffice-media://` 流式解码管线
1. **Electron 主进程自定义流式协议**
   在 `apps/shell` 中通过 `protocol.handle('chaoffice-media', handler)` 拦截所有文档内部媒体请求：
   - 解析器遇到 `<a:blip r:embed="rId5"/>` 时，只查询 `.rels` 关系表将其转换为 URL：`chaoffice-media://{sessionId}/ppt/media/image5.png?maxW=1280`。**解析阶段读取图片字节数为 $0$！**
   - 视频/音频资源天然支持 HTTP `206 Partial Content`（Range 请求），由 Rust 从归档流按块流式输出，支持百兆内嵌视频即点即播。
2. **Rust 端实时尺寸自适应降采样（On-the-fly Downsampling）**
   一张 $8000 \times 6000$ 的 PNG 解码为 RGBA 位图后在 GPU/RAM 中占用 $8000 \times 6000 \times 4 \approx 192\text{ MB}$！十张图就会撑爆显存。
   - 协议处理器收到带 `?maxW=1280`（编辑态屏幕显示尺寸）的请求时，由 Rust `image` / `libvips` 流式解码并快速缩放到宽度 $1280\text{ px}$（显存占用暴降至 $4.9\text{ MB}$，下降 **97%**），并缓存在本地磁盘缩略图池中；
   - 仅当用户执行「导出高清 PDF / 打印」或放大画布超过 $200\%$ 时，才按需请求原图分辨率。
3. **`Konva` / 画布纹理 LRU 回收池**
   在 `apps/slides` 中，仅实例化当前激活幻灯片及前后各 1 页的 `Konva.Stage`；左侧缩略图栏全部采用 Rust 离屏生成的低清 WebP 静态图，切换页面时主动对滚出缓存窗口的 `ImageBitmap` 调用 `.close()` 立即释放底层显存，无需等待浏览器 GC。

---

### 4.6 PDF 双引擎彻底解耦（`apps/pdf`）：Range 流式阅读 + 增量追加保存

当前 `apps/pdf` 同时集成了 `pdf.js`（渲染）和 `pdf-lib`（编辑）。对于 $1\text{ GB}$ 的工程图纸或扫描版 PDF，`PDFDocument.load(bytes)` 会一次性解析几十万个 PDF Indirect Objects，直接耗尽内存。

#### 方案设计：读写完全分离 + PDF 增量更新（Incremental Update）
1. **浏览态：纯流式 Range 分片加载**
   配置 `pdf.js` 的 `PDFDataRangeTransport` 对接本地文件句柄，设置 `disableAutoFetch: true` 和 `disableStream: false`。`pdf.js` 会先读取文件末尾的 `xref` 表，之后用户翻到哪一页，才精准读取哪一页对应的数 KB 字节区间。同时严格维护 **最多 5 页活跃 Canvas 池**，离屏页面销毁 Canvas 保留空尺寸容器并调用 `pdfPage.cleanup()`。
2. **编辑态：按需解析单页对象，彻底弃用全量 `pdf-lib` 加载**
   - 当用户双击第 $350$ 页执行「真文本编辑」时，Rust 端使用 `lopdf` 或 `pdf-syntax`（基于 `mmap` 的按需交叉引用解析器）**仅解析第 $350$ 页关联的 Content Stream 与 Font 对象**，`HarfBuzz` 仅提取该页涉及的字形子集。
3. **保存态：利用 PDF 标准「增量更新（Incremental Update）」秒存 1GB 文件**
   PDF 规范（ISO 32000）原生支持在原文件末尾直接追加修改过的对象（New Body + New XRef Section + New Trailer `Prev` 指针），而无需重写前面的 $1\text{ GB}$ 内容！
   - 保存修改后的 $1\text{ GB}$ PDF 时，先通过操作系统写时复制（Copy-on-Write）克隆原文件，随后仅在文件末尾 `append` 几十 KB 的增量对象流，**保存耗时从数十秒降至 $< 20\text{ ms}$**！

---

### 4.7 AI Agent 与写前快照机制（`agent-core` & 安全层）

1. **零内存零耗时的写前快照（Copy-on-Write File Clone）**
   首次写回前的自动备份严禁通过 Node.js 读入 `Buffer` 再写出。直接调用 Rust `std::fs::copy` 或封装平台原生 CoW 系统调用：
   - macOS (`APFS`)：`clonefile()` 系统调用；
   - Windows (`ReFS` / 新版 `Dev Drive`) / Linux (`Btrfs` / `XFS`)：`ioctl(FICLONE)`。
   在支持 CoW 的文件系统上，克隆一个 $2\text{ GB}$ 文档耗时 **$< 1\text{ ms}$**，且额外磁盘与内存占用为 **$0$**；在普通 NTFS/ext4 上也由内核态 DMA 异步拷贝，完全不经过 V8 内存。
2. **AI Agent 核外检索架构（Out-of-Core RAG / Tool-Use）**
   禁止 `agent-core` 在打开大文档时拼接全文 Prompt。在 `4.2` 节后台流式扫描的同时，顺便将块纯文本写入本地 SQLite **FTS5 全文检索引擎**。Agent 被赋予以下核外工具：
   - `get_document_outline()`：毫秒级获取完整标题层级树与对应 `block_id` 范围；
   - `search_document_blocks(keyword_or_query, limit=20)`：通过 FTS5 在百万段落中毫秒级检索相关块；
   - `read_block_range(start_block_id, end_block_id)`：按需读取指定章节内容并修改回写。

---

## 5. 改造前后性能与内存预算对比（以 1.2 GB 复杂图文表混排文档为例）

假设测试样本为一个 $1.2\text{ GB}$ 的大型标书 `.docx`（解压后 `document.xml` 约 $1.8\text{ GB}$，含 $45$ 万个段落、$800$ 个复杂表格、$600$ 张高清图片）：

| 核心指标 | 改造前（现有全量内存架构） | 改造后（核外流式虚拟架构） | 提升幅度 |
| :--- | :--- | :--- | :--- |
| **首屏可交互时间 (TTI)** | 直接崩溃（V8 字符串超限 / OOM） | **$180\text{ ms} \sim 350\text{ ms}$** | 从不可用到亚秒级瞬开 |
| **全文大纲与跳页就绪时间** | 无法完成 | 后台流式扫描约 **$3.5\text{ s}$**（不阻塞前台交互） | 全异步无感索引 |
| **渲染进程常驻内存 (Renderer RSS)** | $> 4096\text{ MB}$（触发 OOM 崩溃） | **$140\text{ MB} \sim 260\text{ MB}$**（恒定水位，与文件大小脱钩） | 内存降低 **$> 93\%$** |
| **Rust 核外引擎物理内存占用** | N/A | **$45\text{ MB} \sim 90\text{ MB}$**（其余由 OS Mmap 页缓存托管） | 极低开销 |
| **修改单段文字后的保存耗时** | 全量序列化重压缩 $> 45\text{ s}$（若未崩溃） | **$0.8\text{ s} \sim 2.5\text{ s}$**（流式字节管道对拷 + 局部补丁） | 提速 **$20\times+$** |

---

## 6. 渐进式工程落地路线图（Phased Roadmap）

为了避免一次性推翻现有业务代码导致回归风险，建议按以下三个阶段平滑演进，且可设置**双模式阈值开关**（例如文件 $< 15\text{ MB}$ 仍走轻量快速通道，$\ge 15\text{ MB}$ 自动切入核外流式引擎）：

### 第一阶段：快速止血与外围降压（预计 1 周，内存立降 50%+）
- [ ] **媒体流式化**：在 `apps/shell` 落地 `protocol.handle('chaoffice-media', ...)`，彻底移除 `file-parse`、`docs`、`slides` 中所有将 ZIP 内图片解压为 Base64 或全量 `Blob` 的逻辑，加入 Rust 端按请求尺寸降采样。
- [ ] **PDF 读写解耦**：在 `apps/pdf` 中移除打开文档时的 `pdf-lib` 预加载，开启 `pdf.js` 流式分片加载与离屏页面 `cleanup()` 销毁池。
- [ ] **零拷贝快照**：将写前快照改为系统级文件克隆/异步流拷贝，禁止在 JS 中复制原归档 `ArrayBuffer`。

### 第二阶段：核外引擎与字节偏移锚定重构（预计 2~3 周，突破 1GB 打开限制）
- [ ] **构建 `zip-gate-rs`**：引入 `memmap2`、ZIP64 支持与 DEFLATE `DeflateCheckpoint` 随机访问检查点索引。
- [ ] **升级 `packages/file-parse`**：用 `quick-xml` 流式状态机替代全量 XML 解析，将每个块保存的 `rawXml: string` 彻底替换为 64 位 `[byte_start, byte_end]` 偏移锚点，落地 SQLite/LMDB 核外块索引与流式补丁拼装保存器。

### 第三阶段：编辑器视口虚拟化与二进制表格协议（预计 3~4 周，实现百万行/十万页丝滑编辑）
- [ ] **`apps/docs` 滑动窗口化**：实现 `VirtualDocWindowManager`，使 ProseMirror 仅装载视口附近的 150 个活跃块，适配跨窗口查找替换与块级 Undo/Redo 历史栈。
- [ ] **`xlsx-gateway` 瓦片化**：改造 Rust 表格 Sidecar，支持 `sharedStrings` 偏移映射、按 `256×32` 瓦片懒加载以及二进制 TypedArray IPC 协议。
- [ ] **`agent-core` 核外化**：对接后台流式生成的 FTS5 全文索引与章节大纲树，实现超大文档的毫秒级 AI 检索与局部块安全改写。