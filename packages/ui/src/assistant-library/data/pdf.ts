// generated 助手库数据(pdf) — 整体要求: 每类 ≥100 助手 — do not edit by hand
import type { AssistantDomain } from '../types'

export const PDF_ASSISTANT_DOMAINS: AssistantDomain[] = [
 {
  "key": "read",
  "label": "阅读理解",
  "icon": "📖",
  "items": [
   {
    "label": "全文摘要",
    "icon": "📝",
    "description": "生成全文摘要(300 字+3 个要点)",
    "prompt": "请通读当前 PDF,生成 300 字摘要与 3 个核心要点,保留关键数据。",
    "id": "pdf.read.1"
   },
   {
    "label": "章节导读",
    "icon": "🗂️",
    "description": "按章节生成导读地图",
    "prompt": "请按 PDF 章节结构生成导读地图:每章一句话主旨+关键页码,方便跳读。",
    "id": "pdf.read.2"
   },
   {
    "label": "概念解释",
    "icon": "💡",
    "description": "提取专业概念并通俗解释",
    "prompt": "请提取文中专业术语与概念,逐一给出通俗解释与出处页码。",
    "id": "pdf.read.3"
   },
   {
    "label": "问答精读",
    "icon": "❓",
    "description": "生成 10 个精读问答",
    "prompt": "请基于全文生成 10 个理解性问题并自答,覆盖主要论点与证据。",
    "id": "pdf.read.4"
   },
   {
    "label": "观点提炼",
    "icon": "🧠",
    "description": "区分事实与观点并提炼立场",
    "prompt": "请区分文中事实陈述与观点判断,提炼作者核心立场与论证链条。",
    "id": "pdf.read.5"
   },
   {
    "label": "数据速览",
    "icon": "📊",
    "description": "提取关键数据成表",
    "prompt": "请提取文中所有关键数据(指标/数值/年份/来源页),生成数据速览表。",
    "id": "pdf.read.6"
   },
   {
    "label": "人物机构",
    "icon": "👥",
    "description": "梳理人物与机构关系",
    "prompt": "请梳理文中人物与机构,生成名录表(名称/角色/立场/出现页)。",
    "id": "pdf.read.7"
   },
   {
    "label": "时间线",
    "icon": "🕰️",
    "description": "按事件生成时间线",
    "prompt": "请提取文中事件按时间排序,生成时间线(日期/事件/意义)。",
    "id": "pdf.read.8"
   },
   {
    "label": "金句摘录",
    "icon": "✨",
    "description": "摘录 10 句金句",
    "prompt": "请摘录 10 句最具引用价值的原文(注明页码),各附使用场景建议。",
    "id": "pdf.read.9"
   },
   {
    "label": "批判性阅读",
    "icon": "🔍",
    "description": "评估论证强弱",
    "prompt": "请批判性阅读全文:论证强的 3 点、薄弱的 3 点(证据/逻辑/样本),给出可信度评价。",
    "id": "pdf.read.10"
   }
  ]
 },
 {
  "key": "translate",
  "label": "翻译本地化",
  "icon": "🌐",
  "items": [
   {
    "label": "全文翻译",
    "icon": "🌐",
    "description": "整篇翻译为中文(保留结构)",
    "prompt": "请将当前 PDF 全文翻译为中文,保留章节结构与图表标题,术语首次出现附原文。",
    "id": "pdf.translate.1"
   },
   {
    "label": "双语对照",
    "icon": "📄",
    "description": "生成中英双语对照表",
    "prompt": "请按段落生成中英双语对照表(左英右中),按页码排序。",
    "id": "pdf.translate.2"
   },
   {
    "label": "术语表",
    "icon": "📚",
    "description": "先提术语表统一译法",
    "prompt": "请先提取专业术语生成中英术语表(统一译法),再按表翻译前 3 页作样张。",
    "id": "pdf.translate.3"
   },
   {
    "label": "合同翻译",
    "icon": "⚖️",
    "description": "合同条款精准翻译",
    "prompt": "请翻译合同类 PDF,保留条款编号与结构,法律术语用通行译法,不确定处标注。",
    "id": "pdf.translate.4"
   },
   {
    "label": "摘要英译",
    "icon": "🎓",
    "description": "中译学术英语摘要",
    "prompt": "请将中文摘要翻译为学术英语,使用领域惯用表达与被动语态风格。",
    "id": "pdf.translate.5"
   },
   {
    "label": "本地化润色",
    "icon": "✨",
    "description": "按目标市场润色译文",
    "prompt": "请按目标读者习惯润色译文:单位换算、案例本地化、语气调整,列出改动点。",
    "id": "pdf.translate.6"
   },
   {
    "label": "图表文字翻译",
    "icon": "📊",
    "description": "翻译图表内文字",
    "prompt": "请翻译 PDF 中图表内文字(标题/轴标签/图例),以原图位置→译文列表交付。",
    "id": "pdf.translate.7"
   },
   {
    "label": "机翻校对",
    "icon": "🛠️",
    "description": "校对机翻译文",
    "prompt": "请校对提供的机翻译文:修正误译/漏译/术语不一致,输出修订对照与理由。",
    "id": "pdf.translate.8"
   },
   {
    "label": "多语言要点",
    "icon": "🈯",
    "description": "要点译日/韩/英三语",
    "prompt": "请将全文核心要点分别译为日语、韩语、英语,三语并列成表。",
    "id": "pdf.translate.9"
   },
   {
    "label": "字幕式提炼",
    "icon": "🎬",
    "description": "提炼 20 条字幕短句",
    "prompt": "请将全文核心提炼为 20 条每条不超过 20 字的中文字幕式短句。",
    "id": "pdf.translate.10"
   }
  ]
 },
 {
  "key": "review",
  "label": "批注审阅",
  "icon": "🖍️",
  "items": [
   {
    "label": "审阅批注",
    "icon": "🖍️",
    "description": "生成批注清单",
    "prompt": "请以审阅者身份通读 PDF,生成批注清单:页码/位置/问题类型(表述/逻辑/数据)/修改建议。",
    "id": "pdf.review.1"
   },
   {
    "label": "合同风险批注",
    "icon": "⚖️",
    "description": "甲方视角风险批注",
    "prompt": "请从甲方视角审查合同,对不利条款逐条批注(风险/修改建议/法条参考),按风险排序。",
    "id": "pdf.review.2"
   },
   {
    "label": "论文评审",
    "icon": "📄",
    "description": "审稿人格式评审意见",
    "prompt": "请以审稿人身份评审:总结、优点 3 条、主要问题 3 条、次要问题、推荐结论。",
    "id": "pdf.review.3"
   },
   {
    "label": "逻辑漏洞",
    "icon": "🧠",
    "description": "标注论证薄弱处",
    "prompt": "请标注文中论证薄弱处(因果跳跃/样本不足/以偏概全),每处附改进建议。",
    "id": "pdf.review.4"
   },
   {
    "label": "格式合规",
    "icon": "📐",
    "description": "排版规范检查",
    "prompt": "请检查字体一致性/页边距/编号连续/图表引用对应,生成格式问题清单。",
    "id": "pdf.review.5"
   },
   {
    "label": "错别字扫描",
    "icon": "🔤",
    "description": "错别字与标点扫描",
    "prompt": "请扫描全文错别字、标点误用与单位不规范处,生成勘误表(页码/原文/建议)。",
    "id": "pdf.review.6"
   },
   {
    "label": "数据核实",
    "icon": "🔢",
    "description": "核对数据一致性",
    "prompt": "请核对正文与表格图表数据是否一致,列出不一致处与页码。",
    "id": "pdf.review.7"
   },
   {
    "label": "引用核对",
    "icon": "📚",
    "description": "引用格式与对应核对",
    "prompt": "请检查文末参考文献与文中引用的对应关系与格式,列出问题条目。",
    "id": "pdf.review.8"
   },
   {
    "label": "敏感排查",
    "icon": "🕵️",
    "description": "敏感信息排查",
    "prompt": "请排查身份证/手机号/银行卡等敏感信息,生成脱敏建议清单(页码/类型/处理)。",
    "id": "pdf.review.9"
   },
   {
    "label": "修订对照",
    "icon": "🔀",
    "description": "两版本差异对照",
    "prompt": "请对比 PDF 两个版本,生成修订对照表(页码/旧文/新文/变更类型)。",
    "id": "pdf.review.10"
   }
  ]
 },
 {
  "key": "contract",
  "label": "合同法务",
  "icon": "⚖️",
  "items": [
   {
    "label": "要点提取",
    "icon": "📌",
    "description": "六要素要点表",
    "prompt": "请提取合同的当事人/标的/金额/期限/违约责任/争议解决六要素,生成要点表。",
    "id": "pdf.contract.1"
   },
   {
    "label": "履约清单",
    "icon": "✅",
    "description": "履约义务检查清单",
    "prompt": "请按条款生成双方履约义务清单(义务/时限/验收标准/现状)。",
    "id": "pdf.contract.2"
   },
   {
    "label": "违约分析",
    "icon": "🚨",
    "description": "违约情形与救济",
    "prompt": "请梳理违约情形约定,对应救济方式(解除/赔偿/违约金),生成应对表。",
    "id": "pdf.contract.3"
   },
   {
    "label": "条款比对",
    "icon": "🔀",
    "description": "与标准模板比对",
    "prompt": "请将本合同与常见标准条款逐条比对,标注删除/修改/新增及风险。",
    "id": "pdf.contract.4"
   },
   {
    "label": "付款梳理",
    "icon": "💰",
    "description": "付款节点跟踪表",
    "prompt": "请提取付款条款(节点/比例/条件),生成跟踪表并标注当前应付款。",
    "id": "pdf.contract.5"
   },
   {
    "label": "IP 条款",
    "icon": "©️",
    "description": "知识产权归属梳理",
    "prompt": "请提取知识产权条款(著作权/专利/保密),生成归属一览表并提示空白。",
    "id": "pdf.contract.6"
   },
   {
    "label": "NDA 审查",
    "icon": "🔒",
    "description": "保密协议四要素审查",
    "prompt": "请审查保密协议的范围/期限/例外/违约责任,标注缺失项。",
    "id": "pdf.contract.7"
   },
   {
    "label": "风险标注",
    "icon": "🚦",
    "description": "全合同三级风险标注",
    "prompt": "请按高/中/低风险标注条款,高风险给修改建议文本。",
    "id": "pdf.contract.8"
   },
   {
    "label": "合规提示",
    "icon": "🏛️",
    "description": "法规合规要点",
    "prompt": "请对照现行法规提示合规要点(格式条款/个人信息/劳动),给调整建议。",
    "id": "pdf.contract.9"
   },
   {
    "label": "谈判要点",
    "icon": "🤝",
    "description": "谈判要点清单",
    "prompt": "请基于审查结果生成谈判要点:必争项/可交换项/可让步项与话术方向。",
    "id": "pdf.contract.10"
   }
  ]
 },
 {
  "key": "paper",
  "label": "学术论文",
  "icon": "🎓",
  "items": [
   {
    "label": "综述梳理",
    "icon": "📚",
    "description": "相关工作分类与演进",
    "prompt": "请梳理相关工作:按方法分类,各分支代表工作/优劣/与本文关系,生成综述表。",
    "id": "pdf.paper.1"
   },
   {
    "label": "方法要点",
    "icon": "🔬",
    "description": "方法实现要点与伪代码",
    "prompt": "请提炼方法实现要点:输入输出、关键步骤伪代码、超参数与评测设置。",
    "id": "pdf.paper.2"
   },
   {
    "label": "实验解读",
    "icon": "📊",
    "description": "实验表格解读",
    "prompt": "请解读实验表格:基线对比、消融贡献,评估结论是否被实验支撑。",
    "id": "pdf.paper.3"
   },
   {
    "label": "公式解析",
    "icon": "🧮",
    "description": "逐个解析公式",
    "prompt": "请解析论文各公式的含义、变量定义与推导逻辑,用通俗语言讲解。",
    "id": "pdf.paper.4"
   },
   {
    "label": "延伸阅读",
    "icon": "🔗",
    "description": "参考文献阅读路径",
    "prompt": "请基于参考文献规划延伸阅读路径(先读哪篇/解决什么疑问)。",
    "id": "pdf.paper.5"
   },
   {
    "label": "写作模板",
    "icon": "✍️",
    "description": "结构与句式模板",
    "prompt": "请提炼论文的章节结构与高频学术句式,生成可复用写作模板。",
    "id": "pdf.paper.6"
   },
   {
    "label": "投稿建议",
    "icon": "📮",
    "description": "期刊会议投稿建议",
    "prompt": "请评估创新与完成度,给出冲/稳/保 3 个投稿目标与侧重要求。",
    "id": "pdf.paper.7"
   },
   {
    "label": "答辩问题库",
    "icon": "❓",
    "description": "12 个答辩问题",
    "prompt": "请生成 12 个可能被问的问题(方法/对比公平性/泛化性),附答题思路。",
    "id": "pdf.paper.8"
   },
   {
    "label": "复现清单",
    "icon": "🧰",
    "description": "复现资源清单",
    "prompt": "请列出复现所需数据集/代码/算力/关键实现细节清单,标注获取难度。",
    "id": "pdf.paper.9"
   },
   {
    "label": "中英摘要",
    "icon": "🌐",
    "description": "中英摘要对照",
    "prompt": "请生成中文摘要与英文摘要对照版本,英文符合学术规范。",
    "id": "pdf.paper.10"
   }
  ]
 },
 {
  "key": "fin",
  "label": "财务报告",
  "icon": "💰",
  "items": [
   {
    "label": "财报速览",
    "icon": "📑",
    "description": "一页速览",
    "prompt": "请通读财报,生成一页速览:营收/净利/毛利率/经营现金流及同比,加一句总体判断。",
    "id": "pdf.fin.1"
   },
   {
    "label": "MDAT 提炼",
    "icon": "🗣️",
    "description": "管理层讨论提炼",
    "prompt": "请提炼管理层讨论与分析部分的重点表述(战略/风险/展望),按主题归类。",
    "id": "pdf.fin.2"
   },
   {
    "label": "财务比率",
    "icon": "🧮",
    "description": "12 项比率计算",
    "prompt": "请基于三大报表计算偿债/营运/盈利比率,生成比率表与趋势判断。",
    "id": "pdf.fin.3"
   },
   {
    "label": "附注深挖",
    "icon": "🔎",
    "description": "附注隐藏信息",
    "prompt": "请从附注提取减值准备、关联交易、或有事项,生成关注清单。",
    "id": "pdf.fin.4"
   },
   {
    "label": "同业对比",
    "icon": "🏭",
    "description": "关键指标同业对比",
    "prompt": "请就营收增速/毛利率/费用率与行业可比区间对比,给竞争力判断。",
    "id": "pdf.fin.5"
   },
   {
    "label": "风险解读",
    "icon": "⚠️",
    "description": "风险提示解读",
    "prompt": "请解读风险提示章节:逐条说明业务影响与监测信号。",
    "id": "pdf.fin.6"
   },
   {
    "label": "审计意见",
    "icon": "🧾",
    "description": "审计意见解读",
    "prompt": "请解读审计意见类型(标准/保留/否定/无法表示)及对报表可信度影响。",
    "id": "pdf.fin.7"
   },
   {
    "label": "现金流质量",
    "icon": "💧",
    "description": "盈利质量分析",
    "prompt": "请对比净利润与经营现金流净额,分析盈利质量(应计占比),给判断。",
    "id": "pdf.fin.8"
   },
   {
    "label": "募投跟踪",
    "icon": "🏗️",
    "description": "募投项目进展",
    "prompt": "请提取募投项目的计划投入/实际投入/进度/效益,生成跟踪表。",
    "id": "pdf.fin.9"
   },
   {
    "label": "投资要点",
    "icon": "📌",
    "description": "浓缩投资要点一页",
    "prompt": "请浓缩财报为投资要点:3 正面+3 风险+结论,适合投委会传阅。",
    "id": "pdf.fin.10"
   }
  ]
 },
 {
  "key": "tech",
  "label": "技术手册",
  "icon": "🛠️",
  "items": [
   {
    "label": "API 速查",
    "icon": "🔌",
    "description": "API 速查表",
    "prompt": "请提取手册中所有 API 的名称/参数/返回值/示例,生成速查表。",
    "id": "pdf.tech.1"
   },
   {
    "label": "部署步骤",
    "icon": "📦",
    "description": "安装部署清单",
    "prompt": "请提炼安装部署章节为步骤清单(前置条件/命令/验证点)。",
    "id": "pdf.tech.2"
   },
   {
    "label": "故障排查树",
    "icon": "🌲",
    "description": "排查决策树",
    "prompt": "请把故障章节整理为排查决策树(现象→检查→分支处置),文字树状图。",
    "id": "pdf.tech.3"
   },
   {
    "label": "配置说明",
    "icon": "⚙️",
    "description": "配置项表格",
    "prompt": "请提取所有配置项生成配置表(名称/类型/默认值/说明/生效方式)。",
    "id": "pdf.tech.4"
   },
   {
    "label": "升级指南",
    "icon": "🚀",
    "description": "版本升级迁移",
    "prompt": "请整理升级章节为迁移指南(版本跨度/兼容性/步骤/回滚方案)。",
    "id": "pdf.tech.5"
   },
   {
    "label": "安全基线",
    "icon": "🔒",
    "description": "安全配置清单",
    "prompt": "请提取安全相关配置(认证/加密/权限/审计),生成基线检查清单。",
    "id": "pdf.tech.6"
   },
   {
    "label": "示例代码",
    "icon": "💻",
    "description": "示例代码集",
    "prompt": "请提取手册中的示例代码块,注明语言、用途与依赖,整理成代码集。",
    "id": "pdf.tech.7"
   },
   {
    "label": "术语表",
    "icon": "📖",
    "description": "术语中英对照",
    "prompt": "请生成手册术语中英对照表并附一句话解释。",
    "id": "pdf.tech.8"
   },
   {
    "label": "最佳实践",
    "icon": "⭐",
    "description": "最佳实践汇总",
    "prompt": "请汇总 Best Practice 与 Warning 内容为最佳实践清单,按主题分组。",
    "id": "pdf.tech.9"
   },
   {
    "label": "容量参考",
    "icon": "📏",
    "description": "容量规划参考",
    "prompt": "请提取性能与容量指标(QPS/并发/存储),生成容量规划参考表。",
    "id": "pdf.tech.10"
   }
  ]
 },
 {
  "key": "gov",
  "label": "公文政务",
  "icon": "🏛️",
  "items": [
   {
    "label": "要点提炼",
    "icon": "🏛️",
    "description": "公文要点提炼",
    "prompt": "请按公文结构提炼:总体要求、主要任务(逐条)、保障措施,保留文件号与责任表述。",
    "id": "pdf.gov.1"
   },
   {
    "label": "传达提纲",
    "icon": "📢",
    "description": "向下传达提纲",
    "prompt": "请生成传达提纲:核心精神 3 条、与我单位相关任务清单、落实时间要求。",
    "id": "pdf.gov.2"
   },
   {
    "label": "落实方案",
    "icon": "📝",
    "description": "落实方案框架",
    "prompt": "请起草落实方案框架:工作目标、任务分解(责任科室/时限)、保障措施。",
    "id": "pdf.gov.3"
   },
   {
    "label": "汇报材料",
    "icon": "📊",
    "description": "向上汇报材料",
    "prompt": "请生成汇报材料:工作开展情况、成效数据、困难问题、下一步建议四部分。",
    "id": "pdf.gov.4"
   },
   {
    "label": "工作简报",
    "icon": "📰",
    "description": "改写工作简报",
    "prompt": "请把文件内容改写为 800 字工作简报(标题/导语/正文/结尾),语体规范。",
    "id": "pdf.gov.5"
   },
   {
    "label": "讲话框架",
    "icon": "🎤",
    "description": "领导讲话稿框架",
    "prompt": "请生成讲话稿框架:开场肯定、三点意见(小标题对仗)、结尾要求。",
    "id": "pdf.gov.6"
   },
   {
    "label": "信息报送",
    "icon": "📰",
    "description": "政务信息报送格式",
    "prompt": "请改写为政务信息格式(标题/正文 300 字内/报送单位),突出亮点数据。",
    "id": "pdf.gov.7"
   },
   {
    "label": "督查清单",
    "icon": "✅",
    "description": "督查督办清单",
    "prompt": "请生成督查清单:任务/责任单位/完成时限/当前状态/督查方式。",
    "id": "pdf.gov.8"
   },
   {
    "label": "政策对比",
    "icon": "🔀",
    "description": "新旧政策对照",
    "prompt": "请对比新旧政策文件,生成差异对照表(条款/旧规/新规/影响)。",
    "id": "pdf.gov.9"
   },
   {
    "label": "学习计划",
    "icon": "📚",
    "description": "中心组学习计划",
    "prompt": "请生成学习计划:学习专题/时间/形式/领学人,覆盖文件重点内容。",
    "id": "pdf.gov.10"
   }
  ]
 },
 {
  "key": "extract",
  "label": "提取转换",
  "icon": "📤",
  "items": [
   {
    "label": "表格提取",
    "icon": "📋",
    "description": "表格提取为可编辑",
    "prompt": "请识别并提取 PDF 中的所有表格,保留行列结构,输出可编辑表格并注明页码。",
    "id": "pdf.extract.1"
   },
   {
    "label": "文本导出",
    "icon": "📄",
    "description": "纯文本导出",
    "prompt": "请提取全文文本,保留段落结构与阅读顺序,去除页眉页脚页码。",
    "id": "pdf.extract.2"
   },
   {
    "label": "图片导出",
    "icon": "🖼️",
    "description": "内嵌图片导出",
    "prompt": "请提取 PDF 内嵌图片,按页码-序号命名输出清单(尺寸/格式)。",
    "id": "pdf.extract.3"
   },
   {
    "label": "知识卡片",
    "icon": "🃏",
    "description": "知识卡片 15 张",
    "prompt": "请把核心内容整理为知识卡片:每卡一个知识点(问题/答案/标签),输出 15 张。",
    "id": "pdf.extract.4"
   },
   {
    "label": "思维导图",
    "icon": "🧠",
    "description": "思维导图结构",
    "prompt": "请把目录与要点转为思维导图文本结构(中心→分支→子节点),缩进表达。",
    "id": "pdf.extract.5"
   },
   {
    "label": "拆分方案",
    "icon": "✂️",
    "description": "按章节拆分方案",
    "prompt": "请按章节边界生成拆分方案(章节名/起始页/结束页),供逐章导出。",
    "id": "pdf.extract.6"
   },
   {
    "label": "合并报告",
    "icon": "📚",
    "description": "多份合并综合报告",
    "prompt": "请将多份 PDF 的核心内容按主题合并为综合报告,去重并标注来源。",
    "id": "pdf.extract.7"
   },
   {
    "label": "转换建议",
    "icon": "🔀",
    "description": "转 Word/Excel 建议",
    "prompt": "请根据 PDF 结构(文本型/扫描型/表格多)给出转 Word 或 Excel 的最佳方案与注意事项。",
    "id": "pdf.extract.8"
   },
   {
    "label": "入库清单",
    "icon": "🗄️",
    "description": "结构化字段清单",
    "prompt": "请把 PDF 中的结构化信息(人员/项目/日期/金额)整理为数据库字段清单与记录。",
    "id": "pdf.extract.9"
   },
   {
    "label": "邮件摘要",
    "icon": "✉️",
    "description": "浓缩转发邮件",
    "prompt": "请把 PDF 核心内容写成转发邮件:主题、要点 5 条、附件说明,300 字内。",
    "id": "pdf.extract.10"
   }
  ]
 },
 {
  "key": "office",
  "label": "办公协作",
  "icon": "🤝",
  "items": [
   {
    "label": "会议纪要转 PDF 报告",
    "icon": "📝",
    "description": "把会议纪要整理为正式报告",
    "prompt": "请把当前会议纪要整理为正式报告:决议事项/行动项(负责人+期限)/待议事项三部分。",
    "id": "pdf.office.1"
   },
   {
    "label": "多文件合并整理",
    "icon": "📚",
    "description": "多份 PDF 合并编排建议",
    "prompt": "请对当前已合并的多份 PDF 给出编排建议:章节顺序/页码重排/目录页生成方案。",
    "id": "pdf.office.2"
   },
   {
    "label": "页码书签整理",
    "icon": "🔖",
    "description": "生成书签结构",
    "prompt": "请根据 PDF 章节标题生成书签结构清单(层级/标题/页码),供批量添加书签。",
    "id": "pdf.office.3"
   },
   {
    "label": "页眉页脚审查",
    "icon": "📄",
    "description": "页眉页脚一致性审查",
    "prompt": "请审查各页页眉页脚的一致性(文本/格式/页码连续性),列出异常页。",
    "id": "pdf.office.4"
   },
   {
    "label": "目录核对",
    "icon": "📑",
    "description": "目录与正文页码核对",
    "prompt": "请核对目录页码与正文实际页码是否一致,列出偏差项。",
    "id": "pdf.office.5"
   },
   {
    "label": "空白页清理",
    "icon": "🧹",
    "description": "识别空白页",
    "prompt": "请识别 PDF 中的空白页或近空白页(仅页眉页脚),列出生成清理方案。",
    "id": "pdf.office.6"
   },
   {
    "label": "扫描件质量检查",
    "icon": "🔍",
    "description": "扫描质量与可读性评估",
    "prompt": "请评估扫描页的质检项(倾斜/模糊/透印/缺角),列出需要重扫的页码。",
    "id": "pdf.office.7"
   },
   {
    "label": "重要页提取包",
    "icon": "⭐",
    "description": "关键页提取汇编",
    "prompt": "请提取各章节的关键页(结论页/数据页/签署页),生成关键页汇编清单。",
    "id": "pdf.office.8"
   },
   {
    "label": "阅读进度规划",
    "icon": "⏱️",
    "description": "按deadline生成阅读计划",
    "prompt": "请按 3 天 deadline 规划阅读计划:每天读哪些章节/产出什么笔记/预计用时。",
    "id": "pdf.office.9"
   },
   {
    "label": "分享要点卡",
    "icon": "📲",
    "description": "生成社交分享要点卡",
    "prompt": "请把核心内容做成 3 张分享要点卡文案(标题/一句话/配图建议)。",
    "id": "pdf.office.10"
   }
  ]
 }
]

export const PDF_ASSISTANT_TOTAL = 100
