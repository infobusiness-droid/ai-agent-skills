# ai-agent-skills

在豆包办公中开发的 AI 技能合集（可安装的 Skill 包），面向中国区用户，全部接入国内可用模型。

## 技能列表

| 目录 | 说明 | 依赖 |
|---|---|---|
| `skills/maestro-cn` | 国内版多智能体编排工作台（Maestro 复刻）：单聊 / 群聊（Group Chat）/ 自动执行 / 剧本 / 用量统计；接入豆包（火山方舟）、DeepSeek、通义千问、智谱 GLM、Kimi 等国内模型与 workbuddy CLI | Python 3.10+，pip 安装依赖（见技能内 `requirements.txt`），可选 Node.js（Electron 桌面版） |

## 安装方式

把对应技能目录复制到你的 AI 技能目录即可：

- **豆包办公**：复制到 `workspace/.user_skills/<skill-name>/`
- **Claude Code**：复制到 `.claude/skills/<skill-name>/`
- **Codex**：复制到 `.codex/skills/<skill-name>/`

安装后按各技能 `SKILL.md` 的快速开始执行（一般先跑 `scripts/setup.py` 装依赖，再 `scripts/start.py` 启动，`scripts/smoke.py` 自检）。

## 开发与贡献

技能目录结构遵循标准 Skill 规范：`SKILL.md` + `scripts/`（可执行脚本）+ `references/`（文档）+ `assets/`（应用源码/模板）。欢迎提交新技能或改进。
