# 察元知识库(harness chatop-kb)接入方案——自动发现 + 对话检索增强

状态:**方案定稿(2026-09-18),未施工**。范围:仅 chayuan-office 仓内改动,**零 harness 侧改动**。
关联:`docs/dsh 形态模型配置融合方案`(settings-source createHarnessSource 已定稿);本方案与其共享 origin 发现机制,但**不依赖**其 resolveHarnessSecret 缺口(P0)——KB 通路全程无需任何密钥。

---

## 0. 结论(TL;DR)

1. **数据通路裁决:REST 接口直连**。直接消费 harness 既有的 KB HTTP API(`/api/chatop-kb/*`,位于 dsh web 进程内),office 侧自建一个轻量 KB 网关模块;**不采用 MCP 作为知识库通路**(裁决过程见 §3,MCP 重启条件见附录)。
2. **两种形态都能自动发现,且 harness 侧零改动**:
   - dsh 形态:sidecar 已知 dsh RPC origin(`CHATOFFICE_DSH_RPC_ORIGIN`/`_FILE`),KB 与 RPC 同在 dsh web 上,origin 即 KB origin;
   - 桌面安装包形态:四级发现(缓存 → 配置覆盖 → hint 文件 → loopback 端口探测 + 指纹校验)。
3. **UI**:首页对话 composer 的 footerStart 中,与 ModelPickerButton 紧邻放置 `KbPickerButton`(支持多选库);popover 展示库清单 + 文档数 + 健康状态 + 来源。
4. **对话查询**:选库后,每条用户消息发送前自动对各选中库做 `/search` 检索,结果以 `[n]` 编号注入上下文,office 自有 agent(用户所选模型)合成回答,渲染端把 `[n]` 后处理为引用 chips;不用 harness 的 `/ask`(见 §6.4)。P2 再补会话内 `kb_search`/`kb_read_doc` 原生工具供追问深挖。
5. **嵌入 `PACKAGES` 铁律**:KB 网关先并入既有包 `@chatoffice/ai-provider`(已在嵌入清单内),规避"新包不登记 `package-embedded.mjs` → dsh 形态 sidecar 启动即死"的 xlsx-gateway 前车。

---

## 1. 现状盘点(两仓实测核验,含文件行号)

### 1.1 harness 侧已有资产(chayuan-harness,package 名 `chatop`)

| 资产                        | 位置                                                                                                          | 对本案的意义                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| KB HTTP API 全套            | `chatop-kb/src/host.js:326-440`,前缀 `/api/chatop-kb`                                                         | **唯一同时具备"清单+健康+结构化检索+SSE 引用问答"的通路**,两形态都存在(都在 dsh web 进程内) |
| `/status`                   | host.js:335-342,返回 `{ok, kbs:[{kbId,docs[],vecBackend,ftsTokenizer,embedFingerprint}], chain, docStatuses}` | **发现与清单一击双中**:既是身份指纹(ok + kbs 数组),又是 picker 需要的全部清单/健康数据      |
| `/search`                   | host.js:359-367,`GET ?kbId&q&topK` → `{ok, hits:[{chunkId,docId,docName,seq,headingPath,text}]}`              | 检索增强的数据源,含引用所需全部字段                                                         |
| `/ask`                      | host.js:368-382,SSE:`citations → delta* → [DONE]`                                                             | 存在但**不采用**(§6.4)                                                                      |
| `/doc`、`/docs`             | host.js:347-349,428-432                                                                                       | P2 文档预览                                                                                 |
| 回环围栏                    | host.js:295-302 `isLoopback`,403 loopback-only                                                                | 同机免 token 可信;跨机需 harness 侧 `CHATOP_ALLOW_NON_LOOPBACK=1`                           |
| dsh web 端口                | `desktop/src/main/dsh.ts`,注册表 52584,多用户会话段 52601+（**2026-09-21 统一端口注册表**，chayuan-harness `docs/port-registry.md`；旧段 3080..3090 仅作老装机兼容尾巴） | 桌面形态探测范围依据（`kb-discovery.ts` 阶梯已同步）                                        |
| KB 插件随桌面内置           | `desktop/src/main/bundled-plugin.ts:37-79`,`BUNDLED_PLUGINS` 含 `chatop-kb`                                   | 官方察元桌面**必带**知识库,发现失败只可能是"未启动/版本过旧"                                |
| dsh 会话内 kb 工具          | `chatop-kb/src/kb/tools.js`(kb_search/kb_list/kb_read_doc)                                                    | 属 harness 自己的会话,office 会话用不到;但工具语义可被 office 原生工具复刻                  |
| 控制面 MCP 端点             | `desktop/src/main/control/mcp-http.ts`,注册表 52583(占用 +1..+9),发现文件 `<userData>/mcp-local.json`,回环免 token   | 桌面形态专属、kb_read_doc 只有元数据、无清单/健康——**不作为主通路**(§3)                     |
| dsh-plugin 的 mcp.json 管理 | `dsh-plugin/src/host.js:176-290`                                                                              | 那是 harness→其它 CLI 的清单,**office 消费 harness 不经此路**,无需注册任何东西              |
| 检索实现                    | sqlite-vec KNN + FTS5 BM25 → RRF(k=60) → 相邻块扩窗;嵌入指纹守卫                                              | 检索质量由 harness 保证;指纹不符时 status/search 会带 mismatch 信号,office 需透出提示       |

