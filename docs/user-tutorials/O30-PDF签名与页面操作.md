---
id: O30
title: PDF 签名与页面操作（手绘/图片/证书签名；「页面」页签解剖）
entry: 「注释」页签「签名」「证书签名」；「页面」页签
level: P1
tags: [PDF, 签名, 数字证书, 页面操作, 拆分, 合并, Bates 编号]
status: draft
---

## 一句话说明

两类常用 PDF 后处理：①签名——「注释」页签里的「签名」用手绘/输入/图片三种方式在页面落一个手写签名（可存为「我的签名」反复用），「证书签名」用数字证书（.p12/.pfx 或系统证书库）给文件加数字签名，签名后文件另存为新副本，顶部有签名有效性横幅可查看详情；②「页面」页签——旋转、删除、重排、导入、拆分、合并、裁剪、Bates 编号等整套页面级操作。

## 适用场景

- 收到一份要回签的 PDF，想手写签名后发回；
- 要发一份有法律效力的文件，需要数字证书签名（并验证对方发来的签名是否有效）；
- 把几十份扫描件合并成一份、把大文件按章节拆开、给案卷每页盖 Bates 编号。

典型提问（chabot 语料视角）：

- 「PDF 怎么签名？」
- 「怎么把多个 PDF 合并成一个 / 拆分成多个？」
- 「.p12 证书怎么给 PDF 签名？签名有效横幅什么意思？」

## 前置条件

- 手绘/图片签名与页面操作：无需任何配置，全本机完成。
- 证书签名：需要一份签名证书——证书文件（.p12/.pfx）+ 其密码；或系统证书库（Windows 个人证书库 / Linux 的 NSS 数据库，macOS 不提供该来源；Linux 读取需 NSS 工具）。含有效签名的文档打开后顶部显示签名横幅。
- 验证签名有效性时，信任判断依据本机与 Mozilla 内置的 TLS 根证书（Web PKI），而非 Adobe AATL 或欧盟文档签名信任列表——对方用 AATL 证书签的文件可能显示「签名人不受信任」但签名本身完整。

## 操作步骤

**第 1 步 · 手写/图片签名（「注释」页签 ▸「签名」）**

1. 点「**签名**」，弹「**添加签名**」对话框，三个页签：「**手绘**」（鼠标/触屏在手写板写，可「**清除**」重来）、「**输入**」（输入姓名，下方手写体字体卡片实时预览、点选换字体）、「**图片**」（「**添加图片**」选签名照片，勾「**黑白**」把照片处理成黑白笔迹）。
2. 勾选「**保存签名，下次可直接使用**」后，签名存进「**我的签名**」栏（对话框顶部直接点选使用）；每条已存签名右上角有「**删除签名**」按钮。
3. 点「**放置**」后光标携带签名回到页面——点击页面任意位置落下签名（提示「确认后点击页面任意位置落下签名（Esc 取消）」），落点后可拖动/缩放。
4. 有表单签名域的文档：「填写表单」页签的「**签名**」按钮直接落到当前签名域（域上提示「点击签名」）。
5. Ctrl/⌘+S 保存，签名成为文件内容的一部分。

**第 2 步 · 证书签名（「注释」页签 ▸「证书签名」）**

1. 点「**证书签名**」，弹「**使用数字证书签名**」对话框（说明：「使用数字证书（.p12 / .pfx）为此 PDF 签名」「签名后的文件会另存为新文件，原文件保持不变。签名锁定的是磁盘上已保存的内容。」）。
2. 「**证书来源**」二选一：「**证书文件（.p12 / .pfx）**」→「**选择证书…**」选文件并输入证书密码；「**系统证书库**」（仅 Windows/Linux，macOS 上此项不出现，提示「macOS 上暂不支持系统证书库——请使用证书文件（.p12 / .pfx）」）→ 必要时输证书库密码点「**解锁**」。
3. 填可选信息：签名原因、签名地点、联系方式；勾「**在页面上显示签章**」时再选页码与位置；勾「**认证文档（限制后续修改）**」可锁定文档——仅第一个签名能认证（否则提示「只有文档的第一个签名才能用于认证」）。
4. 若文档有未保存修改，先提示「请先保存修改——签名覆盖的是磁盘上已保存的文件」；保存后回到本对话框。
5. 点「**签名并另存为…**」→「正在签名…」→ 成功提示「已保存签名副本：{name}」。签名以增量更新方式追加到新文件，原文件不动，文件里已有的旧签名不受破坏。

