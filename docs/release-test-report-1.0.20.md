# 发版测试报告 — ChaAI Office 1.0.20（六段 1.0.20.0.13.18）

> 2026-11-21。1.0.19 发布同日随轮修复发版：技能导入限额 10MB→1GB（用户令「改个数字即可 限额1g」）。
> 判定：**PASS**（受影响面测试全绿+四 pass 九件+逐包直验+装机冒烟+全渠道送达）。

## 版本决策 — Z+1 而非同版本重打

1.0.19 已对外发布（tag 三仓/GitHub Release 453217941/aidooo latest）。重打同版本会导致：①已装 1.0.19 的用户版本号相同、永远收不到 1GB 修复；②tag 1.0.19（6bc26804e）指向代码与重打资产（8807ef076）错位。Z+1 → 1.0.20 让升级链 1.0.19→1.0.20 正常推送。

## 本轮唯一变更（8807ef076）· 技能导入限额 10MB→1GB

| 层 | 变更 |
|---|---|
| `agent-core/skills-store.ts` | `MAX_IMPORT_BYTES` 10MB→1GB，四检查点（目录遍历/md 字节/zip 流式解压/累计写入）一致 |
| `server/skills-routes.ts` | base64 传输顶 12MB→~1.41GB（1GB binary 的 base64 换算+余量）；文件数守卫消息修正（2000 文件上限原误用「10 MB」文案） |
| `server/app.ts` | Fastify bodyLimit 64MB→2GB——不改它 1GB 语义在 HTTP 层即 413，永远到不了 store |
| `web/shell-shims.ts` | 客户端预检 10MB→1GB |
| 保留 | ZIP 炸弹流式护栏（`inflateWithin` 限额内中断）；单文件夹 2000 文件守卫；symlink/路径检查全部不动 |

验证：typecheck 四工作区 0；agent-core 307/server 38/web 15/shell imported-skills 45 全绿。测试适配两例：**稀疏文件（ftruncate 1GB+1）触发 cap**（statSync 读逻辑大小，证明 1GB 真拦）+ **zip 11MB 成功导入**（锁定放宽语义）。

## 阶段 1 · 版本 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本 Z+1 | ✅ | 1.0.19→1.0.20（root/shell/dsh-plugin+双 lock 五文件；9f3f93bb6） |
| 上游口径 | ✅ | chaofficeUpstreamVersion 0.13.18 不动；六段 **1.0.20.0.13.18** |
| 门禁 | ✅ | 全量 typecheck=0；受影响工作区测试全绿（上表） |

## 阶段 2 · sidecar 与九件打包 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| sidecar 现势 | ✅ 免重编 | 本轮 Rust 零改动（da865da90 后 *.rs 无提交）；五枚交叉产物 Nov 21 全新于 Rust 源 |
| 四 pass | ✅ 全 EXIT 0 | mac dmg+zip→win exe→CHAOFFICE_LINUX_X64=1 linux x64→linux arm64；九件全 1.0.20 |
| 逐包 e_machine 直验 | ✅ | deb 双架 sidecar 0x3e/0xb7 对位+主程序对位；AppImage arm64 0xb7；rpm 双架元数据 chaoffice-1.0.20 x86_64/aarch64；dmg UDZO；exe PE32 |

## 阶段 3 · 装机冒烟 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| Info.plist / asar | ✅ | plist=1.0.20；asar version=1.0.20+chaofficeUpstreamVersion=0.13.18 |
| CLI | ✅ | 装机版 `chaoffice --version` → chaoffice 1.0.20 |
| 版本六段桥（CDP 活体） | ✅ | `getAppVersion()` → **1.0.20.0.13.18**（chaOffice 150 键同形）——隔离 profile 口径：用户 1.0.19 实例占单实例锁，拷贝 app+patch asar name 字段独立 profile 并行冒烟（版本桥逻辑不受 name 影响），冒烟后清理 |
| 品牌 | ✅ | 察元 9 命中/genspark 0 |
| 单实例锁 | ✅ | 同 profile 二次直启后主进程数仍 1 |

## 阶段 4 · tag 与 GitHub Release — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| tag 三仓 | ✅ | origin/gitee main+tag=1.0.20 → 9f3f93bb6；pubmirror 沿例只 tag（ls-remote 逐仓实证） |
| GitHub Release | ✅ | 九资产服务器中继全 201、**FINAL assets=9 uploaded=9、SIZE_MATCH_ALL: true** |

## 阶段 5 · aidooo.com 发布 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 旧版双侧清理 | ✅ | DB office['1.0.19'] 删除（备份 office-entries-backup-20261121-1020.json）+ installer 槽位 1.0.19 删净（find=0） |
| 硬链接十槽位 | ✅ | mac-arm64×2/windows-amd64+arm64/linux-amd64×3/linux-arm64×3 |
| DB 入库 | ✅ | office['1.0.20'] 十条目（variant 沿例；sha256+size 槽位真算）+publishManifest |
| 升级链验收 | ✅ | 公网 latest=**1.0.20**；五平台 1.0.19→1.0.20 **updateAvailable=true**；Range **206**；1MB 段 sha 三方一致（**8146cc54f08b307c**） |

