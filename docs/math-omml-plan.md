# 数学公式 OMML 三端 · 立项共识（v1）

> 状态：共识已达成（2026-09-06，14 问逐题收敛），本文为实施合同。
> 里程碑：M-A 引擎核心 → M-B 渲染+op → M-C 对话框 UI+i18n，各自全绿后推送。

## 0. 一句话总纲

"三端 + AI op + 手动 UI"：解析端把 pptx 里的 OMML 公式读成内部 IR（无损保存原始字节），渲染端用自研盒模型布局在 Konva 画布上近似绘制（矢量线条画分数栏/根号/定界符），生成端让模型写 **LaTeX 受控子集**、引擎内转换器转 OMML 以 a14:m 标准包装落盘——PowerPoint 2010+/WPS 打开是原生可编辑公式，我们画布是自研近似渲染。

## 1. 已共识的决定（编号引用）

| # | 决定 | 内容 |
|---|---|---|
| 1 | v1 范围 | 三端 + AI op + **手动 UI 对话框（Ribbon「插入→公式」）**（用户修正：UI 提前进 v1） |
| 2 | 模型输入 | **LaTeX 受控子集**，引擎内转换器 → OMML（模型不写原生 OMML） |
| 3 | 子集边界 | 单行全量（分数/上下标/根号/定界符/∑∫ 带上下限/帽子向量条/函数名/极限/希腊与关系符）+ **多行与矩阵全进 v1**（用户两次扩围，最终确认全量） |
| 4 | 预览形态 | **同源 Konva 预览**：对话框内小 canvas 复用与主画布完全同一套 IR→布局→绘制代码，渲染引擎只写一份 |
| 5 | 编辑闭环 | **LaTeX 源存 descr 载荷**（ink 先例，复制/粘贴/另存自然携带）+ **双击公式元素重开对话框**预填源码，改完原位替换 |
| 6 | 降级显示 | 画布渲染子集覆盖不到的构造**线性化降级**（加 ⁅ 标记），宁可保守不画错；PowerPoint/WPS 打开不受影响 |
| 7 | 字体基线 | **衬线栈+合成斜体**（变量 sty=i 斜体、数字/运算符直立）；分数线/根号/定界符拉伸用矢量线条；不捆绑数学字体（Cambria Math 授权不可分发，STIX 需 MATH 表布局工程量质变） |
| 8 | 重建保真 | **字节直通+op 跳过**：TextRun.math 存原始 OMML 字节，段落 rebuild 原样回写；文本类 op（setText/findReplace）不改写公式内部文本；字号/颜色等外层格式化作用于 run 的 a:rPr |
| 9 | 兼容基线 | 生成 **a14:m 标准包装**（MS-ODRAWXML，PowerPoint 2010+/WPS 最新版原生可编辑公式）；老查看器公式不显示，不做图片 fallback |
| 10 | 验收清单 | 八条单行（E=mc²、二次求根公式、∫、∑、x̄/ŷ/v⃗、lim、希腊+关系符、嵌套分数）+ **⑨cases ⑩aligned ⑪矩阵六变体+array(lcr) ⑫eqArr/split 多行方程组**，即转换器与渲染的单测用例集 |
| 11 | 矩阵环境 | **六大 matrix 变体（pmatrix/bmatrix/Bmatrix/vmatrix/Vmatrix/matrix）+ array(lcr 列规格) + eqArr（方程组数组）+ split（多行推导）**（用户扩围），OMML 侧对齐 m:mcs/m:eqArr |
| 12 | 容错三面 | **AI op 解析失败→降级插入线性文本 + 失败语义回喂**（output 写明降级原因与"修正后重新插入"指引，模型可自纠）；手动对话框→红字提示+按钮禁用；第三方文件→绝不报错，线性化降级 |
| 13 | 降级语义 | 见 12：降级插入 + **失败语义回喂**（用户立刻看到东西，模型拿到自纠信号；降级文本非公式元素，双击不弹对话框） |
| 14 | 分期节奏 | **三里程碑各自全绿后推送**（M-A/M-B/M-C），小步减少与并行线的冲突面 |

## 2. 派生默认细则（无异议即按此执行）

- **双击路由**：独立公式元素（addMath 产物）双击弹编辑对话框；混排文本框（第三方文件里公式与文字同段）双击仍进文本编辑——混排段落的公式按 #8 字节直通保护。
- **descr 载荷格式**：`chatoffice-math:<latex>` 前缀标记，与 ink 载荷共存约定一致。
- **addMath op 形态**：`{latex, target:{slide}, offset:{x,y,cx,cy}, fontSizePt?}`，走 apply_ops 词汇表（不设独立工具——模型对 applyOps 已熟练）；offset 为 EMU。
- **渲染排版基线**：行内块（run 内联在文字流中，越过基线上下伸展）；独立公式元素居中段落。
- **测试即验收**：#10 清单逐条成为 LaTeX→IR→OMML→parse 回环断言 + 渲染布局快照断言。
- **工程落点**：packages/pptx-engine/src/math/（ir/omml-parse/omml-serialize/latex 四文件）；渲染布局 packages/pptx-render/src/math-layout.ts；op 在 apps/slides/src/main/ops；对话框 packages/ui + 三宿主接线（v1 只接 slides 宿主，docs/sheets 后续）。

## 3. 明确不做（v1）

- MathML/原生 OMML 作为模型输入语言；图片 fallback；数学字体捆绑（STIX/Cambria Math）；
- OMML→LaTeX 反向转换（编辑走存源）；groupChr/phant 等冷门构造的专门渲染（线性化降级覆盖）；
- docs/sheets 宿主的对话框接线（v1 只 slides）；公式跨页/跨元素复制粘贴的特殊处理（随普通文本元素走）。
