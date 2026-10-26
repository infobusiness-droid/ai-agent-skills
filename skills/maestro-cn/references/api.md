# maestro-cn REST API 速查

基础地址：`http://127.0.0.1:<port>`（默认 8090）。除特别说明外均为 JSON；流式接口返回 `text/event-stream`（SSE），每帧格式：

```
event: <event_name>
data: <json>
```

## 健康与系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，返回 `{"status":"ok"}` |
| GET | `/api/settings` | 应用设置（Key 掩码显示） |
| PUT | `/api/settings` | 更新设置（providers/pricing/defaults/workbuddy） |
| GET | `/api/usage?days=30` | 用量统计：totals + 按智能体 + 按日期 |

## 智能体与聊天

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agents` | 智能体列表 |
| POST | `/api/agents` | 新建：`{name, role, system_prompt, provider, model, temperature, max_tokens, kind: "llm"\|"cli", cli_config:{command_template}, workdir}` |
| PUT | `/api/agents/{id}` | 更新智能体 |
| DELETE | `/api/agents/{id}` | 删除智能体 |
| POST | `/api/agents/{id}/test` | 连通性测试（调一次模型） |
| GET | `/api/agents/{id}/conversations` | 会话列表 |
| POST | `/api/conversations` | 新建会话 `{agent_id}` |
| GET | `/api/conversations/{cid}/messages` | 会话消息 |
| DELETE | `/api/conversations/{cid}` | 删除会话 |
| POST | `/api/agents/{id}/chat/stream` | **流式单聊**：`{message, conversation_id?}`；消息内 `@智能体名` 触发跨智能体征询 |

**chat/stream SSE 事件**：`meta {conversation_id}` → `mention {agent, content}`（可选，@征询结果）→ `chunk {delta}`（多次）→ `done {message_id, tokens_in, tokens_out, cost}` 或 `error {content}`。

## 群聊（Group Chat）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/groupchats` | 群聊列表（含成员与最后一条消息） |
| POST | `/api/groupchats` | 新建：`{title, moderator_id, member_ids:[...]}` |
| GET | `/api/groupchats/{gid}` | 群聊详情与消息 |
| POST | `/api/groupchats/{gid}/members` | 加成员 `{agent_id}` |
| DELETE | `/api/groupchats/{gid}/members/{agent_id}` | 移除成员 |
| DELETE | `/api/groupchats/{gid}` | 删除群聊 |
| POST | `/api/groupchats/{gid}/run` | **发起讨论**：`{question, rounds_max?}`，主持智能体自动分派 |

**group run SSE 事件**：`user {content}` → `start {moderator, members}` → `round {round, total}` → `turn_start {agent}` → `turn {agent, content}`（成员回答，可多次）→ `followup {content}`（主持追问）→ 下一轮… → `synthesis_start` → `synthesis {agent, content}`（主持总结）→ `done {}`；单成员出错发 `turn_error {agent, content}`。

## 自动执行（Auto Run）与剧本

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/autoruns` | 任务列表（含 items） |
| POST | `/api/autoruns` | 创建：`{agent_id, title, mode: "checklist"\|"goal", goal?, items:[{title, detail}]}` |
| GET | `/api/autoruns/{rid}` | 任务详情 |
| POST | `/api/autoruns/{rid}/run` | **开始执行**（SSE） |
| GET | `/api/playbooks` | 剧本列表 |
| POST | `/api/playbooks` | 保存剧本：`{name, mode, goal?, items:[...]}` |
| DELETE | `/api/playbooks/{pid}` | 删除剧本 |

**autorun run SSE 事件**：`start {title, mode, total}` → 对每项：`item_start {idx, title}` → `item_done {idx, title, result}` 或 `item_error {idx, title, error}` → 全部完成后 `done {}`。目标模式会在运行时自动生成一个「执行目标」项。

## 示例：用 curl 发起单聊流式

```bash
curl -N -X POST http://127.0.0.1:8090/api/agents/1/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "帮我把新店开业分成三个子任务"}'
```

## 示例：用 httpx 消费群聊 SSE

```python
import httpx
with httpx.stream("POST", "http://127.0.0.1:8090/api/groupchats/1/run",
                  json={"question": "如何推广新店？", "rounds_max": 2}, timeout=None) as r:
    for line in r.iter_lines():
        if line.startswith("data: "):
            print(line[6:])
```