## 阶段 6 · dsh 形态送达 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| dsh 产物 | ✅ | dist/chatop-chaoffice-1.0.20 + dist/chaoffice-1.0.20.tgz（175.5M）全 EXIT 0 |
| harness 重铺 | ✅ | desktop/resources/chatoffice **1.0.20**（vendor 剪枝照常） |
| OS app 覆盖 | ✅ | /Applications/察元AI OS.app/…/chatoffice → **1.0.20**（桌面 0 进程时 rsync --delete） |
| 三方 sha 同源 | ✅ | harness=OS app=dsh-plugin 的 dist/host.js 一致（26fbf1a24d1b7d88） |

## 附注

- **坑再现记账**：`npx asar extract-file … package.json` 在仓库根覆盖真 package.json 后 rm 真删——本轮第二次踩中（git checkout 恢复，版本无漂移）。铁律升级：**asar 一切操作必须 cd 到 scratch 目录再跑**。（追加治理中三犯：verify patch 时又在仓库根跑，第三次恢复——已固化肌肉记忆。）
- 首启 CDP 探测需等 ~25s（xlsx wasm 首启编译开销，1.0.18 已知坑），15s 时端口未起属正常。
- 中继脚本 /root/gh-upload-1.0.20.mjs（日志 /root/gh-upload-1.0.20.log）。
- 飞腾真机（Linux/ARM64 deb）：沿 R32 起不可达附注降级；deb aarch64 主程序+sidecar ELF 字节级直验兜底。

## 追加治理：自动更新提示链修复（用户报告「没有提示新版本」根治）

> 用户在跑的 1.0.19 桌面版未弹 1.0.20 更新提示。诊断=**自动更新链从未接通**：updater.ts 设计为 electron-updater generic provider，feed URL 应在打包时经 `CHAOFFICE_UPDATE_URL` 由 electron-builder publish 配置烧入 resources/app-update.yml；但配置里 **publish 从未写上**，历轮打包产物（1.0.15-1.0.20 全部）都无 app-update.yml——`updateFeedBaseUrl()` 读不到、`checkForUpdates()` 静默失败（15s 首查+4h 轮询的调度代码健在，但每次都抛错被吞），提示链从 1.0.15 起就断；同时 feed 上游的 mac-release-upload/promote-stable 脚本在仓中也不存在，latest\*.yml 从未发布过。aidooo 的 /api/update/check 是下载页升级链，与 electron-updater 自动更新是两条独立链——此前历轮只验收了前者，后者从未端到端过。

修复（三层）：

1. **打包侧**（electron-builder.cjs）：补 publish 配置（generic provider，url 缺省 `https://aidooo.com/downloads/office/update/`，`CHAOFFICE_UPDATE_URL` 可覆盖指向 staging）→ 打包自动烧 app-update.yml。
2. **feed 发布脚本**（scripts/publish-update-feed.mjs，新）：生成 latest-mac.yml（**zip 第一**——MacUpdater `findFile(files,"zip",["pkg","dmg"])` 按扩展挑下载件；**dmg 第二**——manualDownloadUrlFor 挑它做手动安装链接）/latest.yml（NSIS exe）/latest-linux.yml（AppImage+deb；rpm 沿 publish:null 不进 feed），绝对 URL+**base64 sha512**（electron-updater 校验口径）+前向保护（拒绝版本回退，同版本资产刷新允许）。
3. **端到端验收**：update-test 假 feed（9.9.9，独立 URL 前缀）+ 隔离 profile 实例（app-update.yml 手工指向 test feed）→ 启动后 autoUpdater 拉 update-available → **「发现新版本 v1.0.20→v9.9.9」卡片弹出（CDP 截图验收：立即更新/最小化完整）** → 测试 feed 删除（404 复验）。真实 feed 已上线：`https://aidooo.com/downloads/office/update/latest*.yml`（version 1.0.20 公网核验）。

资产替换（同版本重打，沿 1.0.18 追加治理 3 先例）：四 pass 重打烧入 app-update.yml → GitHub 九资产 delete+reupload → aidooo 槽位硬链刷新+DB sha/size 重算+publishManifest → feed yml 重发（sha512/size 随新产物）。

**存量说明**：1.0.19 及更早已装用户手中无 app-update.yml（无检查器），服务端修复救不了——需手动装一次含修复的 1.0.20，此后提示链终身有效。**mac 半自动说明**：本发版未签名，Squirrel.Mac 对下载 zip 的签名校验会失败（updater 内建 MANUAL_FALLBACK_AFTER=2：两次失败后卡片切换手动安装链接，链接从 feed 的 dmg 派生）——mac 用户能看到提示并可手动安装；Windows NSIS/Linux AppImage 可全自动闭环。

**冒烟坑记账**：①Electron 单实例锁按 **productName**（userData 路径）隔离——asar patch 只改 name 不改 productName 仍与已装实例同锁静默退出（DevTools listening 行在锁检查前打印，勿被误导，本轮三次启动失败才钉死）；②asar extract→pack 往返破坏 ad-hoc 签名，arm64 需补 `codesign --force --deep -s -` 重签；③启动探测留足 ~40s（wasm 首启编译+更新窗口创建）；④`npx asar extract-file` 坑三犯（见附注）。