**第 3 步 · 查看签名（签名横幅 / 「签名」按钮）**

1. 打开含数字签名的 PDF，页面顶部出现横幅，四态文案：「**签名有效**」／「签名完整，但签名人不受信任」／「已签名——部分签名需要留意」／「已签名——至少有一个签名无效」，右侧「**查看签名**」按钮打开「**数字签名**」面板。
2. 面板逐条列出每个签名：签名人、签名时间、证书链（「证书链指向本机信任的根证书」/「证书链未指向受信任的根证书」）、签名范围（「整个文档」/「仅覆盖已签名部分——之后又添加了内容」）、SHA-256 指纹、哈希算法、序列号、颁发者/主体、有效期；「**转到该页**」跳到签章所在页。
3. 「注释」页签在有签名的文档上也会多出「**签名**」查看按钮（提示「查看此 PDF 中的数字签名」）。

**第 4 步 · 页面级操作（「页面」页签）**

1. 旋转组：「**向左旋转**」「**向右旋转**」（当前页）、「**全部旋转**」。
2. 结构组：「**删除页面**」（当前页，至少留 1 页）；「**抽取本页**」打开「抽取页面为 PDF」框（页码或范围，如 `1-3,5`）生成新文件；「**导入页面**」选另一个 PDF 把它的页面插到当前页之后；「**插入空白页**」在当前页后插入；「**替换页面**」输入要替换的页码范围后选一个 PDF，用它的页面顶掉这些页；「**拆分**」打开「拆分 PDF」（「每 N 页拆分为一个文件（共 {total} 页）」）批量输出；「**合并**」弹文件选择框把多个 PDF 追加到本文档后面（默认名 `原名-merged.pdf`）；「**合并页面**」N-up 拼版——「每张合并页数」（2–16）、「页面顺序」横向/纵向、「显示分隔线」，输出新文件；「**拆分页面**」把每页按网格 1 分 2/4/9 输出新文件。
3. 版面组：「**裁剪页面**」在当前页拖出保留区域，可「应用到全部页面」；「**页面大小**」把所有页缩放到所选纸型。
4. 「**Bates 编号**」：打开 Bates 编号对话框（说明「为每页盖上顺序编号（法律与生产文档常用），保存后成为文件内容的一部分」）。字段：前缀、起始编号、位数（1–15）、字号（6–36）、颜色、位置（左上/顶部居中/右上/左下/底部居中/右下）、起始页、结束页（留空=最后一页）；下方实时预览。点「**应用编号**」成功后提示「已在 {count} 页应用 Bates 编号」。
5. 左栏缩略图支持拖拽重排页序，缩略图右键也有旋转/删除/抽取/导入/插入空白页。所有操作先落在工作副本，Ctrl/⌘+S 统一写盘。

### 验证

1. 手写签名放置并保存后：重新打开文件签名仍在原位；「我的签名」里能看到刚存的签名，下次直接点用。
2. 证书签名后：新副本顶部横幅显示「签名有效」；打开「数字签名」面板能看到签名人/指纹/签名范围「整个文档」；用记事本等工具能看到原文件与新副本大小不同（新副本追加了签名修订）。
3. 合并：对一个 3 页文档点「合并」追加一个 2 页文件并保存，页数变 5、顺序正确；「拆分」按每 1 页拆 5 页文档应得到 5 个文件。
4. Bates 编号后：每页角落出现 `前缀+编号`，位数不足自动补零，保存后用其他阅读器打开仍在。

## 常见问题

**Q1：对方发来的签名显示「签名完整，但签名人不受信任」，文件能用吗？**
签名本身完整（文档未被篡改），只是签发证书的根 CA 不在本机与 Mozilla 内置根证书列表里。政务/商务场景若对方是 AATL 类机构证书，本应用按 Web PKI 口径验证，会出这个提示；是否采信由你们的业务流程决定。面板里「证书链未指向受信任的根证书」同理。

**Q2：签名范围显示「仅覆盖已签名部分——之后又添加了内容」？**
说明签名之后有人又改过这份文件：签名时刻的那部分内容仍受保护，但后来追加的内容不在签名覆盖内。对合同类文件，这通常意味着签完字后文件又被动过，建议向对方核实。

**Q3：macOS 上「证书签名」里没有系统证书库选项？**
设计如此：系统证书库来源仅 Windows/Linux 提供（Linux 还需安装 NSS 工具，界面会提示 `sudo apt install libnss3-tools`）。macOS 请把证书导出为 .p12/.pfx 文件走「证书文件」来源。

