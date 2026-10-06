// generated 助手库数据(html) — 整体要求: 每类 ≥100 助手 — do not edit by hand
import type { AssistantDomain } from '../types'

export const HTML_ASSISTANT_DOMAINS: AssistantDomain[] = [
 {
  "key": "trans",
  "label": "翻译本地化",
  "icon": "🌐",
  "items": [
   {
    "id": "html.trans.1",
    "label": "技术翻译",
    "icon": "🌐",
    "description": "技术文档中译英",
    "prompt": "请将当前技术文档翻译为英文,保持代码块与命令不译,术语首次附原文。"
   },
   {
    "id": "html.trans.2",
    "label": "英译中润色",
    "icon": "🇨🇳",
    "description": "英文资料中译并润色",
    "prompt": "请将英文资料翻译为流畅中文,长句拆短,术语对照表附文末。"
   },
   {
    "id": "html.trans.3",
    "label": "日文资料翻译",
    "icon": "🇯🇵",
    "description": "日文资料中译",
    "prompt": "请将日文资料翻译为中文,IT 术语保留片假名对照。"
   },
   {
    "id": "html.trans.4",
    "label": "字幕翻译",
    "icon": "🎬",
    "description": "SRT 字幕翻译",
    "prompt": "请按 SRT 时间轴格式翻译字幕,每条不超过两个屏幕行。"
   },
   {
    "id": "html.trans.5",
    "label": "游戏本地化",
    "icon": "🎮",
    "description": "游戏文案本地化",
    "prompt": "请翻译游戏文案(界面/对话/物品),保持简短与风格统一。"
   },
   {
    "id": "html.trans.6",
    "label": "法律翻译审校",
    "icon": "⚖️",
    "description": "法律文件翻译审校",
    "prompt": "请审校法律文件译文:术语一致、条款编号对应、无明显误译。"
   },
   {
    "id": "html.trans.7",
    "label": "医学翻译",
    "icon": "⚕️",
    "description": "医学资料翻译",
    "prompt": "请翻译医学资料, drug 名称用通用名,剂量单位严格核对。"
   },
   {
    "id": "html.trans.8",
    "label": "营销文案翻译",
    "icon": "📣",
    "description": "营销文案本地化",
    "prompt": "请翻译营销文案,按目标市场重写而非直译,保留号召力。"
   },
   {
    "id": "html.trans.9",
    "label": "多语术语库",
    "icon": "📚",
    "description": "建设中英术语库",
    "prompt": "请从双语文档提取术语对,生成 CSV 术语库(英/中/备注)。"
   },
   {
    "id": "html.trans.10",
    "label": "译文质量评估",
    "icon": "📊",
    "description": "按 MQM 框架评估译文",
    "prompt": "请按准确/流畅/术语/风格四维评估译文,给出评分与修改清单。"
   }
  ]
 },
 {
  "key": "life",
  "label": "生活方式",
  "icon": "🏡",
  "items": [
   {
    "id": "html.life.1",
    "label": "旅行攻略",
    "icon": "✈️",
    "description": "生成目的地旅行攻略",
    "prompt": "请生成目的地旅行攻略:行程安排(3 天)、交通住宿建议、美食清单、预算估算。"
   },
   {
    "id": "html.life.2",
    "label": "健身计划",
    "icon": "🏋️",
    "description": "生成每周健身计划",
    "prompt": "请生成每周健身计划:力量/有氧/休息日安排,动作组次与循序渐进说明。"
   },
   {
    "id": "html.life.3",
    "label": "食谱规划",
    "icon": "🍳",
    "description": "生成一周食谱与采购清单",
    "prompt": "请生成一周晚餐食谱(荤素搭配)与汇总采购清单,按超市分区排列。"
   },
   {
    "id": "html.life.4",
    "label": "搬家清单",
    "icon": "📦",
    "description": "生成搬家打包清单与时间表",
    "prompt": "请生成搬家清单:按房间分类打包顺序、易碎品处理、时间表与检查项。"
   },
   {
    "id": "html.life.5",
    "label": "装修进度",
    "icon": "🔨",
    "description": "生成装修流程与验收要点",
    "prompt": "请生成装修流程:各阶段工期/主材进场时间/验收要点,附增项陷阱提醒。"
   },
   {
    "id": "html.life.6",
    "label": "育儿记录",
    "icon": "👶",
    "description": "生成育儿成长记录模板",
    "prompt": "请生成成长记录模板:月龄里程碑/喂养/疫苗/趣事,便于长期记录。"
   },
   {
    "id": "html.life.7",
    "label": "宠物养护",
    "icon": "🐾",
    "description": "生成宠物养护日历",
    "prompt": "请生成养护日历:疫苗驱虫时间表、日常饮食、常见症状观察要点。"
   },
   {
    "id": "html.life.8",
    "label": "节日筹备",
    "icon": "🎊",
    "description": "生成节日筹备清单",
    "prompt": "请生成节日筹备清单:采购/家务/送礼/日程,倒排时间。"
   },
   {
    "id": "html.life.9",
    "label": "阅读挑战",
    "icon": "📚",
    "description": "生成年度阅读挑战计划",
    "prompt": "请生成年阅读计划:12 个月书单主题搭配、笔记方法、进度追踪表。"
   },
   {
    "id": "html.life.10",
    "label": "习惯养成",
    "icon": "🌱",
    "description": "生成 21 天习惯养成打卡计划",
    "prompt": "请生成习惯养成计划:目标拆解、每日最小行动、复盘问题、奖励机制。"
   }
  ]
 },
 {
  "key": "prompt",
  "label": "提示词工程",
  "icon": "🤖",
  "items": [
   {
    "id": "html.prompt.1",
    "label": "提示词改写",
    "icon": "✏️",
    "description": "把模糊需求改写为结构化提示词",
    "prompt": "请把当前模糊的需求描述改写为结构化提示词(角色/任务/约束/输出格式),前后对照。"
   },
   {
    "id": "html.prompt.2",
    "label": "系统提示词设计",
    "icon": "🧭",
    "description": "为智能体设计系统提示词",
    "prompt": "请为指定场景的智能体设计系统提示词:角色定位/能力边界/语气规范/异常处理。"
   },
   {
    "id": "html.prompt.3",
    "label": "Few-shot 示例构造",
    "icon": "🧩",
    "description": "构造少样本示例集",
    "prompt": "请为任务构造 3 组 few-shot 示例(输入/输出),覆盖典型与边界情况。"
   },
   {
    "id": "html.prompt.4",
    "label": "思维链提示",
    "icon": "🔗",
    "description": "把直接问答改为思维链提示",
    "prompt": "请把当前提示词改为思维链版本(分步推理),并对比两种写法的适用场景。"
   },
   {
    "id": "html.prompt.5",
    "label": "提示词测试集",
    "icon": "🧪",
    "description": "生成提示词回归测试用例",
    "prompt": "请为当前提示词生成 10 条回归测试用例(输入/期望输出要点)。"
   },
   {
    "id": "html.prompt.6",
    "label": "提示词压缩",
    "icon": "📉",
    "description": "在保留效果前提下压缩提示词",
    "prompt": "请压缩当前提示词:删除冗余、合并约束,Token 数减半,效果要点不变。"
   },
   {
    "id": "html.prompt.7",
    "label": "防注入加固",
    "icon": "🛡️",
    "description": "为提示词加入注入防护",
    "prompt": "请为处理用户输入的提示词加入注入防护(角色锚定/输出约束/敏感指令拒绝)。"
   },
   {
    "id": "html.prompt.8",
    "label": "输出格式约束",
    "icon": "📐",
    "description": "为提示词加 JSON Schema 输出约束",
    "prompt": "请为提示词加严格的 JSON 输出约束(schema 定义+示例+违规重试指令)。"
   },
   {
    "id": "html.prompt.9",
    "label": "多模态提示",
    "icon": "🖼️",
    "description": "编写图像生成提示词",
    "prompt": "请为指定画面编写图像生成提示词(主体/风格/构图/光线/负面词),中英双版。"
   },
   {
    "id": "html.prompt.10",
    "label": "提示词版本管理",
    "icon": "🗂️",
    "description": "建立提示词版本记录规范",
    "prompt": "请为当前提示词建立版本记录表(版本/改动/效果对比/回滚点)。"
   }
  ]
 },
 {
  "key": "landing",
  "label": "落地页",
  "icon": "🚀",
  "items": [
   {
    "id": "html.landing.1",
    "label": "SaaS 落地页",
    "icon": "🖥️",
    "description": "生成 SaaS 产品落地页骨架",
    "prompt": "请生成 SaaS 落地页:首屏(主标题+副标题+CTA+产品截图占位)、功能三卡、社会证明、定价、FAQ、页脚,响应式。"
   },
   {
    "id": "html.landing.2",
    "label": "首屏文案",
    "icon": "✍️",
    "description": "为首屏写 5 版主标题+副标题",
    "prompt": "请为首屏写 5 版主标题+副标题组合(利益导向),各配 CTA 按钮文案。"
   },
   {
    "id": "html.landing.3",
    "label": "CTA 优化",
    "icon": "🎯",
    "description": "审查并优化全页 CTA 布局",
    "prompt": "请审查落地页 CTA:首屏一屏内必须有、每屏结尾重复、文案动词化,给出修改点。"
   },
   {
    "id": "html.landing.4",
    "label": "信任元素",
    "icon": "🛡️",
    "description": "添加信任元素区(客户/数据/资质)",
    "prompt": "请在落地页添加信任区:客户 logo 墙、数据证明(用户数/好评率)、媒体报道、备案资质。"
   },
   {
    "id": "html.landing.5",
    "label": "表单优化",
    "icon": "📝",
    "description": "优化留资表单(字段最少化)",
    "prompt": "请优化留资表单:字段精简到 3 个、错误提示友好、提交后状态设计,附表单代码。"
   },
   {
    "id": "html.landing.6",
    "label": "A/B 变体",
    "icon": "🧪",
    "description": "生成 A/B 测试变体方案",
    "prompt": "请为首屏生成 A/B 测试变体:标题 A/B、配图 A/B、CTA 文案 A/B,并定义成功指标。"
   },
   {
    "id": "html.landing.7",
    "label": "移动端适配",
    "icon": "📱",
    "description": "落地页移动端适配检查",
    "prompt": "请检查落地页移动端:首屏高度、按钮触达区、字号、加载顺序,输出修复清单与代码。"
   },
   {
    "id": "html.landing.8",
    "label": "加载性能",
    "icon": "⚡",
    "description": "落地页性能优化建议",
    "prompt": "请分析落地页性能:图片懒加载、关键 CSS 内联、脚本 defer,给出优化代码。"
   },
   {
    "id": "html.landing.9",
    "label": "法律合规章脚",
    "icon": "⚖️",
    "description": "添加合规页脚(备案/隐私/条款)",
    "prompt": "请生成合规页脚:ICP 备案、隐私政策链接、服务条款、版权声明。"
   },
   {
    "id": "html.landing.10",
    "label": "数据追踪埋点",
    "icon": "📊",
    "description": "为转化漏斗添加埋点代码",
    "prompt": "请为落地页添加埋点:页面浏览、CTA 点击、表单提交、滚动深度,输出跟踪代码。"
   }
  ]
 },
 {
  "key": "site",
  "label": "企业官网",
  "icon": "🏢",
  "items": [
   {
    "id": "html.site.1",
    "label": "官网五页骨架",
    "icon": "🏢",
    "description": "生成官网五页骨架(首页/产品/关于/新闻/联系)",
    "prompt": "请生成企业官网五页骨架:首页(横幅/业务/优势/客户)、产品列表页、关于我们、新闻动态、联系我们,共享导航与页脚。"
   },
   {
    "id": "html.site.2",
    "label": "首页横幅",
    "icon": "🖼️",
    "description": "生成首页轮播横幅(3 帧文案)",
    "prompt": "请生成首页轮播 3 帧:每帧主标语+副标语+按钮文案+配图方向。"
   },
   {
    "id": "html.site.3",
    "label": "业务介绍页",
    "icon": "📈",
    "description": "生成业务介绍页",
    "prompt": "请生成业务介绍页:每项业务(图标+名称+一句话+了解更多),2×2 网格布局。"
   },
   {
    "id": "html.site.4",
    "label": "新闻列表与详情",
    "icon": "📰",
    "description": "生成新闻列表与详情页模板",
    "prompt": "请生成新闻模块:列表页(封面+标题+日期+摘要分页)与详情页模板(正文排版/分享/相关阅读)。"
   },
   {
    "id": "html.site.5",
    "label": "联系我们表单",
    "icon": "📮",
    "description": "生成联系表单与地图区块",
    "prompt": "请生成联系我们页:表单(姓名/电话/留言+验证)、公司地址地图占位、多渠道联系方式。"
   },
   {
    "id": "html.site.6",
    "label": "多语言切换",
    "icon": "🌐",
    "description": "添加多语言切换支持",
    "prompt": "请为官网添加中英切换:语言包结构、切换按钮、hreflang 标签、文案抽离方案。"
   },
   {
    "id": "html.site.7",
    "label": "SEO 基础",
    "icon": "🔍",
    "description": "官网 SEO 基础设施",
    "prompt": "请添加 SEO 基础:TDK 模板、语义化标签、sitemap.xml、robots.txt、结构化数据(Organization)。"
   },
   {
    "id": "html.site.8",
    "label": "无障碍审查",
    "icon": "♿",
    "description": "无障碍(a11y)审查与修复",
    "prompt": "请做无障碍审查:对比度、alt 文本、键盘可达、焦点样式,输出修复代码。"
   },
   {
    "id": "html.site.9",
    "label": "响应式断点",
    "icon": "📱",
    "description": "统一响应式断点与栅格",
    "prompt": "请统一响应式断点(768/1024/1280)与栅格系统,修复错位页,给出媒体查询代码。"
   },
   {
    "id": "html.site.10",
    "label": "页脚信息架构",
    "icon": "🦶",
    "description": "重构页脚信息架构",
    "prompt": "请重构页脚:四栏(产品/公司/支持/法律)+备案信息+社媒图标。"
   }
  ]
 },
 {
  "key": "portfolio",
  "label": "作品集",
  "icon": "🎨",
  "items": [
   {
    "id": "html.portfolio.1",
    "label": "作品集首页",
    "icon": "🎨",
    "description": "生成作品集首页(个人品牌)",
    "prompt": "请生成作品集首页:个人定位一句话、精选作品 6 格、关于我、技能标签、联系方式,设计感强。"
   },
   {
    "id": "html.portfolio.2",
    "label": "作品详情模板",
    "icon": "🖼️",
    "description": "生成作品详情页模板(背景/过程/结果)",
    "prompt": "请生成作品详情模板:项目背景、我的角色、设计过程(草图→迭代)、最终结果与数据。"
   },
   {
    "id": "html.portfolio.3",
    "label": "案例叙事",
    "icon": "📖",
    "description": "用 STAR 法写项目案例文案",
    "prompt": "请用 STAR 法为项目写案例文案(情境/任务/行动/结果),结果量化。"
   },
   {
    "id": "html.portfolio.4",
    "label": "技能可视化",
    "icon": "📊",
    "description": "技能与工具可视化区",
    "prompt": "请生成技能可视化:技能条/工具 logo 墙/ years 经验标注。"
   },
   {
    "id": "html.portfolio.5",
    "label": "简历页融合",
    "icon": "📄",
    "description": "简历与作品集融合页",
    "prompt": "请生成简历融合页:经历时间轴+对应作品链接+下载 PDF 按钮。"
   },
   {
    "id": "html.portfolio.6",
    "label": "暗色主题",
    "icon": "🌙",
    "description": "作品集暗色主题适配",
    "prompt": "请为作品集生成暗色主题:配色变量、对比度检查、图片遮罩处理。"
   },
   {
    "id": "html.portfolio.7",
    "label": "动效点睛",
    "icon": "✨",
    "description": "添加克制的滚动动效",
    "prompt": "请添加滚动入场动效(淡入+上移,交错延迟),prefers-reduced-motion 兼容。"
   },
   {
    "id": "html.portfolio.8",
    "label": "联系转化",
    "icon": "📮",
    "description": "优化约稿联系转化",
    "prompt": "请添加约稿转化区: availability 状态、一键复制微信/邮箱、日历预约链接。"
   },
   {
    "id": "html.portfolio.9",
    "label": "CMS 数据结构",
    "icon": "🗂️",
    "description": "作品数据结构化(JSON 驱动)",
    "prompt": "请把作品改为 JSON 数据驱动渲染:作品数组字段设计,增删作品只改数据。"
   },
   {
    "id": "html.portfolio.10",
    "label": "导出静态部署",
    "icon": "📤",
    "description": "静态部署配置(打包上传即可)",
    "prompt": "请生成静态部署配置:构建产物结构、常见静态托管平台适配说明。"
   }
  ]
 },
 {
  "key": "email",
  "label": "邮件模板",
  "icon": "✉️",
  "items": [
   {
    "id": "html.email.1",
    "label": "欢迎邮件",
    "icon": "👋",
    "description": "生成新用户欢迎邮件",
    "prompt": "请生成欢迎邮件:欢迎语、3 步上手指引、帮助链接、CTA(完成首次使用)。"
   },
   {
    "id": "html.email.2",
    "label": "产品通报",
    "icon": "📢",
    "description": "生成功能发布通报邮件",
    "prompt": "请生成功能发布邮件:新功能价值、使用步骤、适用条件、反馈入口。"
   },
   {
    "id": "html.email.3",
    "label": "活动促销",
    "icon": "🎉",
    "description": "生成活动促销邮件",
    "prompt": "请生成活动邮件:活动钩子标题、优惠信息块、倒计时、CTA 按钮、退订声明。"
   },
   {
    "id": "html.email.4",
    "label": "周报订阅",
    "icon": "🗞️",
    "description": "生成订阅周报模板",
    "prompt": "请生成订阅周报模板:本周精选 5 条(标题+摘要+链接)、订阅管理。"
   },
   {
    "id": "html.email.5",
    "label": "流失召回",
    "icon": "💔",
    "description": "生成流失用户召回邮件",
    "prompt": "请生成召回邮件:想念表达、新变化亮点、回归礼遇、一键登录。"
   },
   {
    "id": "html.email.6",
    "label": "事件触发",
    "icon": "⚡",
    "description": "生成行为触发邮件(购物车放弃/注册未完成)",
    "prompt": "请生成触发邮件模板:情境化标题、继续完成的价值、障碍消除(帮助/优惠)。"
   },
   {
    "id": "html.email.7",
    "label": "表格式邮件",
    "icon": "📋",
    "description": "生成表格式数据报告邮件",
    "prompt": "请生成数据报告邮件:表格数据(兼容 Outlook 的 table 布局)+要点解读。"
   },
   {
    "id": "html.email.8",
    "label": "邮件签名",
    "icon": "🏷️",
    "description": "生成统一邮件签名 HTML",
    "prompt": "请生成邮件签名:姓名/职位/公司/电话/官网/社媒图标,兼容主流客户端。"
   },
   {
    "id": "html.email.9",
    "label": "深色模式兼容",
    "icon": "🌙",
    "description": "邮件深色模式兼容处理",
    "prompt": "请为邮件做深色模式兼容:颜色变量、meta color-scheme、图片处理说明。"
   },
   {
    "id": "html.email.10",
    "label": "退订与合规",
    "icon": "⚖️",
    "description": "退订链接与合规声明",
    "prompt": "请添加退订链接与合规声明(为什么收到/退订方式/发件方信息)。"
   }
  ]
 },
 {
  "key": "dashboard",
  "label": "仪表盘",
  "icon": "📊",
  "items": [
   {
    "id": "html.dashboard.1",
    "label": "管理后台骨架",
    "icon": "🎛️",
    "description": "生成管理后台布局骨架",
    "prompt": "请生成管理后台骨架:左侧导航+顶部栏+内容区(面包屑/卡片栅格/分页表格),响应式折叠。"
   },
   {
    "id": "html.dashboard.2",
    "label": "KPI 卡片组",
    "icon": "💹",
    "description": "生成 KPI 指标卡组件组",
    "prompt": "请生成 4 个 KPI 卡:指标名/数值/同比箭头/迷你趋势线,数值格式化。"
   },
   {
    "id": "html.dashboard.3",
    "label": "图表页",
    "icon": "📈",
    "description": "生成 ECharts 图表分析页",
    "prompt": "请生成图表分析页:筛选栏(时间/维度)+3 个图表(趋势线/占比饼/排名条),联动刷新。"
   },
   {
    "id": "html.dashboard.4",
    "label": "表格页增删改查",
    "icon": "📋",
    "description": "生成表格 CRUD 页",
    "prompt": "请生成表格 CRUD 页:搜索栏、表格(排序/分页)、新增/编辑弹窗、删除确认。"
   },
   {
    "id": "html.dashboard.5",
    "label": "登录页",
    "icon": "🔐",
    "description": "生成登录页(账密+验证码)",
    "prompt": "请生成登录页:账号密码登录、图形验证码、记住我、错误提示、登录态处理。"
   },
   {
    "id": "html.dashboard.6",
    "label": "权限菜单",
    "icon": "🔒",
    "description": "按角色过滤菜单与按钮",
    "prompt": "请实现权限控制:角色→菜单与按钮权限映射,无权限隐藏或禁用,给出实现。"
   },
   {
    "id": "html.dashboard.7",
    "label": "主题切换",
    "icon": "🎨",
    "description": "亮暗主题切换(变量驱动)",
    "prompt": "请实现主题切换:CSS 变量双主题、切换持久化、图表配色跟随。"
   },
   {
    "id": "html.dashboard.8",
    "label": "空状态与加载",
    "icon": "🕳️",
    "description": "统一空态/加载/错误态组件",
    "prompt": "请生成三态组件:骨架屏加载、空状态插画+引导、错误重试,统一样式。"
   },
   {
    "id": "html.dashboard.9",
    "label": "打印与导出",
    "icon": "🖨️",
    "description": "页面打印样式与数据导出",
    "prompt": "请实现打印样式(@media print 隐藏导航)与 CSV 导出功能。"
   },
   {
    "id": "html.dashboard.10",
    "label": "国际化切换",
    "icon": "🌐",
    "description": "后台国际化(i18n)接入",
    "prompt": "请接入 i18n:语言包结构、t 函数、语言切换持久化、日期数字本地化。"
   }
  ]
 },
 {
  "key": "event",
  "label": "活动专题",
  "icon": "🎪",
  "items": [
   {
    "id": "html.event.1",
    "label": "大促专题页",
    "icon": "🎪",
    "description": "生成大促专题页(头图+券+商品楼层)",
    "prompt": "请生成大促专题页:头图倒计时、优惠券领取区、商品楼层(Tab 切换)、规则说明,移动端优先。"
   },
   {
    "id": "html.event.2",
    "label": "倒计时组件",
    "icon": "⏱️",
    "description": "生成秒杀倒计时组件",
    "prompt": "请生成倒计时组件:天时分秒实时刷新、结束态处理、防抖动(等宽数字)。"
   },
   {
    "id": "html.event.3",
    "label": "抽奖转盘",
    "icon": "🎡",
    "description": "生成九宫格抽奖组件",
    "prompt": "请生成九宫格抽奖:奖品配置、转动动画(缓动+圈数)、中奖弹窗、概率配置接口占位。"
   },
   {
    "id": "html.event.4",
    "label": "签到日历",
    "icon": "📅",
    "description": "生成签到日历组件",
    "prompt": "请生成签到日历:当月视图、已签标记、补签按钮、连续签到奖励提示。"
   },
   {
    "id": "html.event.5",
    "label": "邀请海报",
    "icon": "🖼️",
    "description": "生成邀请海报生成功能",
    "prompt": "请实现邀请海报:canvas 绘制(背景+二维码+文案)、长按保存引导。"
   },
   {
    "id": "html.event.6",
    "label": "投票榜单",
    "icon": "🗳️",
    "description": "生成投票排行榜页",
    "prompt": "请生成投票页:作品卡片+投票按钮(防刷:限次)、实时榜单排名。"
   },
   {
    "id": "html.event.7",
    "label": "直播预约",
    "icon": "📺",
    "description": "生成直播预约组件",
    "prompt": "请生成直播预约:开播状态(预约中/直播中/回放)、预约按钮、开播提醒订阅。"
   },
   {
    "id": "html.event.8",
    "label": "游戏化 H5",
    "icon": "🎮",
    "description": "生成答题闯关 H5 骨架",
    "prompt": "请生成答题 H5:题目流转、计分、结果页(分数+分享),页面切换动画。"
   },
   {
    "id": "html.event.9",
    "label": "红包雨",
    "icon": "🧧",
    "description": "生成红包雨互动组件",
    "prompt": "请生成红包雨:红包下落动画、点击领取、次数限制、结果汇总。"
   },
   {
    "id": "html.event.10",
    "label": "成绩查询页",
    "icon": "🔍",
    "description": "生成成绩查询页(姓名+准考证)",
    "prompt": "请生成成绩查询页:查询表单、结果卡(分数/排名/科目明细)、防重复查询提示。"
   }
  ]
 },
 {
  "key": "blogtheme",
  "label": "博客主题",
  "icon": "📝",
  "items": [
   {
    "id": "html.blogtheme.1",
    "label": "极简博客主题",
    "icon": "🤍",
    "description": "生成极简风博客页面",
    "prompt": "请生成极简博客:文章列表(标题+日期+摘要)、阅读页(舒适行高/字号)、归档页,纯 CSS 无依赖。"
   },
   {
    "id": "html.blogtheme.2",
    "label": "代码高亮",
    "icon": "💻",
    "description": "为博客接入代码高亮",
    "prompt": "请为文章页接入代码高亮:浅色主题、复制按钮、语言标注。"
   },
   {
    "id": "html.blogtheme.3",
    "label": "文章目录",
    "icon": "🧭",
    "description": "生成文章 TOC 侧栏",
    "prompt": "请生成文章目录侧栏:标题自动提取、滚动高亮当前节、移动端折叠。"
   },
   {
    "id": "html.blogtheme.4",
    "label": "RSS 订阅",
    "icon": "📡",
    "description": "生成 RSS 订阅源",
    "prompt": "请生成 RSS/Atom feed:文章字段映射、更新频率、订阅按钮。"
   },
   {
    "id": "html.blogtheme.5",
    "label": "评论系统集成",
    "icon": "💬",
    "description": "接入轻量评论系统",
    "prompt": "请接入评论:无需后端方案(giscus/utterances)、样式适配、 moderation 说明。"
   },
   {
    "id": "html.blogtheme.6",
    "label": "标签与归档",
    "icon": "🏷️",
    "description": "生成标签与归档页",
    "prompt": "请生成标签云与按月归档页,文章计数标注。"
   },
   {
    "id": "html.blogtheme.7",
    "label": "站内搜索",
    "icon": "🔍",
    "description": "生成前端站内搜索",
    "prompt": "请实现本地全文搜索(索引构建+防抖搜索+关键词高亮)。"
   },
   {
    "id": "html.blogtheme.8",
    "label": "图片画廊",
    "icon": "🖼️",
    "description": "生成摄影画廊页",
    "prompt": "请生成响应式画廊:瀑布流布局、点击放大灯箱、EXIF 信息展示。"
   },
   {
    "id": "html.blogtheme.9",
    "label": "友链页面",
    "icon": "🤝",
    "description": "生成友情链接页",
    "prompt": "请生成友链页:卡片布局(头像/名称/描述)、申请说明。"
   },
   {
    "id": "html.blogtheme.10",
    "label": "关于页",
    "icon": "👤",
    "description": "生成关于我页面",
    "prompt": "请生成关于页:自我介绍、经历时间线、联系方式、社交图标。"
   }
  ]
 },
 {
  "key": "form",
  "label": "表单收集",
  "icon": "📥",
  "items": [
   {
    "id": "html.form.1",
    "label": "活动报名表",
    "icon": "📝",
    "description": "生成活动报名表单",
    "prompt": "请生成活动报名表:姓名/电话/人数/备注,前端校验、提交成功态、防重复提交。"
   },
   {
    "id": "html.form.2",
    "label": "问卷调查",
    "icon": "📋",
    "description": "生成问卷页(单选/多选/开放)",
    "prompt": "请生成问卷页:题型组件(单选/多选/评分/开放)、进度条、必填校验、结果本地存储。"
   },
   {
    "id": "html.form.3",
    "label": "多步表单",
    "icon": "🪜",
    "description": "生成分步表单(向导式)",
    "prompt": "请生成分步表单:3 步向导、进度指示、分步校验、草稿暂存。"
   },
   {
    "id": "html.form.4",
    "label": "文件上传表单",
    "icon": "📎",
    "description": "生成文件上传表单",
    "prompt": "请生成文件上传:拖拽+点击、类型大小校验、进度条、多文件管理。"
   },
   {
    "id": "html.form.5",
    "label": "联系表单邮件",
    "icon": "✉️",
    "description": "表单提交到邮箱",
    "prompt": "请实现表单提交到邮箱:SMTP 或三方服务方案、防垃圾(蜜罐/验证码)。"
   },
   {
    "id": "html.form.6",
    "label": "支付表单",
    "icon": "💳",
    "description": "生成收款表单(二维码)",
    "prompt": "请生成收款表单:金额选择/自定义、收款二维码展示、支付说明。"
   },
   {
    "id": "html.form.7",
    "label": "简历收集",
    "icon": "📇",
    "description": "生成 HR 简历收集表",
    "prompt": "请生成简历收集表:基本信息+附件简历上传+岗位选择,后台列表视图。"
   },
   {
    "id": "html.form.8",
    "label": "预约日历表",
    "icon": "📅",
    "description": "生成预约时段选择表",
    "prompt": "请生成预约表:日期+时段选择(已约禁用)、提交确认、取消预约。"
   },
   {
    "id": "html.form.9",
    "label": "投票表单",
    "icon": "🗳️",
    "description": "生成投票表单(限次)",
    "prompt": "请生成投票表单:选项单选/多选、结果条形图实时展示、每 IP 限一次。"
   },
   {
    "id": "html.form.10",
    "label": "表单数据导出",
    "icon": "📤",
    "description": "表单数据导出 CSV",
    "prompt": "请实现已提交数据的表格查看与 CSV 导出(含时间戳)。"
   }
  ]
 },
 {
  "key": "edu",
  "label": "教育课程页",
  "icon": "🎓",
  "items": [
   {
    "id": "html.edu.1",
    "label": "课程详情页",
    "icon": "📚",
    "description": "生成课程详情页",
    "prompt": "请生成课程详情页:课程介绍、大纲(章节+课时)、讲师介绍、购买按钮。"
   },
   {
    "id": "html.edu.2",
    "label": "在线学习页",
    "icon": "🖥️",
    "description": "生成视频学习页",
    "prompt": "请生成学习页:视频播放器(倍速/进度)、课件 Tab、笔记区、目录侧栏。"
   },
   {
    "id": "html.edu.3",
    "label": "题库练习页",
    "icon": "📝",
    "description": "生成题库练习页",
    "prompt": "请生成练习页:顺序/随机刷题、答案解析展开、错题本入口。"
   },
   {
    "id": "html.edu.4",
    "label": "成绩报告页",
    "icon": "📊",
    "description": "生成学员成绩报告页",
    "prompt": "请生成成绩报告:总分/排名/各科雷达/历史趋势、提升建议。"
   },
   {
    "id": "html.edu.5",
    "label": "名师团队页",
    "icon": "👥",
    "description": "生成师资团队页",
    "prompt": "请生成师资页:教师卡片(头像/资质/代表作)、筛选排序。"
   },
   {
    "id": "html.edu.6",
    "label": "公开课预约",
    "icon": "📅",
    "description": "生成公开课预约页",
    "prompt": "请生成公开课页:课程介绍、时间选择、预约按钮、名额实时显示。"
   },
   {
    "id": "html.edu.7",
    "label": "学习打卡",
    "icon": "📅",
    "description": "生成学习打卡组件",
    "prompt": "请生成打卡组件:日历打卡、连续天数、分享海报生成。"
   },
   {
    "id": "html.edu.8",
    "label": "作业提交",
    "icon": "📤",
    "description": "生成作业提交页",
    "prompt": "请生成作业提交:作业说明、附件上传、截止时间、批改结果查看。"
   },
   {
    "id": "html.edu.9",
    "label": "课程对比",
    "icon": "⚖️",
    "description": "生成课程对比页",
    "prompt": "请生成课程对比:适合人群/内容/师资/价格多维对比表。"
   },
   {
    "id": "html.edu.10",
    "label": "证书展示",
    "icon": "🎖️",
    "description": "生成证书展示页",
    "prompt": "请生成证书页:已获证书卡片(名称/编号/颁发方/验证链接)。"
   }
  ]
 },
 {
  "key": "shop",
  "label": "餐饮门店页",
  "icon": "🍜",
  "items": [
   {
    "id": "html.shop.1",
    "label": "门店官网",
    "icon": "🍜",
    "description": "生成餐饮门店官网",
    "prompt": "请生成门店官网:招牌菜轮播、菜单(分类+图片+价格)、门店信息(多门店切换)。"
   },
   {
    "id": "html.shop.2",
    "label": "在线菜单",
    "icon": "📋",
    "description": "生成扫码点菜菜单页",
    "prompt": "请生成扫码菜单:分类侧栏+商品列表(图片/规格/销量)、购物车浮层。"
   },
   {
    "id": "html.shop.3",
    "label": "外卖预点单",
    "icon": "🛍️",
    "description": "生成外卖预点单页",
    "prompt": "请生成外卖页:菜品选择、购物车结算、配送信息、订单备注。"
   },
   {
    "id": "html.shop.4",
    "label": "排队取号",
    "icon": "🎫",
    "description": "生成排队取号页",
    "prompt": "请生成排队页:当前桌位状态、取号按钮、前面等待桌数实时显示。"
   },
   {
    "id": "html.shop.5",
    "label": "优惠券中心",
    "icon": "🎟️",
    "description": "生成优惠券领取页",
    "prompt": "请生成优惠券页:券卡片(面额/条件/有效期)、领取按钮、我的券包。"
   },
   {
    "id": "html.shop.6",
    "label": "会员储值",
    "icon": "💳",
    "description": "生成会员储值页",
    "prompt": "请生成储值页:档位(充 500 送 80)、余额查询、消费记录。"
   },
   {
    "id": "html.shop.7",
    "label": "菜品故事页",
    "icon": "📖",
    "description": "生成招牌菜故事页",
    "prompt": "请生成招牌菜故事:食材溯源、做法匠心、主厨寄语,图文排版。"
   },
   {
    "id": "html.shop.8",
    "label": "评价展示",
    "icon": "⭐",
    "description": "生成好评展示页",
    "prompt": "请生成好评页:评分总览、评价卡片(用户/星级/内容/图)、平台跳转。"
   },
   {
    "id": "html.shop.9",
    "label": "招聘加入",
    "icon": "🤝",
    "description": "生成餐饮招聘页",
    "prompt": "请生成招聘页:在招岗位(服务员/厨师/店长)、薪资福利、应聘方式。"
   },
   {
    "id": "html.shop.10",
    "label": " franchise 加盟",
    "icon": "🤲",
    "description": "生成加盟招商页",
    "prompt": "请生成加盟页:品牌优势、加盟条件与费用、扶持政策、申请表单。"
   }
  ]
 }
]

export const HTML_ASSISTANT_TOTAL = 130
