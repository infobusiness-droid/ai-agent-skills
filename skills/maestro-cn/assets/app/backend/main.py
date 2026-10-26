"""maestro-cn 主应用：FastAPI 路由 + SSE 流式 + 前端静态托管。"""
import asyncio
import json
import re
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db, providers

app = FastAPI(title="maestro-cn")
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@app.on_event("startup")
def _startup():
    db.init_db()


# ---------- 工具 ----------

def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def get_agent_or_404(agent_id: int):
    a = db.query_one("SELECT * FROM agents WHERE id=?", (agent_id,))
    if not a:
        raise HTTPException(404, "智能体不存在")
    return a


def get_settings_masked() -> dict:
    s = db.get_app_settings()
    out = json.loads(json.dumps(s, ensure_ascii=False))
    for pid, p in (out.get("providers") or {}).items():
        p["api_key"] = providers.mask_key(p.get("api_key", ""))
    return out


# ---------- 健康检查 ----------

@app.get("/health")
def health():
    return {"ok": True}


# ---------- 智能体 ----------

@app.get("/api/agents")
def list_agents():
    rows = db.query(
        "SELECT a.*, (SELECT COUNT(*) FROM conversations c WHERE c.agent_id=a.id) AS conv_count, "
        "(SELECT MAX(updated_at) FROM conversations c WHERE c.agent_id=a.id) AS last_active "
        "FROM agents a ORDER BY a.id")
    return rows


@app.post("/api/agents")
def create_agent(body: dict):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "智能体名称不能为空")
    kind = body.get("kind", "llm")
    if kind not in ("llm", "cli"):
        raise HTTPException(400, "kind 必须为 llm 或 cli")
    aid = db.execute(
        "INSERT INTO agents (name, role, system_prompt, provider, model, temperature, max_tokens, kind, cli_config, workdir) "
        "VALUES (?,?,?,?,?,?,?,?,?,?)",
        (name, body.get("role", ""), body.get("system_prompt", ""),
         body.get("provider", "ark"), body.get("model", ""),
         float(body.get("temperature", 0.7)), int(body.get("max_tokens", 4096)),
         kind, json.dumps(body.get("cli_config") or {}, ensure_ascii=False), body.get("workdir", "")))
    return get_agent_or_404(aid)


@app.put("/api/agents/{agent_id}")
def update_agent(agent_id: int, body: dict):
    get_agent_or_404(agent_id)
    db.execute(
        "UPDATE agents SET name=?, role=?, system_prompt=?, provider=?, model=?, temperature=?, max_tokens=?, "
        "kind=?, cli_config=?, workdir=?, updated_at=datetime('now','localtime') WHERE id=?",
        (body.get("name"), body.get("role", ""), body.get("system_prompt", ""),
         body.get("provider", "ark"), body.get("model", ""),
         float(body.get("temperature", 0.7)), int(body.get("max_tokens", 4096)),
         body.get("kind", "llm"), json.dumps(body.get("cli_config") or {}, ensure_ascii=False),
         body.get("workdir", ""), agent_id))
    return get_agent_or_404(agent_id)


@app.delete("/api/agents/{agent_id}")
def delete_agent(agent_id: int):
    get_agent_or_404(agent_id)
    db.execute("DELETE FROM agents WHERE id=?", (agent_id,))
    return {"ok": True}


