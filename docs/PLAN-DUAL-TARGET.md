# GenOffice 双端 + dsh 插件化改造总体计划 v2.1

> 状态：已达成共识，待批准开工（批准前不写实现代码）。
> 共识过程：17 轮决策问答，全部由项目所有者逐条确认。

## 一、交付形态总览（四个，全部保留）

| 形态 | 是什么 | BFF 从哪来 | 存储后端 | 离线能力 |
|---|---|---|---|---|
| ① GenOffice 自有 Electron 壳 | 轻量纯办公安装包（现有 `apps/shell` 路线），独立办公套件定位，持续发版 | 无 BFF——service-core in-process（IPC 直调） | 本地 fs（现状） | 完全离线 |
| ② 浏览器 SaaS | `apps/web` 宿主 + 云端 BFF | 云端 Docker 制品 | Postgres + MinIO/S3 | 无（在线产品） |
| ③ chatop 桌面内置插件 | chayuan-harness Electron 全家桶里的"AI 工作站办公套件"，随包内置、启动自愈重装 | 内嵌受管 BFF sidecar（Node + Rust sidecar + SQLite + 本地对象目录） | SQLite + 本地目录 | 完全离线；登录后云文档走云端旁路，**第一期不做本地↔云同步** |
| ④ dsh web 插件 | 装进任何 dsh harness 的插件，**全本地运行，无需云端** | 插件宿主半拉起受管 BFF sidecar，**复用 ③ 的同一套内嵌 BFF 制品**，localhost 随机端口，随 dsh web 生命周期回收 | 同 ③ | 完全离线 |

① 与 ③ 定位不同、各自发版，互不替代。

## 二、已锁定的架构决策（17 轮共识）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 部署形态 | 完整 SaaS（起步即含账号与云端文档） |
| 2 | 文件模型 | 统一 storage 抽象，本地/云双轨，账号可选；不登录可用本地文件（桌面走 fs，浏览器走 File System Access API） |
| 3 | 账号体系 | 独立产品账号（自托管 Logto，OIDC，可对接企业身份源），JWT；AI 凭据（BYOK/Genspark）为账号下加密设置项 |
| 4/5 | 协作 | A2 分期：Markdown → Docs → Sheets 实时协同（Yjs）；Slides/PDF 永久走编辑锁 + 版本历史；分享链接/权限/版本历史全格式共享同一套基础设施 |
| 6 | 服务层 | `packages/service-core` 单份逻辑（类型契约沿用 `apps/*/src/shared/ipc.ts`）；Electron in-process 直调 / BFF 挂 Fastify 路由双宿主；渲染层统一 typed client + ipcRenderer、fetch/WS 两个薄传输适配器 |
| 7 | 存储选型 | Postgres（元数据 + Yjs update 流，定期 compaction）+ S3 兼容对象存储（MinIO 起步，blob + 快照）；文档访问经 BFF，第一期不做浏览器预签名直传 |
| 8/9 | 部署纪律 | 单制品双部署：SaaS 即私有化 Docker 制品的生产实例；CI 双流水线（云 staging + Compose 冒烟）都绿才发布 |
| 10 | 范围 | 纵队式分期，每期可上线、可回滚；Electron ① 每期照常发版 |
| 11 | dsh 插件形态 | 不碰 root 槽；经 chayuan-harness **新增公开应用注册槽位**注册为桌面应用（跨仓库改动）；无 chatop-shell 时回落 dsh 官方界面普通面板 |
| 12 | 插件内容 | 薄插件壳（应用注册 + 图标 + 开窗，KB 级）+ 窗口内加载 GenOffice Web origin；③ 静态资源随 Electron 包本地加载；接受三条后果：离线降级态 UI、postMessage/同源凭据传递约定、wasm 跨域 CSP |
| 13/14 | 内嵌 BFF | ③④ 内嵌受管 sidecar 提供完整离线能力；**业务逻辑单份，分叉仅限 storage 适配层**：embedded = SQLite + 本地对象目录；元数据层强制 ORM（Drizzle）禁裸 SQL；CI 第三条内嵌模式冒烟流水线；Rust xlsx sidecar / 系统 OCR helper 打包进内嵌件（② 用云端 OCR：Tesseract/Paddle，UI 标注质量差异） |
| 15/15b | 形态取舍 | 四形态全保留；④ = 插件宿主半受管 BFF sidecar，与 ③ 共用内嵌制品；首启健康检查 + 端口协商 + 版本自愈（照抄 chatop 自愈模式） |
| 16 | AI 面板与 harness 会话 | GenOffice AI 面板四形态全保留；③④ 新增 **harness 通道 provider**（零配置 AI）：凭据走 harness 官方通道不落地、用量计量在 harness 侧（GenOffice 只记调用次数）、能力缺口探测降级并提示 |
| 17 | 会话历史 | 跟文档走：本地文档存本地（project-store），云文档存云端 BFF（Postgres）；另存为云文档时历史随迁；不做全局聊天库 |

