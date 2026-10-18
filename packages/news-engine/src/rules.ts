// Patterns and editorial messages ported from ranking.py editorial-4.3.
export const VERSION = "editorial-4.3" as const;
export const PRIMARY = [
  "github",
  "cloudflare",
  "nasa",
  "nasa_blogs",
  "nvidia",
  "apple_developer",
  "apple",
  "tesla",
  "microsoft_foundry"
] as const;
export const AI = "(?<![A-Za-z])ai(?![A-Za-z])|\\b(?:llm|agents?|chatgpt|openai|anthropic|claude|copilot|foundry|deepseek|gemini|gpt[- ]?\\d|transformer|clef|qwen|llama|mistral|multimodal)\\b|人工智能|大模型|智能体|生成式|机器学习|模型训练|推理模型" as const;
export const CHIPS = "\\b(?:gpu|cpu|nvidia|geforce|dlss|semiconductor|chips?|hbm|cuda)\\b|芯片|算力|半导体|显卡|存储芯片|量子计算" as const;
export const SOFTWARE = "\\b(?:release|runner|update|gateway|license|security|vulnerability|open.source|developer|software|api|python|linux|windows)\\b|更新|软件|开源|漏洞|开发者" as const;
export const INTERESTS = {
  "AI": "(?<![A-Za-z])ai(?![A-Za-z])|\\b(?:llm|agents?|chatgpt|openai|anthropic|claude|copilot|foundry|deepseek|gemini|gpt[- ]?\\d|transformer|clef|qwen|llama|mistral|multimodal)\\b|人工智能|大模型|智能体|生成式|机器学习|模型训练|推理模型",
  "Apple": "(?<![A-Za-z0-9])(?:apple|iphone|ipad|macbook|macos|ios|watchos|visionos|airpods|imac|homepod|mac\\s+(?:mini|studio|pro)|vision\\s+pro)(?![A-Za-z0-9])|苹果",
  "NVIDIA": "(?<![A-Za-z0-9])(?:nvidia|geforce|cuda|rtx|blackwell|rubin)(?![A-Za-z0-9])|英伟达",
  "Tesla": "(?<![A-Za-z0-9])(?:tesla|cybertruck|cybercab|fsd)(?![A-Za-z0-9])|特斯拉",
  "SpaceX": "(?<![A-Za-z0-9])(?:spacex|starlink|starship|falcon)(?![A-Za-z0-9])|星舰|星链"
} as const;
export const BROAD = "\\b(?:robot|robotics|automotive|satellite|space|rocket|electric vehicle|battery|hardware|smartphone)\\b|机器人|智能汽车|自动驾驶|商业航天|卫星|火箭|手机|电池|产品|系统|汽车|航天" as const;
export const IMPACT = [
  [
    "安全|漏洞|修复|security|vulnerabilit|deprecat|shutdown|停用|关停",
    18,
    "安全、修复或服务变化"
  ],
  [
    "研究|报告|监管|收购|融资|research|study|report|regulat|acqui",
    16,
    "研究或行业事件"
  ],
  [
    "诉讼|指控|调查|litigation|lawsuit|allegation|investigation",
    16,
    "法律或行业风险，仍需保留指控/未证实限定"
  ],
  [
    "运营时间|全天候|自动驾驶|robotaxi|\\bfsd\\b|self.driving|driverless|launch mission|发射任务",
    16,
    "运营或核心能力变化"
  ],
  [
    "发布|推出|上线|正式|开源|launch|release|available|introduc|new in|arrive",
    14,
    "发布或可用性变化"
  ],
  [
    "测试|预览|计划|传闻|preview|beta|plan|rumou?r",
    8,
    "测试或未落定进展"
  ]
] as const;