@app.post("/api/agents/{agent_id}/test")
async def test_agent(agent_id: int):
    agent = get_agent_or_404(agent_id)
    pricing = db.get_app_settings().get("pricing", {})
    try:
        text, tin, tout = await providers.reply_for(agent, "请只回复两个字：正常", pricing, 0.2, 16)
        return {"ok": True, "reply": text[:200]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------- 会话与聊天 ----------

@app.get("/api/agents/{agent_id}/conversations")
def list_conversations(agent_id: int):
    get_agent_or_404(agent_id)
    rows = db.query(
        "SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS msg_count "
        "FROM conversations c WHERE c.agent_id=? ORDER BY c.updated_at DESC LIMIT 100", (agent_id,))
    return rows


@app.post("/api/conversations")
def create_conversation(body: dict):
    agent_id = int(body.get("agent_id"))
    get_agent_or_404(agent_id)
    cid = db.execute(
        "INSERT INTO conversations (agent_id, title) VALUES (?, ?)",
        (agent_id, (body.get("title") or "新对话")[:40]))
    return db.query_one("SELECT * FROM conversations WHERE id=?", (cid,))


@app.get("/api/conversations/{cid}/messages")
def list_messages(cid: int):
    rows = db.query("SELECT * FROM messages WHERE conversation_id=? ORDER BY id", (cid,))
    return rows


@app.delete("/api/conversations/{cid}")
def delete_conversation(cid: int):
    db.execute("DELETE FROM messages WHERE conversation_id=?", (cid,))
    db.execute("DELETE FROM conversations WHERE id=?", (cid,))
    return {"ok": True}


MENTION_RE = re.compile(r"@([\u4e00-\u9fa5A-Za-z0-9_\-]+)")


def resolve_mentions(agent_id: int, text: str):
    """解析 @名字 → 返回提及的智能体列表（排除自身）。"""
    all_agents = db.query("SELECT id, name FROM agents")
    by_name = {}
    for a in all_agents:
        by_name.setdefault(a["name"], a["id"])
    ids = []
    for m in MENTION_RE.findall(text):
        if m in by_name and by_name[m] != agent_id and by_name[m] not in ids:
            ids.append(by_name[m])
    return [db.query_one("SELECT * FROM agents WHERE id=?", (i,)) for i in ids]


class ChatIn(BaseModel):
    message: str = Field(..., min_length=1)
    conversation_id: int | None = None
    rounds_max: int = 3


@app.post("/api/agents/{agent_id}/chat/stream")
async def chat_stream(agent_id: int, body: ChatIn):
    agent = get_agent_or_404(agent_id)
    message = body.message.strip()
    if not message:
        raise HTTPException(400, "消息不能为空")
    pricing = db.get_app_settings().get("pricing", {})

    cid = body.conversation_id
    if cid:
        conv = db.query_one("SELECT * FROM conversations WHERE id=? AND agent_id=?", (cid, agent_id))
        if not conv:
            raise HTTPException(404, "会话不存在")
    else:
        cid = db.execute(
            "INSERT INTO conversations (agent_id, title) VALUES (?, ?)",
            (agent_id, message[:20]))

    db.execute("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)", (cid, message))
    db.execute("UPDATE conversations SET updated_at=datetime('now','localtime') WHERE id=?", (cid,))

    async def gen():
        queue: asyncio.Queue = asyncio.Queue()

        async def impl():
            try:
                await queue.put(("meta", {"conversation_id": cid}))
                consult_results = []
                for target in resolve_mentions(agent_id, message):
                    prompt = f"[转交咨询] 主对话用户消息：\n{message}\n请直接给出你的回答。"
                    try:
                        text, _, _ = await providers.reply_for(
                            target, prompt, pricing,
                            target.get("temperature"), target.get("max_tokens"))
                    except Exception as e:
                        text = f"（咨询失败：{e}）"
                    consult_results.append({"name": target["name"], "content": text})
                    await queue.put(("mention", {"agent": target["name"], "content": text}))

                # 构造上下文：最近 20 条 + 本次消息（含征询意见）
                history = db.query(
                    "SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 20", (cid,))
                history = list(reversed(history))
                msgs = [{"role": "system", "content": agent.get("system_prompt") or agent.get("role") or ""}]
                for m in history[:-1]:
                    msgs.append({"role": m["role"], "content": m["content"]})
                user_content = message
                if consult_results:
                    user_content += "\n\n[已征询成员意见]\n" + "\n".join(
                        f"- {r['name']}：{r['content']}" for r in consult_results)
                msgs.append({"role": "user", "content": user_content})

                parts = []

                async def on_delta(chunk):
                    parts.append(chunk)
                    await queue.put(("chunk", {"delta": chunk}))

                if agent.get("kind") == "cli":
                    text, tin, tout = await providers.reply_for(
                        agent, message, pricing, agent.get("temperature"), agent.get("max_tokens"))
                    for chunk in _split(text, 24):
                        parts.append(chunk)
                        await queue.put(("chunk", {"delta": chunk}))
                else:
                    provider = db.provider_config(agent["provider"])
                    text, tin, tout = await providers.llm_chat(
                        provider, agent["model"], msgs,
                        agent.get("temperature", 0.7), agent.get("max_tokens", 4096),
                        pricing, on_delta=on_delta)
                cost = providers.compute_cost(agent["model"], tin, tout, pricing)
                mid = db.execute(
                    "INSERT INTO messages (conversation_id, role, content, tokens_in, tokens_out, cost) "
                    "VALUES (?, 'assistant', ?, ?, ?, ?)",
                    (cid, "".join(parts), tin, tout, cost))
                await queue.put(("done", {"message_id": mid, "tokens_in": tin, "tokens_out": tout, "cost": cost}))
            except Exception as e:
                await queue.put(("error", {"content": str(e)}))

        task = asyncio.create_task(impl())
        try:
            while True:
                try:
                    ev, data = await asyncio.wait_for(queue.get(), timeout=0.5)
                    yield sse(ev, data)
                    if ev in ("done", "error"):
                        break
                except asyncio.TimeoutError:
                    if task.done():
                        break
                    continue
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream")


def _split(text: str, size: int):
    for i in range(0, len(text), size):
        yield text[i : i + size]


# ---------- 群聊 ----------

class GroupIn(BaseModel):
    title: str = "新群聊"
    moderator_id: int
    member_ids: list[int] = []


@app.get("/api/groupchats")
def list_groupchats():
    rows = db.query("SELECT * FROM group_chats ORDER BY updated_at DESC")
    out = []
    for r in rows:
        members = db.query(
            "SELECT a.id, a.name FROM group_members gm JOIN agents a ON a.id=gm.agent_id "
            "WHERE gm.group_chat_id=? ORDER BY gm.sort", (r["id"],))
        last = db.query_one(
            "SELECT sender, content, created_at FROM group_messages WHERE group_chat_id=? ORDER BY id DESC LIMIT 1",
            (r["id"],))
        d = dict(r)
        d["members"] = members
        d["last_message"] = last
        out.append(d)
    return out


@app.post("/api/groupchats")
def create_groupchat(body: GroupIn):
    get_agent_or_404(body.moderator_id)
    gid = db.execute("INSERT INTO group_chats (title, moderator_id) VALUES (?, ?)",
                     (body.title[:40], body.moderator_id))
    for i, mid in enumerate(body.member_ids):
        if mid != body.moderator_id:
            db.execute("INSERT INTO group_members (group_chat_id, agent_id, sort) VALUES (?,?,?)", (gid, mid, i))
    return get_groupchat(gid)


@app.get("/api/groupchats/{gid}")
def get_groupchat(gid: int):
    r = db.query_one("SELECT * FROM group_chats WHERE id=?", (gid,))
    if not r:
        raise HTTPException(404, "群聊不存在")
    members = db.query(
        "SELECT a.* FROM group_members gm JOIN agents a ON a.id=gm.agent_id "
        "WHERE gm.group_chat_id=? ORDER BY gm.sort", (gid,))
    messages = db.query("SELECT * FROM group_messages WHERE group_chat_id=? ORDER BY id", (gid,))
    mod = db.query_one("SELECT id, name FROM agents WHERE id=?", (r["moderator_id"],))
    d = dict(r)
    d["moderator"] = mod
    d["members"] = members
    d["messages"] = messages
    return d


@app.post("/api/groupchats/{gid}/members")
def add_members(gid: int, body: dict):
    get_groupchat(gid)
    sort = db.query_one("SELECT COALESCE(MAX(sort),0)+1 s FROM group_members WHERE group_chat_id=?", (gid,))["s"]
    for i, mid in enumerate(body.get("agent_ids", [])):
        db.execute("INSERT INTO group_members (group_chat_id, agent_id, sort) VALUES (?,?,?)", (gid, mid, sort + i))
    return get_groupchat(gid)


@app.delete("/api/groupchats/{gid}/members/{agent_id}")
def remove_member(gid: int, agent_id: int):
    db.execute("DELETE FROM group_members WHERE group_chat_id=? AND agent_id=?", (gid, agent_id))
    return get_groupchat(gid)


@app.delete("/api/groupchats/{gid}")
def delete_groupchat(gid: int):
    db.execute("DELETE FROM group_members WHERE group_chat_id=?", (gid,))
    db.execute("DELETE FROM group_messages WHERE group_chat_id=?", (gid,))
    db.execute("DELETE FROM group_chats WHERE id=?", (gid,))
    return {"ok": True}


class GroupRunIn(BaseModel):
    question: str = Field(..., min_length=1)
    rounds_max: int = 3


@app.post("/api/groupchats/{gid}/run")
async def group_run(gid: int, body: GroupRunIn):
    get_groupchat(gid)

    async def gen():
        from . import groupchat as gc
        queue: asyncio.Queue = asyncio.Queue()

        async def emit(event, data):
            await queue.put((event, data))

        task = asyncio.create_task(
            gc.run_group_chat(gid, body.question.strip(), body.rounds_max, emit))
        try:
            while True:
                try:
                    ev, data = await asyncio.wait_for(queue.get(), timeout=0.5)
                    yield sse(ev, data)
                except asyncio.TimeoutError:
                    if task.done():
                        if queue.empty():
                            break
                        continue
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------- Auto Run ----------

class AutoRunIn(BaseModel):
    agent_id: int
    title: str = "自动执行"
    mode: str = "checklist"          # checklist | goal
    goal: str = ""
    items: list[dict] = []           # [{title, detail}]


@app.get("/api/autoruns")
def list_autoruns():
    rows = db.query("SELECT * FROM autoruns ORDER BY id DESC LIMIT 50")
    out = []
    for r in rows:
        items = db.query("SELECT * FROM autorun_items WHERE autorun_id=? ORDER BY idx", (r["id"],))
        d = dict(r)
        d["items"] = items
        out.append(d)
    return out


@app.post("/api/autoruns")
def create_autorun(body: AutoRunIn):
    get_agent_or_404(body.agent_id)
    if body.mode == "goal":
        if not body.goal.strip():
            raise HTTPException(400, "目标不能为空")
        rid = db.execute("INSERT INTO autoruns (agent_id, title, mode, goal) VALUES (?,?,?,?)",
                         (body.agent_id, body.title[:40], "goal", body.goal))
    else:
        items = body.items or []
        rid = db.execute("INSERT INTO autoruns (agent_id, title, mode) VALUES (?,?,?)",
                         (body.agent_id, body.title[:40], "checklist"))
        for i, it in enumerate(items):
            db.execute("INSERT INTO autorun_items (autorun_id, idx, title, detail) VALUES (?,?,?,?)",
                       (rid, i, (it.get("title") or f"任务{i+1}")[:200], it.get("detail", "")))
    return db.query_one("SELECT * FROM autoruns WHERE id=?", (rid,))


@app.get("/api/autoruns/{rid}")
def get_autorun(rid: int):
    r = db.query_one("SELECT * FROM autoruns WHERE id=?", (rid,))
    if not r:
        raise HTTPException(404, "任务不存在")
    d = dict(r)
    d["items"] = db.query("SELECT * FROM autorun_items WHERE autorun_id=? ORDER BY idx", (rid,))
    return d


@app.post("/api/autoruns/{rid}/run")
async def run_autorun_endpoint(rid: int):
    async def gen():
        from . import autorun as ar
        queue: asyncio.Queue = asyncio.Queue()

        async def emit(event, data):
            await queue.put((event, data))

        task = asyncio.create_task(ar.run_autorun(rid, emit))
        try:
            while True:
                try:
                    ev, data = await asyncio.wait_for(queue.get(), timeout=0.5)
                    yield sse(ev, data)
                except asyncio.TimeoutError:
                    if task.done():
                        if queue.empty():
                            break
                        continue
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------- Playbook ----------

@app.get("/api/playbooks")
def list_playbooks():
    return db.query("SELECT * FROM playbooks ORDER BY id DESC")


@app.post("/api/playbooks")
def create_playbook(body: dict):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "名称不能为空")
    pid = db.execute("INSERT INTO playbooks (name, mode, goal, items) VALUES (?,?,?,?)",
                     (name[:40], body.get("mode", "checklist"), body.get("goal", ""),
                      json.dumps(body.get("items") or [], ensure_ascii=False)))
    return db.query_one("SELECT * FROM playbooks WHERE id=?", (pid,))