横切约束：AI 计量第一天就记（防 BYOK 外 token 费用失控）；支付/计费为可选插件（私有化默认关）。

## 三、新增/改建的工作包

| 包 | 职责 |
|---|---|
| `packages/service-core` | 承载 5 个 app 主进程约 350 个 handler 的业务逻辑（入参出参 = 现有 shared/ipc.ts 类型） |
| `packages/storage-adapter` | 统一 storage 接口（open/save/list/recents/trash/versions/chats）；实现：local-fs、cloud（Postgres+S3）、embedded（SQLite+本地目录） |
| `apps/server` | Fastify BFF：请求/响应路由 + WebSocket 流式/推送；双产物 = Docker 制品（②）与内嵌 sidecar 制品（③④）；Rust xlsx sidecar、OCR、AI 代理 |
| `apps/web` | 浏览器 SPA 宿主（替换 shell 的窗口/标签逻辑，路由/iframe 挂载五编辑器）；File System Access API |
| `packages/ipc-client` | 渲染层统一 typed client + 传输适配器（ipcRenderer / fetch+WS） |
| GenOffice dsh 插件（新仓库或 monorepo 内） | client 薄壳 + 宿主半 sidecar 管理器；复用 apps/web 静态资源与内嵌 BFF 制品 |
| chayuan-harness（跨仓库 PR） | 公开桌面应用注册槽位协议 |

## 四、分期计划

- **第 0 期：service-core + storage-adapter 抽取（纯重构）**
  handler 逻辑迁入 service-core，Electron 主进程退化为薄 IPC 转发；storage-adapter 三实现骨架；project-store 路径注入改为轨注入。
  验收：现有测试 + e2e 全绿，Electron ① 用户无感。

- **第 1 期：BFF + Web 宿主 + 账号 + 云空间**
  apps/server（Docker + 内嵌双产物）、apps/web、Logto/Postgres/MinIO、AI 代理 + 计量、Docker 制品与 CI 流水线。
  验收：② 上线——五编辑器浏览器可用，云文档打开/编辑/分享/版本历史（锁模式，无协同）。

- **第 2 期：dsh 插件双件**
  chayuan-harness 应用注册槽位（跨仓库 PR）+ GenOffice 插件（client 薄壳 + 宿主半 sidecar）+ chatop 桌面内置集成 + harness 通道 provider + 内嵌模式 CI 冒烟。
  验收：③④ 全离线可用，harness 通道 AI 可用。

- **第 3 期：Markdown 实时协同**（Yjs + y-websocket；update 入 Postgres/SQLite，compaction 快照入 S3/本地目录）。

- **第 4 期：Docs 协同**（块级 CRDT；协同文档存操作历史/快照，导出时落 .docx；字节保真路径仅本地文档保留）。

- **第 5 期：Sheets 协同**（单元格操作流 + 并发重算语义）；Slides/PDF 维持锁 + 版本。

每期结束产品可上线、可回滚；① 照常发版。

## 五、关键风险与对冲

- 350 端点迁移 → 第 0 期纯重构 + 现有测试回归网。
- 部署漂移 → 单制品纪律 + CI 双/三流水线。
- SQLite/Postgres 方言漂移 → Drizzle ORM 强制。
- dsh 插件宿主半 spawn 能力不确定 → 第 2 期首个里程碑做技术验证 spike。
- token 成本失控 → 计量第一天接入。
