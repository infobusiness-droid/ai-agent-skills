# maestro-cn · 国内版多智能体编排工作台

复刻 [RunMaestro/Maestro](https://github.com/RunMaestro/Maestro) 的多智能体协作体验，面向国内用户：
**不需要境外模型**，直接接入豆包（火山方舟）、DeepSeek、通义千问、智谱 GLM、Kimi 等国内模型，
并预留了 workbuddy（外部 CLI 工具）接入位。本地运行、数据只存本机 SQLite，不上传任何服务器。

当前版本 v0.1.0：网页版 + Electron 桌面壳。

---

## 功能一览（对标 Maestro 核心能力）

| 模块 | 说明 |
|---|---|
| 智能体工作台 | 创建/编辑 LLM 智能体或 CLI（workbuddy）智能体；单聊支持流式输出、`@提及` 跨智能体征询、`/new` 清空、`/help` |
| 群聊（Group Chat） | 选主持智能体 + 多名成员发起讨论：分派问题 → 成员回答 → 主持追问 → 主持总结，全过程流式展示 |
| 自动执行（Auto Run） | 把 Markdown 清单或一段目标交给某个智能体逐项自动完成；两种模式：清单模式 / 目标模式；可保存为剧本 |
| 剧本库（Playbook） | 把常用自动执行清单收藏为剧本，一键重新运行 |
| 用量统计 | 按智能体与日期统计输入/输出 token 与费用（价格表可在设置中改） |
| 设置 | 各家模型提供商 Base URL / API Key / 模型 / 价格 / 默认参数；API Key 掩码显示、只存本机 |
| 快捷键 | `Ctrl+J` 切换主题、`Ctrl+[`/`Ctrl+]` 切换板块、`/` 聚焦输入、`Esc` 关闭弹窗 |

---

## 一、网页版运行（最快上手）

需要 **Python 3.11+**（开发环境为 3.13）。

```powershell
# 1. 安装依赖
pip install -r requirements.txt

# 2. 启动（默认端口 8090，自动打开浏览器）
python run.py

# 指定端口、不自动开浏览器：
python run.py --port 8095 --no-browser
```

启动后浏览器访问 `http://127.0.0.1:8090/`（或指定端口）。

**没配 API Key 也能玩**：预置了 4 个智能体，默认是「离线演示（mock）」模式，聊天/群聊/自动执行全流程都可以先体验；配好 Key 后把智能体切回真实模型即可。

---

## 二、桌面版运行（Electron）

需要 **Node.js 18+**（开发环境为 v22）。

```powershell
# 1. 安装 electron（仅开发依赖）
npm install

# 2. 启动桌面应用（会自动拉起本地后端并打开窗口）
npm start
```

`electron/main.js` 会以子进程方式启动 `python run.py --no-browser --port 8095`，
等后端就绪后打开窗口；关闭窗口即退出后端。桌面包后续可用 electron-builder 进一步打包成安装包（本期未做）。

---

## 三、接入国内模型（重点）

所有提供商都在「设置」页配置。API Key 只写入本机 SQLite（`data/maestro.db`），显示时掩码。

### 3.1 豆包 · 火山方舟（推荐，价格便宜、速度快）

1. 打开火山引擎控制台并登录/注册：`https://console.volcengine.com`（未实名需先完成企业或个人实名认证）。
2. 进入「火山方舟」控制台：`https://console.volcengine.com/ark`。
3. 在「开通管理」中开通需要的模型（如 doubao-seed、doubao-1.5 系列），开通即可。
4. 左侧「API Key 管理」→「创建 API Key」，复制保存（只显示一次）。
5. 回到本应用「设置」页，把 Key 粘贴到「火山方舟·豆包」的 API Key 栏；
   Base URL 保持 `https://ark.cn-beijing.volces.com/api/v3`，保存。
6. 模型名可直接填已开通模型，如 `doubao-seed-1.6-flash`、`doubao-1.5-pro-32k`；
   若使用接入点（endpoint）方式，可填 `ep-xxxx` 接入点 ID。
7. 在「智能体」页把对应智能体的提供商切到「火山方舟·豆包」、填好模型名，即可真实对话。

### 3.2 其他国内模型（设置页同样操作）

| 提供商 | 控制台 | Base URL | 示例模型 |
|---|---|---|---|
| DeepSeek | platform.deepseek.com | `https://api.deepseek.com` | deepseek-chat、deepseek-reasoner |
| 通义千问（阿里云百炼） | bailian.console.aliyun.com | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-plus、qwen-max、qwen-turbo |
| 智谱 GLM | open.bigmodel.cn | `https://open.bigmodel.cn/api/paas/v4` | glm-4-plus、glm-4-flash |
| Kimi | platform.moonshot.cn | `https://api.moonshot.cn/v1` | moonshot-v1-8k / 32k / 128k |

> 均兼容 OpenAI Chat Completions 协议，本应用按该协议接入；豆包也提供 OpenAI 兼容端点（即上面的 v3 Base URL）。

### 3.3 完全离线体验

把智能体的提供商设为「离线演示（mock）」即可，无需任何 Key：回答为本地模拟内容，用于体验与演示全部功能与界面。

---

## 四、接入 workbuddy（外部 CLI 工具）

workbuddy 若有 API / CLI 接口，可用「外部 CLI 工具」类型的智能体接入：

1. 「智能体」页 → 新建智能体 → 类型选「外部 CLI 工具（workbuddy）」。
2. 填写**命令模板**：用 `{prompt}` 占位符表示将要交给 workbuddy 的指令文本，例如
   `workbuddy run --task "{prompt}"`（按你实际安装的 CLI 命令填写）。
3. 可指定**工作目录**（workdir），命令将在该目录下执行。
4. 保存后，该智能体出现在聊天/群聊/自动执行中，与 LLM 智能体一样被调度；调用超时上限 600 秒。

> 说明：目前适配器为预留实现（子进程执行命令模板），等待 workbuddy 的具体接口文档后补充参数格式。文档到位后，在「设置 → workbuddy」中启用并填写即可。

---

## 五、目录结构

```
maestro-cn/
├── run.py                 # 后端启动器（--port / --no-browser）
├── requirements.txt       # Python 依赖
├── package.json           # Electron 桌面壳
├── electron/
│   └── main.js            # 桌面壳：拉起后端 + 打开窗口
├── backend/
│   ├── main.py            # FastAPI 路由 + SSE 流式
│   ├── db.py              # SQLite 数据层（11 张表、默认设置、示例智能体）
│   ├── providers.py       # 模型调用（OpenAI 兼容 + mock）、计费估算
│   ├── groupchat.py       # 群聊引擎（分派→回答→追问→总结）
│   ├── autorun.py         # 自动执行引擎（清单/目标两种模式）
│   └── workbuddy.py       # workbuddy CLI 适配器（预留）
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/ (api.js, ui.js, views.js, app.js)
├── data/                  # SQLite 数据库（运行时生成）
└── tests/
    ├── smoke_test.py      # 后端端到端冒烟测试（14 项）
    └── switch_mock.py     # 把所有智能体切到 mock
```

---

## 六、验证与测试

```powershell
# 启动后端后运行后端冒烟测试（需先切 mock 或配置 Key）
python tests/switch_mock.py
python tests/smoke_test.py
# 预期输出：通过 14 项，失败 0 项
```

覆盖：健康检查、智能体种子数据、单聊 SSE 流式与落库、@提及、群聊事件与落库、自动执行（清单+目标）、剧本、用量统计、设置掩码读写。

---

## 七、已知边界（v0.1.0）

- workbuddy 具体接口文档待提供，CLI 适配器当前按命令模板占位实现。
- 桌面版暂未用 electron-builder 打成安装包；`npm start` 直接运行。
- 数据与 API Key 仅存本机；多人共享/云端部署不在本期范围。
