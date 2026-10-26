---
name: maestro-cn
description: 国内版多智能体编排工作台（Maestro 复刻）：本地启动 FastAPI 后端 + Web UI，提供智能体单聊（流式）、群聊（主持分派→成员回答→追问→总结）、自动执行（清单/目标模式）、剧本库、用量统计，可接入豆包（火山方舟）/DeepSeek/通义千问/智谱 GLM/Kimi 等国内模型及 workbuddy 外部 CLI。当用户需要部署、启动、配置或使用这个多智能体应用，或需要一套能接国内模型的多智能体编排能力（群聊/自动执行/剧本）时使用；也用于在该应用内创建智能体、发起群聊讨论、执行自动任务、查询用量。
---

# maestro-cn · 国内版多智能体编排工作台

复刻 [RunMaestro/Maestro](https://github.com/RunMaestro/Maestro) 的多智能体协作体验，面向国内用户：不依赖境外模型，接入豆包、DeepSeek、通义千问等国内模型与 workbuddy CLI。本地运行，数据只存本机 SQLite。

## 快速开始

应用完整源码在 `assets/app/`。以下脚本均在技能目录下执行：

```bash
python scripts/setup.py              # 安装 Python 依赖（含可选 npm install）
python scripts/start.py              # 启动后端（默认 8090，自动开浏览器）
# 浏览器访问 http://127.0.0.1:8090/
```

启动后打开浏览器即可使用。**未配置 API Key 也能体验全部功能**：预置 4 个智能体，默认「离线演示（mock）」模式；配好 Key 后把智能体切回真实模型。

- 指定端口/不开浏览器：`python scripts/start.py --port 8095 --no-browser`
- 桌面版（Electron）：在 `assets/app/` 下执行 `npm install && npm start`

## 配置国内模型

模型提供商在应用内「设置」页配置（API Key 只存本机 SQLite、显示时掩码）。各家提供商（豆包火山方舟申请指引、DeepSeek、通义、智谱、Kimi）的 Base URL、模型名、申请步骤见 [references/providers.md](references/providers.md)。

## 使用方式

### 界面（Web UI，七个板块）

- **智能体**：新建/编辑智能体（LLM 或 CLI 类型）；单聊支持流式输出、`@提及` 跨智能体征询、`/new` 清空、`/help`
- **群聊**：选主持智能体 + 多名成员发起讨论，全程流式（分派→成员回答→主持追问→主持总结）
- **自动执行**：把 Markdown 清单或一段目标交给智能体逐项完成（清单模式/目标模式）
- **剧本库**：收藏常用自动执行清单为一键运行的剧本
- **用量统计**：按智能体与日期统计 token 与费用
- **设置**：提供商 Base URL/Key/模型/价格/默认参数、workbuddy 开关
- 快捷键：`Ctrl+J` 主题、`Ctrl+[`/`Ctrl+]` 切板块、`/` 聚焦输入、`Esc` 关弹窗

### API

后端提供完整 REST + SSE 接口，可供其他智能体/脚本调用（聊天流式、群聊、自动执行均为 SSE）。端点清单与请求/事件格式见 [references/api.md](references/api.md)。

### workbuddy 接入

外部 CLI 工具类型的智能体通过命令模板（`{prompt}` 占位符）调用 workbuddy。详见 [references/workbuddy.md](references/workbuddy.md)。

## 测试

```bash
python scripts/start.py --port 8095 --no-browser   # 先启动
python scripts/smoke.py                            # 后端端到端冒烟测试（14 项）
```

## 目录结构

```
maestro-cn/
├── SKILL.md
├── scripts/          # setup.py / start.py / smoke.py
├── references/       # providers.md / api.md / workbuddy.md
└── assets/app/       # 应用完整源码（backend/frontend/electron/tests/run.py/requirements.txt/package.json）
```

## 注意事项

- 数据与 API Key 仅存本机（`assets/app/data/maestro.db`）；不做多人共享/云端部署。
- 依赖：Python 3.11+、可选 Node.js 18+（桌面版）；应用无任何外部 CDN 引用。
- 端口被占用时会报错，换 `--port` 即可。
