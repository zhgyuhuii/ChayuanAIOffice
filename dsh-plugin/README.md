# genoffice-shell (dsh plugin)

GenOffice 套件的 DeepSeek Harness 插件形态（总体计划 v2.1，形态 ④）。
**双半结构**：

- **client 薄壳**（`src/client.js`）：向宿主桌面注册 GenOffice 应用（Dock 图标 + 开窗），
  窗口内容加载本地 BFF 的 origin。不碰 `root` 槽 —— root 属于桌面外壳插件
  （如 chatop-shell）；没有桌面外壳时回落为 harness 官方界面里的普通面板。
- **宿主半**（`src/host-side.cjs`）：拉起/守护 GenOffice 内嵌 BFF sidecar
  （与形态 ③ chatop 桌面内置共用同一套制品：Node BFF + Rust xlsx sidecar +
  SQLite + 本地对象目录），监听 `127.0.0.1` 随机端口，随 `dsh web` 生命周期回收。
  首启做健康检查（`/healthz`）+ 版本自愈（sidecar 损坏则从插件包重解压）。

## 应用注册协议

本插件按 [APPLICATION-SLOT.md](./APPLICATION-SLOT.md) 定义的 `dsh.app-registry`
槽位注册应用，该协议待 chayuan-harness 侧合入（跨仓库 PR）。

## 目录

```
manifest.json        dsh 插件清单（client + host 两半入口）
src/client.js        桌面应用注册 + 窗口打开（__ModuleLoader__ 格式，见构建脚本）
src/host-side.cjs    受管 sidecar：spawn → 健康检查 → 端口回传 → 退出回收
embedded/            内嵌 BFF 制品（第 2 期由 apps/server 打包产物填充）
```

## 状态

骨架阶段：宿主半的 spawn/健康检查/回收逻辑已可用（针对任意 `node` 可执行 BFF），
client 薄壳等待 chayuan-harness 应用槽位协议合入后接线。