@app.delete("/api/playbooks/{pid}")
def delete_playbook(pid: int):
    db.execute("DELETE FROM playbooks WHERE id=?", (pid,))
    return {"ok": True}


# ---------- 用量统计 ----------

@app.get("/api/usage")
def usage(days: int = 30):
    sql_m = ("SELECT date(created_at) d, SUM(tokens_in) tin, SUM(tokens_out) tout, SUM(cost) cost "
             "FROM messages WHERE created_at >= datetime('now','localtime', ?) GROUP BY d")
    by_day = {}
    for row in db.query(sql_m, (f"-{int(days)} days",)) + \
            db.query("SELECT date(created_at) d, SUM(tokens_in) tin, SUM(tokens_out) tout, SUM(cost) cost "
                     "FROM group_messages WHERE created_at >= datetime('now','localtime', ?) GROUP BY d", (f"-{int(days)} days",)) + \
            db.query("SELECT date(created_at) d, SUM(tokens_in) tin, SUM(tokens_out) tout, SUM(cost) cost "
                     "FROM autorun_items WHERE created_at >= datetime('now','localtime', ?) GROUP BY d", (f"-{int(days)} days",)):
        if row["d"]:
            k = row["d"]
            e = by_day.setdefault(k, {"date": k, "tokens_in": 0, "tokens_out": 0, "cost": 0})
            e["tokens_in"] += row["tin"] or 0
            e["tokens_out"] += row["tout"] or 0
            e["cost"] += row["cost"] or 0
    by_agent = []
    for row in db.query(
            "SELECT a.name, SUM(m.tokens_in) tin, SUM(m.tokens_out) tout, SUM(m.cost) cost "
            "FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN agents a ON a.id=c.agent_id "
            "GROUP BY a.id ORDER BY cost DESC"):
        by_agent.append({"name": row["name"], "tokens_in": row["tin"] or 0,
                         "tokens_out": row["tout"] or 0, "cost": row["cost"] or 0})
    tot = db.query_one("SELECT COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout, COALESCE(SUM(cost),0) cost FROM messages")
    tot_g = db.query_one("SELECT COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout, COALESCE(SUM(cost),0) cost FROM group_messages")
    tot_a = db.query_one("SELECT COALESCE(SUM(tokens_in),0) tin, COALESCE(SUM(tokens_out),0) tout, COALESCE(SUM(cost),0) cost FROM autorun_items")
    return {
        "by_day": sorted(by_day.values(), key=lambda x: x["date"]),
        "by_agent": by_agent,
        "total": {
            "tokens_in": tot["tin"] + tot_g["tin"] + tot_a["tin"],
            "tokens_out": tot["tout"] + tot_g["tout"] + tot_a["tout"],
            "cost": round(tot["cost"] + tot_g["cost"] + tot_a["cost"], 4),
        },
    }


# ---------- 设置 ----------

@app.get("/api/settings")
def get_settings():
    return get_settings_masked()


@app.put("/api/settings")
def put_settings(body: dict):
    db.put_app_settings(body)
    return get_settings_masked()


# ---------- 前端静态 ----------

app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
