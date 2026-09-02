# chatoffice（dsh 插件）

ChatOffice 办公套件的 DeepSeek Harness 插件形态（总体计划 v2.1，形态 ④）。
**harness 形态（`dsh web`）与 Electron 形态（察元桌面）点击 Dock 图标即可运行**——
两种形态加载同一 dsh web origin，注册的应用自动在两边出现。

## 结构（对齐 chatop-kb/chatop-models 双半插件模式）

```
package.json / cordis.patch.yml  dsh 插件清单（dsh.client + dsh.bundle.patch）
src/host.js        宿主半：拉起/守护 BFF sidecar（127.0.0.1 动态端口，/healthz
                   就绪探测，孤儿回收，卸载 SIGTERM→SIGKILL），管理面
                   /api/chatoffice/status（loopback 围栏）
src/client-entry.jsx  client 半：window.__chatop_shell__.registerDesktopApp
                   注册 Dock 应用；窗口 = 指向 sidecar origin 的 iframe
                   （Web 宿主 + Docs/Sheets/Slides/PDF/Markdown 五编辑器）
vendor/chatoffice-sidecar  全离线 BFF（Node + tsx + SQLite/本地对象目录 + dist/web，
                   由 chatoffice 仓库 scripts/package-embedded.mjs 组装）
dist/host.js, dist/client.js  esbuild 产物（npm run build）
```

## 构建与安装

```sh
# chatoffice 仓库根目录（一步完成：web 包 → sidecar → 插件 dist → tgz）
npm run package:plugin

# 本地链接安装（harness 形态）
dsh plugin --profile web add -w /path/to/chatoffice/dsh-plugin
```

察元桌面（Electron 形态）使用受管 profile（`%APPDATA%/chatop/dsh-home/profiles/web`），
等效安装：

```sh
DSH_HOME="$APPDATA/chatop/dsh-home" \
  node "$APPDATA/chatop/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  plugin --profile web add -w D:\code\chatoffice\dsh-plugin
```

（profile 的 `pnpm-workspace.yaml` 若含 `allowBuilds: protobufjs: set this to true or false`
占位符，改为 `protobufjs: true` 后重跑；并把 `chatoffice` 加入 profile `package.json`
的 `dsh.profile.bundles`。）重启察元桌面或 `dsh web` 即见 Dock 图标。

## 验证过的链路

- `GET /api/chatoffice/status` → `{status:"ready", origin:"http://127.0.0.1:<动态端口>"}`
- sidecar origin `/`（宿主）、`/editors/{docs,sheets,slides,pdf,markdown}/` 全部 200
- 桌面 Dock 出现 ChatOffice 图标，点击开窗，窗口内为五编辑器标签宿主
- Electron 形态无需任何桌面侧改动：主窗口加载同一 dsh web origin

历史设计文档（槽位协议提案，已被 registerDesktopApp 机制取代）：[APPLICATION-SLOT.md](./APPLICATION-SLOT.md)
