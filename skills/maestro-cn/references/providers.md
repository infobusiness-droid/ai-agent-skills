# 国内模型提供商配置

所有提供商都在应用「设置」页配置。API Key 只写入本机 SQLite（`data/maestro.db`），显示时掩码。均兼容 OpenAI Chat Completions 协议（`/v1/chat/completions`），应用按该协议接入，流式输出已支持。

## 豆包 · 火山方舟（推荐：便宜、速度快）

1. 打开火山引擎控制台并登录/注册：`https://console.volcengine.com`（未实名需先完成企业或个人实名认证）。
2. 进入「火山方舟」控制台：`https://console.volcengine.com/ark`。
3. 在「开通管理」中开通需要的模型（doubao-seed、doubao-1.5 系列），开通即可。
4. 左侧「API Key 管理」→「创建 API Key」，复制保存（只显示一次）。
5. 在应用「设置」页，把 Key 粘贴到「火山方舟·豆包」的 API Key 栏，Base URL 保持：
   `https://ark.cn-beijing.volces.com/api/v3`
6. 模型名可直接填已开通模型：`doubao-seed-1.6-flash`、`doubao-seed-1.6-thinking`、`doubao-1.5-pro-32k`；若用接入点方式可填 `ep-xxxx` 接入点 ID。
7. 在「智能体」页把对应智能体的提供商切到「火山方舟·豆包」、填好模型名，即可真实对话。

## 其他国内模型

| 提供商 | 控制台 | Base URL | 示例模型 |
|---|---|---|---|
| DeepSeek | platform.deepseek.com | `https://api.deepseek.com` | deepseek-chat、deepseek-reasoner |
| 通义千问（阿里云百炼） | bailian.console.aliyun.com | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-plus、qwen-max、qwen-turbo |
| 智谱 GLM | open.bigmodel.cn | `https://open.bigmodel.cn/api/paas/v4` | glm-4-plus、glm-4-flash |
| Kimi | platform.moonshot.cn | `https://api.moonshot.cn/v1` | moonshot-v1-8k、moonshot-v1-32k、moonshot-v1-128k |

## 完全离线体验

把智能体的提供商设为「离线演示（mock）」即可，无需任何 Key：回答为本地模拟内容，用于体验全部功能与界面。新装的技能默认 4 个智能体均为 mock。