### 1.2 office 侧已有资产(chayuan-office)

| 资产                     | 位置                                                                                                                                                                           | 对本案的意义                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| dsh 形态 origin 发现     | `apps/server/src/app.ts:143-160` 读三环境变量 → `attachAiProxy({harness:{dshHome,rpcOrigin,rpcOriginFile}})`;`ai-proxy.ts:135-150` origin 懒解析(直值或 5s 缓存读 origin 文件) | **KB 网关完全对称复用**:同一 origin,同一懒发现节奏                 |
| dsh 形态 UI 同源         | dsh-plugin host 反代 `/chatoffice-app/*` → sidecar;渲染端相对路径 fetch 即同源可达 sidecar                                                                                     | 渲染端走 `fetch('kb/...')` 零 CORS                                 |
| 桌面形态进程模型         | 无常驻 sidecar;`@chatoffice/ai-host` 在各编辑器主进程注册进程内 IPC;shell main 有 `window.chatOffice` 桥                                                                       | 桌面形态 KB 网关实例化在 shell main,经 IPC 暴露                    |
| 渲染端能力探测惯例       | `ChatPanel.tsx:44-45` `typeof window.chatOffice.aiStream === 'function'` 守卫                                                                                                  | KB 桥必须同样 typeof 守卫(f1dcbd86 教训:桥缺方法=整应用首渲染崩死) |
| composer 插槽            | `packages/ui/src/AiComposer.tsx` footerStart;`ChatPanel.tsx:1041-1112` 顺序=附件钮→`.chat-model-slot`(ModelPickerButton)→模式钮→AssistantPicker                                | KB 按钮插入点:附件钮之后、模型槽之前(紧邻模型,符合需求)            |
| 编辑器面板同构           | docs/sheets/markdown/pdf/html/slides 的 AiPanel footerStart 均含 ModelPickerButton                                                                                             | P3 复用同一组件                                                    |
| MCP 客户端(不用于本方案) | `apps/shell/src/main/mcp/external-client.ts`(stdio/http/sse)+ `externalMcpServers` 配置                                                                                        | 仅作 §3 对照项与附录备选                                           |
| 军规                     | B 区新文件、i18n 键进 `i18n-local-strings.ts`、主题 token 三块、英文注释、PACKAGES 清单                                                                                        | 施工约束                                                           |

---

## 2. 需求到机制的对译