**Q4：合并大文件时报错合并限制？**
合并前会先统计所选文件总大小，超过 1 GiB（1024 MB）直接拒绝（错误信息注明「over the 1024 MB merge limit」），避免读入后内存失控。分批合并或先压缩源文件。

**Q5：「认证文档」为什么勾不了？**
认证只能用文档的第一个签名锁定后续修改；这份文件已经有过签名（横幅/签名面板可见）时该项不可用并提示「只有文档的第一个签名才能用于认证」。要认证请在文件无任何签名时做第一个签名。

**Q6：删除页面/重排后还能撤销吗？**
能。页面操作走统一撤销栈（Ctrl/⌘+Z 撤销、Shift+⌘Z 重做），保存前随时可退；保存后再改动则以文件现状为准。

## 形态差异

- 证书签名的「系统证书库」来源按平台区分：macOS 无此选项（用 .p12/.pfx 文件）；Linux 需 NSS 工具。其余签名与页面操作桌面形态全平台一致。
- web/dsh 形态的 PDF 编辑器编辑落盘能力依赖桌面壳（见 O29 形态差异），签名与页面写盘操作同样仅桌面形态可用。

## 事实来源

- `apps/pdf/src/renderer/App.tsx`（注释页签 签名/证书签名/签名查看按钮 L7884-7920；填写表单页签签名按钮 L8101-8119；签名横幅四态与查看 L8522-8539；页面页签全部按钮 L8287-8465；合并/拆分/替换/页面大小/拆分页面确认逻辑 L6186-6260；缩略图右键 L10439-10495）
- `apps/pdf/src/renderer/i18n/strings.ts` zh 块（sign/signTitle/signDraw/signType/signImage/signAddImage/signBw/signTypePlaceholder/signSave/signSaved/signSavedDelete/signPlace/signHint、certSign 系列（certSignTitle/certSignHint/certSignIntro/certSource/certSourceFile/certSourceSystem/certStoreUnsupported/certStoreNoTools/certStoreUnlock/certChoose/certPassword/certReason/certLocation/certContact/certVisible/certPage/certCertify/certCertifyUnavailable/certSaveFirst/certSignButton/certSigning/certSigned）、sig* 系列（sigBannerValid/sigBannerView/sigPanel/sigPanelTitle/sigChain/sigChainTrusted/sigChainUntrusted/sigCovers/sigCoversAll/sigCoversPart/sigFingerprint/sigHash/sigSerial/sigIssuedBy/sigSubject/sigValidFrom/sigValidTo/sigGoToPage/sigTrustRoots/sigNoRevocation）、rotateLeft/rotateRight/rotateAllPages/deletePage/extractPage/extractRangeTitle/extractRangeHint/insertPdf/insertBlankPage/replacePages/replaceRangeHint/splitPdf/splitDlgTitle/splitDlgHint/mergePdf/mergePages/mergePagesHint/mergePagesCount/mergePagesSeq/seqHorizontal/seqVertical/mergePagesSeparator/splitPages/splitPagesHint/splitNLabel/cropPages/cropAllPages/pageSize/pageSizeHint/reversePages、bates 全套、formSignField）
- `apps/pdf/src/renderer/i18n/cert-sign-strings.ts`（横幅四态：sigBannerValid/sigBannerUntrusted/sigBannerWarning/sigBannerInvalid）
- `apps/pdf/src/renderer/SignatureDialog.tsx`（三页签与我的签名）
- `apps/pdf/src/renderer/CertSignDialog.tsx`（证书来源下拉 IS_MAC 隐藏 system、解锁、认证开关禁用态）
- `apps/pdf/src/renderer/SignaturesDialog.tsx`、`apps/pdf/src/renderer/pdf-signatures.ts`、`apps/pdf/src/main/pdf-signatures.ts`（签名面板字段与验证口径）
- `apps/pdf/src/main/pdf-sign.ts`（增量更新追加签名修订：L387 注释「Append a signature revision … incremental update, so earlier signatures stay」）
- `apps/pdf/src/main/pdf-main.ts`（MAX_MERGE_TOTAL_BYTES = 1_073_741_824 与超限错误文案 L1226-1247；mergePdf 保存对话框与默认名）
- `apps/pdf/src/renderer/BatesDialog.tsx`、`apps/pdf/src/renderer/bates.ts`（Bates 字段与应用）
