# WPS 功能区参考资产（仅供风格参考，禁止随产品分发）

从本机 WPS 安装包解包的图标与名字资产，作为自绘察元功能区的**视觉参考基准**。
共识决定（2026-09-10，Q11=A）：布局规格/结构/交互态可一比一对照，图标全部自绘同风格；
本目录资产只用于肉眼对照与校准，**不得复制进察元产品分发**（金山美术资产）。

- 来源：`/Applications/wpsoffice.app/Contents/Resources/office6/mui/default/*.rcc`（WPS 12.1.28492）
- 提取日期：2026-09-10；提取脚本：`/tmp/qres_extract_all.py`（临时工具，qres=自研容器：28 字节头 + 顺序 zlib 流 + 尾部 UTF-16LE 名字表）
- 每个 `<名>/index.html` 是缩略图墙，浏览器直接打开浏览。

## 各目录内容

| 目录 | 内容 | 价值 |
|---|---|---|
| `prometheus_kso/` | **545 张 SVG（新 UI 矢量图标，含 `*_kd` 命名）** + names.txt | ★★★ 自绘图标的首要风格基准 |
| `ico/` | 73 张 PNG（ico.rcc 内嵌 ICO 的多尺寸位图，16~512px） | 窗口/通用图标参考 |
| `public_res/` | 92 个文件（PNG/SVG/文本） | 公共控件图标参考 |
| `ongmani_res/` | 名字表为主，图标主体是自研原始位图格式（`01+关键色` 头，未破解） | 名字清单有对照价值 |
| `2016white_highdpi/` | 同上，经典皮肤图标未破解 | 名字清单 |
| `mso_builtin_icons/` | MSO 内置图标（blob 多为未破解位图） | 名字清单可对齐 idMso |

## 命名说明

- SVG/PNG 文件按 blob 顺序编号；真实文件名清单在同目录 `names.txt`（UTF-16LE 明文采集，顺序近似对应）。
- ribbon.xml/kuip 里引用的 2285 个图标名（如 `paste_kd`）见分析记录；与 names.txt 交叉对照即可定位风格近似的原版图标。

## 布局规格事实（另见记忆与共识记录）

- 命令/布局声明：`office6/res/commands/<app>/ongmani/CT_*.kuip`（明文 XML，每 tab 一个文件）
- 皮肤/交互态颜色：`office6/skins/*/uicontrol.kuip`
- 自适应参数：每命令 `spaceHint`(loose/suitable/topsuitable/compact/autocompact) + `canHideText` + `controlType`；布局树 `KRbLayoutListCommand`(vbox/hbox/间距/固定宽) + `KxSingleRowMergeGroupCommand`

## 2026-09-10 晚增补（源：~/Desktop/WPS-icon，qres 全量破解第二轮）

- **`_layouts/`**（4.6MB，169 文件）★ 一手规格基准：wps_文字 46 tab / et_表格 37 / wpp_演示 40 /
  pdf_PDF 34 个**完整明文布局 XML**，每家另含 common（命令注册表，含 idMso/icon/快捷键）、
  entries（entry 平表）、`<app>ongmani.kui`（tab 清单）。属性速查表见 `_layouts/说明.md`
  （spaceHint 五级 / canHideText / controlType 枚举 / minimumWidth/fixedWidth 宽度硬规格）。
  Excel「开始」页 = `_layouts/et_表格/tab布局_ongmani/CT_Home.kuip`。
- **`破解说明.md` + `README.txt` + `_scripts/`**：qres 容器格式全记录（名字区已 100% 解出、
  树区 22B 定长记录已定位但 join 规则未破）+ 可重跑提取脚本。原始 17 个 `.rcc` 备份留在
  `~/Desktop/WPS-icon/_originals/`（37MB，未入仓库，脚本可重新生成一切）。
- **勘误**：本目录早期 README 称 SVG「含 `*_kd` 命名」——**实际 SVG 文件是按 blob 顺序编号的**，
  `*_kd` 真名只在 `names.txt`；**名字↔文件的 join 规则未破解**，「按图标名取原版图」目前做不到。
  图标开工前需先破 join（见破解说明.md §五.1）或按视觉索引。
- 本目录整体保持 **untracked（不入 git）**；金山美术资产禁止随产品分发的红线不变。