| 需求                             | 机制                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| 自动发现 harness 知识库接口      | `GET {dshOrigin}/api/chatop-kb/status`,响应形状作身份指纹(§5)                                |
| 发现知识库清单                   | 同一个 `/status` 响应里的 `kbs[]`(kbId、docs、向量后端、嵌入指纹)                            |
| 输入框下与选模型挨着的知识库图标 | composer footerStart 新增 `KbPickerButton`,紧邻 `.chat-model-slot`                           |
| 选择后对话能查询知识库           | 发送管道:多库并行 `/search` → 合并注入 `[n]` 编号上下文 → 自有模型合成 → 引用 chips 渲染(§6) |
| dsh 形态自动发现                 | origin 复用 RPC origin(已知),零新增发现逻辑                                                  |
| 安装包形态自动发现               | 四级发现器(shell main 内,§5.2)                                                               |

---

## 3. 路线裁决:REST 接口 vs MCP 服务

### 3.1 候选通路盘点

| 通路                                   | 形态覆盖                 | 清单/健康      | 结构化检索     | 引用问答(SSE) | 鉴权                    | 依赖                                 |
| -------------------------------------- | ------------------------ | -------------- | -------------- | ------------- | ----------------------- | ------------------------------------ |
| **A. dsh web KB REST(选定)**           | dsh + 桌面 + web/env     | `/status` 原生 | `/search` 原生 | `/ask` 原生   | 回环免 token            | 零 harness 改动                      |
| B1. harness 控制面 MCP(52583,http)     | 仅桌面                   | 无(工具拼凑)   | kb_search 有   | 无            | 回环免 token/跨机 token | 依赖控制面开启与发现文件             |
| B2. `chatop mcp` stdio 适配器          | 仅桌面(需找到可执行文件) | 无             | kb_search 有   | 无            | 进程级                  | dsh 形态无 MCP 客户端栈              |
| C. office 原生工具走 A 的网关(§6.5,P2) | 全形态                   | —              | —              | —             | 同 A                    | 这是**消费方式**不是通路,叠加在 A 上 |

### 3.2 裁决理由(REST 胜出)

1. **形态覆盖是硬伤**。本需求的第一形态是 dsh——office 的 MCP 客户端栈(`external-client.ts` + IPC 链 + 管理窗格)全在 electron main,**dsh 形态没有 electron main**,MCP 通路必须新写一份 sidecar 侧 MCP 客户端;而 REST 通路里 sidecar 本来就是 HTTP 服务,两形态共用同一网关模块。选 MCP 总代码量更大而非更小。
2. **语义错位**。picker 需要的是**资源型数据**(库清单、文档数、向量后端、嵌入健康、索引进度),REST 资源语义天然匹配;MCP 是工具语义——每开一次 picker 要发起一次工具调用、等握手、把 `content[0].text` 里的 JSON 字符串再 parse 一遍,延迟与故障面都更差。
3. **功能完整度**。控制面 MCP 的 `kb_read_doc` 只回元数据(chunk 文本被注释掉了);清单、健康(chain/嵌入指纹)、SSE 引用问答完全缺失;REST 是这些能力的唯一全集。
4. **消费方向单一**。MCP 的核心价值是"一个 server、多客户端生态复用";本需求是 office 单消费者调用 harness 单提供方,标准化收益≈0。同理,**不需要**在 harness 的 `mcp.json` 里注册任何条目(那是 harness 管理其它 CLI 的清单)。
5. **确定性 UX**。"选择知识库后对话能查询"要求选库**必然**作用于对话(检索注入是确定性的);MCP 工具路径下是否查库取决于模型自觉,违背需求本意。
6. **演进不锁死**。网关模块把"KB 来源"抽象成 `list()/search()/readDoc()` 三方法,未来若知识库独立部署/跨机/需要三方生态,harness 侧补一层 MCP façade 即可,office 消费端换网关传输实现,UI 与对话管道不动(重启条件见附录)。

### 3.3 与 `/ask` 的关系

`/ask` 属于 REST 通路内的能力取舍(不是 MCP 问题):它由 **harness 侧配置的对话模型**作答,与 office 会话自身的模型选择(draftModel)冲突,且会造成一问两答。故 v1 不用 `/ask`,用 `/search` + office 自有 agent 合成(§6)。

---

## 4. 总体架构

