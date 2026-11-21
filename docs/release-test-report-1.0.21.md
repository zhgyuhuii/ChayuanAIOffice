# 发版测试报告 — ChaAI Office 1.0.21（六段 1.0.21.0.13.18）

> 2026-11-21。1.0.20 发布同日随轮修复发版：右侧项目文件树钉根后不显示内容的信任边界修复（用户报告）。
> 判定：**PASS**（受影响面测试全绿+真机端到端复现验证+四 pass 九件+装机冒烟+全渠道送达）。

## 版本决策 — Z+1 而非同版本重打

1.0.20 已全渠道发布（tag 三仓/GitHub Release 453258992/aidooo latest/feed）。重打同版本会让已装 1.0.20 用户收不到修复+tag/资产错位。Z+1 → 1.0.21 让升级链 1.0.20→1.0.21 正常推送——**且这是提示链接通后的第一个受益版本**：已装 1.0.20 的用户会在应用内直接收到 1.0.21 的更新卡片。

## 本轮唯一变更（3ae0ed70a）· 右侧项目文件树钉根修复

**现象**（用户报告）：新建项目时选了本地文件夹，点项目行「查看文件」图标后，右侧文件树不显示该文件夹下的任何文件与文件夹。

**根因**：主进程树通道（listFolder 及建/改名/移动）的信任边界 `insideAnyRoot` 只认 folderRoots（默认保存目录+手动「添加文件夹」根），项目绑定的 rootPath 不在其中——每次列目录都被静默拒空。

**修复**：`insideAnyRoot` 扩展项目 rootPath 子树（读写通道一并放行，右侧项目树全功能对齐左侧）；`ensureFolderWatchers` 纳入项目根（树内容实时刷新）。附带：electron-builder.cjs 的 publish URL 校验改用 `require('node:url')`（测试 VM 无 WHATWG URL 全局）。

验证：typecheck 全量 0；shell vitest 139 文件 1464 用例全绿；真机端到端——绑定外部文件夹的测试项目钉根树渲染全部子文件夹与文件、既有外部项目（年度工作总结）钉根树同样恢复内容。

## 阶段 1 · 版本 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本 Z+1 | ✅ | 1.0.20→1.0.21（root/shell/dsh-plugin+双 lock 五文件；1020388a0） |
| 上游口径 | ✅ | chaofficeUpstreamVersion 0.13.18 不动；六段 **1.0.21.0.13.18** |
| 门禁 | ✅ | 全量 typecheck=0；shell vitest 全绿（3ae0ed70a 提交验证） |

## 阶段 2 · sidecar 与九件打包 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| sidecar 现势 | ✅ 免重编 | 本轮 Rust 零改动；五枚交叉产物 Nov 21 全新于 Rust 源 |
| 四 pass | ✅ 全 EXIT 0 | mac dmg+zip→win exe→CHAOFFICE_LINUX_X64=1 linux x64→linux arm64；九件全 1.0.21 |
| app-update.yml | ✅ | dmg 挂载直验：generic → aidooo.com/downloads/office/update（1.0.20 已接通，本版随链烧入） |
| 逐包直验 | ✅ | deb 双架 sidecar 0x3e/0xb7 对位；AppImage arm64 0xb7；rpm 双架元数据 1.0.21 |

## 阶段 3 · 装机冒烟 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本六段桥（CDP 活体） | ✅ | `getAppVersion()` → **1.0.21.0.13.18**（隔离 profile 口径） |
| **文件树修复装机复验** | ✅ | 装机实例绑定外部文件夹项目 RootTest21 → 点查看文件图标 → 钉根树渲染 `docs / README.md` 全内容（懒加载语义正确）；首轮 dev 实例同场景 RootTest/年度工作总结两例已验 |
| 清理 | ✅ | 测试项目从 dev profile store 删除（store 目录+index） |

## 阶段 4 · tag 与 GitHub Release — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| tag 三仓 | ✅ | origin/gitee main+tag=1.0.21 → 1020388a0；pubmirror 沿例只 tag |
| GitHub Release | ✅ | **release 453403368** 九资产中继全 201、FINAL assets=9 uploaded=9、**SIZE_MATCH_ALL: true**；body 按「无上游品牌」规范撰写（只写本次用户可感知变更） |

## 阶段 5 · aidooo.com 发布 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 旧版双侧清理 | ✅ | /data/installers/chaoffice-1.0.20 删除；DB office['1.0.20'] 删除（备份 office-entries-backup-20261121-1021.json）；槽位 1.0.20 文件删净（find=0） |
| 硬链接十槽位 | ✅ | mac×2/win×2（exe 复用）/linux×6 |
| DB 入库 | ✅ | office['1.0.21'] 十条目（variant 沿例；sha256+size 槽位真算）+publishManifest |
| 升级链验收 | ✅ | 公网 latest=**1.0.21**；五平台 1.0.20→1.0.21 updateAvailable；Range **206**；1MB 段 **本地=公网一致（066109f40d46f59f）** |
| feed 重发 | ✅ | latest-mac/win/linux.yml → version **1.0.21**（公网核验；sha512 随新产物） |

## 阶段 6 · dsh 形态送达 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| dsh 产物 | ✅ | dist/chatop-chaoffice-1.0.21 + chaoffice-1.0.21.tgz（175.5M）全 EXIT 0 |
| harness 重铺 + OS app | ✅ | harness 与 /Applications/察元AI OS.app/…/chatoffice 均 **1.0.21**（桌面 0 进程时 rsync --delete） |
| 三方 sha 同源 | ✅ | harness=OS app=dsh-plugin 的 dist/host.js 一致（26fbf1a24d1b7d88） |

## 附注

- 发布文案按「无上游品牌」规范执行（1.0.19/1.0.20 在线 body 已同规范改写）。
- 1.0.19 及更早已装用户仍需手动装一次 1.0.20+（提示链接通的起点）；1.0.20 已装用户本次会直接收到 1.0.21 更新卡片。
- 中继脚本 /root/gh-upload-1.0.21.mjs（日志 /root/gh-upload-1.0.21.log）。
