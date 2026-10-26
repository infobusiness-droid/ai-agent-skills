"""Auto Run 自动执行引擎：Markdown 清单 / 自由目标，逐项调用智能体。"""
from . import db, providers


async def run_autorun(autorun_id: int, emit):
    run = db.query_one("SELECT * FROM autoruns WHERE id=?", (autorun_id,))
    if not run:
        raise ValueError("任务不存在")
    agent = db.query_one("SELECT * FROM agents WHERE id=?", (run["agent_id"],))
    if not agent:
        raise ValueError("智能体不存在")
    settings = db.get_app_settings()
    pricing = settings.get("pricing", {})
    defaults = settings.get("defaults", {})

    if run["mode"] == "goal":
        iid = db.execute(
            "INSERT INTO autorun_items (autorun_id, idx, title, detail) VALUES (?, 0, '执行目标', ?)",
            (autorun_id, run["goal"]))
        items = [{"id": iid, "idx": 0, "title": "执行目标", "detail": run["goal"]}]
    else:
        rows = db.query("SELECT * FROM autorun_items WHERE autorun_id=? ORDER BY idx", (autorun_id,))
        items = [dict(r) for r in rows]

    await emit("start", {"title": run["title"], "mode": run["mode"], "total": len(items)})
    for it in items:
        db.execute("UPDATE autorun_items SET status='running', updated_at=datetime('now','localtime') WHERE id=?", (it["id"],))
        await emit("item_start", {"idx": it["idx"], "title": it["title"]})
        prompt = f"【自动执行任务 #{it['idx'] + 1}】\n任务标题：{it['title']}\n任务详情：{it['detail']}\n\n请完成该任务并直接输出结果。"
        try:
            text, tin, tout = await providers.reply_for(
                agent, prompt, pricing,
                agent.get("temperature", defaults.get("temperature", 0.7)),
                agent.get("max_tokens", defaults.get("max_tokens", 4096)))
            cost = providers.compute_cost(agent["model"], tin, tout, pricing)
            db.execute(
                "UPDATE autorun_items SET status='done', result=?, tokens_in=?, tokens_out=?, cost=?, "
                "updated_at=datetime('now','localtime') WHERE id=?", (text, tin, tout, cost, it["id"]))
            await emit("item_done", {"idx": it["idx"], "title": it["title"], "result": text})
        except Exception as e:
            db.execute(
                "UPDATE autorun_items SET status='error', result=?, updated_at=datetime('now','localtime') WHERE id=?",
                (f"执行失败：{e}", it["id"]))
            await emit("item_error", {"idx": it["idx"], "title": it["title"], "error": str(e)})

    db.execute("UPDATE autoruns SET status='done', updated_at=datetime('now','localtime') WHERE id=?", (autorun_id,))
    await emit("done", {})