```
L0  harness KB REST(/api/chatop-kb/*,dsh web 进程内,已存在,零改动)
      ↑ loopback HTTP
L1  office KB 网关(新模块,并入 @chatoffice/ai-provider:kb-client.ts + kb-discovery.ts)
      · discover():四级发现 → {origin, source:'cached'|'env'|'probe'|'manual', health}
      · list()/search(kbId,q,topK)/readDoc(kbId,docId)   ← 稳定接口,传输可替换
      · 指纹校验(ok===true && Array.isArray(kbs)) + 熔断缓存(失败退避)
      ├─ 宿主① dsh/web 形态:apps/server 挂 attachKbProxy(与 attachAiProxy 平行)
      │    渲染端 → 同源 fetch('kb/status'|'kb/search') → /chatoffice-app/ 反代 → sidecar → dsh
      └─ 宿主② 桌面形态:shell main 实例化网关,注册 IPC 通道(KB_DISCOVER/KB_LIST/KB_SEARCH/KB_READ)
           渲染端 → preload window.chatOffice.kb*(typeof 守卫)→ IPC → main → dsh
L2  渲染端 facade kbApi.ts:桌面走桥、dsh/web 走相对 fetch,自动探测二选一
L3  UI 与对话:KbPickerButton(popover 多选)+ ChatPanel 集成 + 检索注入管道 + [n] 引用 chips
```

**为什么先并入 `@chatoffice/ai-provider`**:该包已在 `package-embedded.mjs` 的 PACKAGES 嵌入清单内,新模块零登记风险;且 harness 触达代码(settings-source、vendor-catalog 的 chatop- 路由)本就聚居于此。若日后长出管理面/上传等重功能再拆独立包,届时**必须同步登记 PACKAGES**(xlsx-gateway 教训:dsh 形态 sidecar 缺包启动即死)。

---

## 5. 自动发现设计

### 5.1 dsh 形态(自动 = 既有机制自然延伸)

- sidecar 已持 dsh origin(`CHATOFFICE_DSH_RPC_ORIGIN` 直值或 origin 文件懒发现,5s 缓存);KB 与 RPC 同在 dsh web,**origin 即 KB origin**,无任何新增发现逻辑。
- `attachKbProxy` 与 `attachAiProxy` 同参数(harness:{dshHome, rpcOrigin, rpcOriginFile})、同懒解析节奏。
- 既有制度沿用:**NO_PROXY 必含 127.0.0.1**(代理环境变量劫持回环 fetch 是已踩过的坑)。
- 渲染端同源:iframe 基址 `/chatoffice-app/`,`fetch('kb/status')` 直达 sidecar,零 CORS。

### 5.2 桌面安装包形态(shell main 四级发现)

| 级          | 来源                                                                                | 说明                                                    |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| ① 缓存优先  | 上次成功的 origin(存 ai-settings 类本地状态)                                        | 启动即用,后台复验;复验失败降级重探                      |
| ② 显式覆盖  | 设置项/环境变量手动指定 origin                                                      | 企业部署固定地址;优先级最高(置于①之上判定)              |
| ③ hint 文件 | `~/.dsh` 目录存在性;`~/.dsh/storages/chatoffice/dsh-rpc-origin`(若装过 office 插件) | 命中则直接取该 origin 复验                              |
| ④ 端口探测  | `127.0.0.1:3080..3090` **并行** GET `/api/chatop-kb/status`,每端口 ~300ms 超时      | 响应作指纹:`ok===true && Array.isArray(kbs)`;命中即锁定 |

- **状态机**:`未检测到`(全败,图标灰态 + "未检测到察元桌面")/ `已连接`(展示来源 origin)/ `宿主未启用知识库`(404 → "请升级察元桌面")/ `需重建索引`(嵌入指纹 mismatch 透出)。
- **复探时机**:picker 打开时强制刷新;发送前检索失败自动重探一次再判死。
- **多用户/多实例**:harness 多用户占用 3080+N,v1 取首个响应者并在 picker 底部明示所连 origin;跨实例内容隔离风险写入文档。
- **安全边界**:office 侧同样只允许 loopback(网关拒绝非回环目标,②的显式配置除外);KB 内容只进会话上下文,**不落盘**;web/docker 形态默认隐藏 KB 按钮(§5.3)。
- **启动不阻塞**:发现异步化,失败静默,不拖慢桌面启动(避开 13-15s 固定成本的已知敏感区)。

