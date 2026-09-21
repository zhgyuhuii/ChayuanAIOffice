# ChatOffice 命令手册 —— 四形态的开发 / 生产 / 调试

> 全部命令在仓库根目录执行。形态编号对应 [PLAN-DUAL-TARGET.md](PLAN-DUAL-TARGET.md)。

## 形态 ① ChatOffice 自有 Electron 壳（轻量纯办公安装包）

| 阶段 | 命令 | 说明 |
|---|---|---|
| 开发 | `npm run dev`（别名 `npm run dev:desktop`） | 五编辑器 renderer（5173–5177）+ Electron 壳同时起 |
| 开发（单编辑器） | `npm run dev:docs` 等 | 见各 `apps/*/package.json` |
| 打包（Windows） | `npm run dist:win` | 产物 `apps/shell/release/`，安装包签名按现有流程 |
| 打包（mac / Linux） | `npm run dist:mac` / `npm run dist:linux` | 含 universal 侧车构建 |
| 调试生产包 | `dist:win` 后运行 release 目录内 exe，附加 `--remote-debugging-port=9222`；主进程日志看终端，renderer 日志 DevTools | service-core 逻辑在主进程内，断点符号为源码 TS |

## 形态 ② 浏览器 SaaS（Web 宿主 + 云端 BFF）

| 阶段 | 命令 | 说明 |
|---|---|---|
| 开发 | `npm run dev:web` | BFF(8787) + Web 宿主(5180) + 五编辑器(5173–5177) 一键起 |
| 开发（仅后端） | `npm run dev:server` | Fastify 热重载（node --watch），数据落 `./data` |
| 生产构建 | `npm run build:web` | 产出 `dist/web/`：宿主 + `editors/<key>/` + `config.js` |
| 生产镜像 | `npm run dist:server` | 单制品 Docker 镜像 `chaoffice-server:latest` |
| 全栈部署 | `docker compose -f docker/docker-compose.yml up` | server + Postgres + MinIO（Logto 预留） |
| 本地预览生产包 | `npm run preview:web` | 静态服务 `dist/web`（默认 5180，可传端口参数） |
| 生产裸跑 BFF | `npm run start:server` | 环境变量：`PORT` `HOST` `CHATOFFICE_DATA_DIR` `CHATOFFICE_AUTH=jwt|off` |
| 调试 | `curl localhost:52587/healthz`；RPC：`curl -X POST localhost:52587/rpc/chatHistory/listProjects -d '{"args":[]}'`；推送：`websocat ws://localhost:52587/ws` 发送 `{"subscribe":["ai:stream-chunk"]}`；用量：`curl localhost:52587/ai/usage` | Fastify logger 关闭时用 `CHATOFFICE_LOG=1`（接 Fastify logger 配置） |

## 形态 ③ chatop 桌面内置（chayuan-harness 全家桶）

| 阶段 | 命令 | 说明 |
|---|---|---|
| 构建内嵌件 | `npm run dist:chatop` | 产出 `dist/chatop-chaoffice-<版本>/`：`embedded/` 受管 BFF sidecar + `host-side.cjs` 生命周期适配器 + 集成 README |
| 配套编辑器 SPA | `npm run build:web` | chatop 窗口加载的 Web 宿主与编辑器静态资源 |
| 集成 | 把 `dist/chatop-chaoffice-*` 作为 chayuan-harness desktop 的 app resource，按其插件自愈机制暂存到 `userData/plugins`，desktop main 调 `host-side.cjs start({pluginDir, runtimeDir, log})` 取 `origin` | 见 bundle 内 README |
| 调试 | sidecar 环境变量注入 `CHATOFFICE_AUTH=off`；健康检查 `curl http://127.0.0.1:<port>/healthz`（端口随机，见 host-side 返回值）；日志经 ctx.log 回流 chatop 日志面板 | 数据目录在插件 `runtimeDir/data` |

## 形态 ④ dsh 插件（任何 dsh harness，全离线）

| 阶段 | 命令 | 说明 |
|---|---|---|
| 构建插件包 | `npm run package:plugin` | 产出 `dist/chatoffice-shell-<版本>.tgz`（manifest + client 薄壳 + 宿主半 + embedded sidecar） |
| 仅构建内嵌件 | `npm run package:embedded` | 产出/刷新 `dsh-plugin/embedded/` |
| 安装（harness 形态） | `dsh plugin --profile web add -w <repo>/dsh-plugin` 后重启 `dsh web` | 经 `window.__chatop_shell__.registerDesktopApp` 注册 Dock 应用 |
| 安装（察元 Electron 桌面） | `DSH_HOME=%APPDATA%/chatop/dsh-home node %APPDATA%/chatop/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile web add -w <repo>/dsh-plugin`，并把 `chaoffice` 加入 profile `package.json` 的 `dsh.profile.bundles`，重启察元 | 同一 profile/同一 origin，两种形态 Dock 图标一致 |
| 验证 | `curl <dsh-web>/api/chatoffice/status`（sidecar origin 与端口）；浏览器开 dsh web 点 Dock 的 ChatOffice | 窗口 = 五编辑器标签宿主 iframe |
| 调试 | sidecar 日志经宿主 `[chaoffice]` 前缀回流 dsh 日志；数据在 `$DSH_HOME/storages/chatoffice` | 卸载/退出时 sidecar 随插件 dispose 回收 |

## 通用

| 命令 | 说明 |
|---|---|
| `npm test` / `npm run typecheck` | 全部 22 个工作区 |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run test:e2e` | Playwright e2e |
| `npm run package:dir`（在 chayuan-harness 内） | chatop 自身打包入口（形态 ③ 宿主） |