### 5.3 web/docker 形态

`apps/server` 本就读同一组环境变量,运维把 `CHATOFFICE_DSH_RPC_ORIGIN` 指向可达 harness 即天然点亮;跨机需 harness 侧放开 `CHATOP_ALLOW_NON_LOOPBACK=1`(harness 文档既有共识)。v1 不做 UI 配置入口,P3 再补。

---

## 6. 对话检索增强设计

### 6.1 选择态

- `KbPickerButton` 支持多选库;选中集以 chips 形态显示于 composer 上方(与附件 chips 同区),会话级保持,持久到 localStorage(键随形态/用户隔离)。
- popover 内容:库清单(名称、文档数、向量后端)+ 健康角标(嵌入指纹 mismatch → "需重建索引")+ 底部来源行(`来源:察元桌面 · 127.0.0.1:3080 · 刷新 · 手动配置`)。

### 6.2 发送管道(确定性检索注入)

1. 用户发送 → 若有选中库:对各库**并行** `GET kb/search?kbId&q=<用户输入>&topK=6`;
2. 合并:按返回序交错(跨库粗平铺),按 chunkId 去重,截断至总预算(默认 ~12k 字符,块级上限由 harness 侧 HARD_MAX 1200 token 保证);
3. 注入:作为上下文块拼入本次请求——编号 `[1]..[n]`,每块带 `来源:docName › headingPath`;system 指令要求回答以 `[n]` 脚注标注引用、上下文不足时明说(复刻 harness answer.js 的 prompt 精神);
4. 合成:office 自有 agent(用户当前模型)正常流式作答;
5. 渲染:消息渲染层把 `[n]` 后处理为引用 chips(悬停显 docName+headingPath);**在最终渲染层处理而非流片段**(流式 token 可能拆散 `[n]`)。
6. 降级:检索超时/失败 → 不阻塞发送,无 KB 直答 + 顶部一次性提示"知识库暂不可达"。

### 6.3 范围裁剪(v1 只读)

office 是**只读消费方**:不上传文档、不建库、不管嵌入配置——管理动作全部留在 harness 侧「知识库」应用(chatop-kb-app)。这砍掉了 addDoc(≤48MB base64)/config/key 三类复杂度与安全面。

### 6.4 为什么不用 `/ask`

见 §3.3:模型选型冲突 + 一问两答。`/ask` 保留为 P3 可选能力("一键让察元桌面模型就库作答"独立按钮),不进主对话流。

### 6.5 P2:会话内 kb 工具(office 原生,非 MCP)

选中库的会话自动注册两个 office 原生 tool def(与现有 `mcp__` 注入机制平行的内部工具):`kb_search`(追加检索)、`kb_read_doc`(经 `/doc` + readDoc 取正文片段),供模型追问深挖、多跳检索。走同一网关,零新增通路。

---

## 7. UI 与工程规格

- **图标**:内联单色描线 SVG(沿侧栏单色化惯例),`currentColor` + 主题 token,选中态着色;**不用 PNG**(省 200KB 量化铁律)。
- **i18n**:全部新键进 `i18n-local-strings.ts`(20 语言同集),品牌串走 `brandName` 键;文案含空态/异常态全套(未检测到/请升级/需重建索引/暂不可达)。
- **CSS**:popover/chips 样式进组件级新文件,颜色全部语义 token(light/dark/system 三块)。
- **注释**:英文(CI 检查);原位编辑(如 ChatPanel footerStart 插入)带 `// LOCAL(<date>, <base>)` 四要素标记,其余走 B 区新文件。
- **测试**:网关与发现器单测(mock fetch/探测超时);ChatPanel 选库-发送-引用渲染走 jsdom 交互测试(沿用 mobile-touch/ribbon 的 mountProbe 配方);真机验收按 CDP 惯例(dsh 形态 iframe 内实测 + 桌面形态隔离实例),UI 走 judge 渲染验收。

## 8. 改动面清单(不写码,文件级)

| 区域      | 文件                                                                                                                                     | 动作                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 网关      | `packages/ai-provider/src/kb-client.ts`、`kb-discovery.ts`                                                                               | 新增(B 区)                  |
| sidecar   | `apps/server/src/app.ts`(挂 attachKbProxy)、新 `kb-proxy.ts`                                                                             | 新增 + 一行挂载(LOCAL 标记) |
| 桌面 main | `apps/shell/src/main/kb/kb-service.ts`(发现器实例+IPC handlers)、`preload/index.ts`(桥方法)                                              | 新增 + 注册点               |
| 渲染端    | `home-chat/kbApi.ts`(facade)、`home-chat/KbPickerButton.tsx`、`ChatPanel.tsx`(footerStart 插入+chips+发送管道)、`agent.ts`(上下文注入点) | 新增 + 插入                 |
| 引用渲染  | 消息渲染层 `[n]` 后处理 + chips 组件                                                                                                     | 新增                        |
| i18n/样式 | `i18n-local-strings.ts`、组件级 css、`tokens.css` 三块                                                                                   | 追加                        |
| 测试      | 网关/发现器/交互三组                                                                                                                     | 新增                        |

## 9. 风险与对策

| 风险                            | 对策                                                      |
| ------------------------------- | --------------------------------------------------------- |
| harness 升级 API 漂移           | status 指纹校验;不匹配按"请升级察元桌面"降级,不崩         |
| 代理劫持回环                    | NO_PROXY 必含 127.0.0.1(既有制度,网关内再断言)            |
| 多用户端口串库                  | 首响应者 + picker 明示 origin;文档声明限制                |
| 渲染端桥缺方法崩应用            | 全部 `window.chatOffice.kb*?.` typeof 守卫(f1dcbd86 教训) |
| dsh 宿主未装 kb 插件            | 404 → 图标灰态文案,不隐藏功能入口(可发现性)               |
| 大库检索拖慢发送                | topK 上限 + 检索超时竞速 + 失败降级直答                   |
| KB 内容外流出会话(发给云端模型) | 属 RAG 固有数据流,文档明示;企业部署走本地模型组合         |

## 10. 分期计划

| 期                    | 范围                                                                                                                                          | 验收口径                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **P0** dsh 形态端到端 | kb-client(发现+list+search)、attachKbProxy、KbPickerButton+ChatPanel 集成、检索注入、[n] 引用 chips、i18n/主题、单测                          | 察元桌面真机:iframe 内自动点亮图标→选库提问→答案带引用 chips;宿主未装 kb → 灰态文案                 |
| **P1** 桌面形态       | shell main 四级发现器、IPC 通道+preload 桥、渲染端自适应、手动配置入口、连接状态 UI                                                           | 独立安装 office + 本机 harness 桌面:自动发现点亮;关掉 harness → 灰态;重启 harness → picker 刷新恢复 |
| **P2** 对话深化       | 会话内 kb_search/kb_read_doc 原生工具、引用点击文档预览(/doc+readDoc)、重建索引健康提示、上下文预算设置                                       | 追问深挖命中;引用点开见原文片段;mismatch 提示可见                                                   |
| **P3** 扩展           | 六编辑器 AI 面板复用同组件、web/docker 手动 origin 配置、/ask 独立按钮(可选)、harness 侧稳定发现文件(可选,需 harness 改动,入 vendor 同步制度) | 各面板同交互;docker env 点亮                                                                        |

---

## 附录:MCP 备选的重启条件

以下条件满足其一,再评估把 KB 通路切到/叠加 MCP(harness 侧加 façade,office 只换网关传输):

1. 知识库脱离 dsh web 独立部署(独立服务/跨机),回环免 token 模型不再成立;
2. 出现 office 之外的第二、第三个稳定消费方,工具生态复用产生真实收益;
3. harness 官方把 KB 能力标准化为 MCP 资源/工具全集(含清单与健康),office 跟随即可省自维护成本。

在那之前,本方案的单消费者场景下,REST 直连是代码量、延迟、故障面、功能完整度四维全胜的选择。
