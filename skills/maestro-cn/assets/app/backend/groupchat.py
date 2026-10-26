"""Group Chat 群聊引擎：主持智能体分派、追问、总结。"""
from . import db, providers


async def run_group_chat(chat_id: int, question: str, rounds_max: int, emit):
    """执行一轮群聊。emit(event, data) 用于 SSE 推送。"""
    chat = db.query_one("SELECT * FROM group_chats WHERE id=?", (chat_id,))
    if not chat:
        raise ValueError("群聊不存在")
    moderator = db.query_one("SELECT * FROM agents WHERE id=?", (chat["moderator_id"],))
    if not moderator:
        raise ValueError("主持人智能体不存在")
    member_rows = db.query(
        "SELECT a.* FROM group_members gm JOIN agents a ON a.id=gm.agent_id "
        "WHERE gm.group_chat_id=? ORDER BY gm.sort", (chat_id,))
    members = [m for m in member_rows if m["id"] != moderator["id"]]

    settings = db.get_app_settings()
    pricing = settings.get("pricing", {})
    defaults = settings.get("defaults", {})

    # 保存用户问题
    db.execute(
        "INSERT INTO group_messages (group_chat_id, role, sender, content) VALUES (?, 'user', '', ?)",
        (chat_id, question))
    await emit("user", {"content": question})
    await emit("start", {"moderator": moderator["name"], "members": [m["name"] for m in members]})

    history = []
    rounds = max(1, min(int(rounds_max or 3), 6))

    def save_turn(sender, content, role="turn"):
        db.execute(
            "INSERT INTO group_messages (group_chat_id, role, sender, content) VALUES (?, ?, ?, ?)",
            (chat_id, role, sender, content))

    cur_question = question
    for round_no in range(rounds):
        await emit("round", {"round": round_no + 1, "total": rounds})
        for m in members:
            prompt = (
                f"你在一个群聊讨论中，群聊主持人正在组织讨论。\n"
                f"当前轮次问题：{cur_question}\n"
                f"已有讨论记录：\n" + ("\n".join(f"- {h['name']}：{h['text']}" for h in history) or "（无）") +
                f"\n\n请从你的专业视角给出观点或回答，控制在 300 字以内，直接输出内容。"
            )
            await emit("turn_start", {"agent": m["name"]})
            try:
                text, tin, tout = await providers.reply_for(
                    m, prompt, pricing,
                    m.get("temperature", defaults.get("temperature", 0.7)),
                    m.get("max_tokens", defaults.get("max_tokens", 4096)))
                cost = providers.compute_cost(m["model"], tin, tout, pricing)
                save_turn(m["name"], text)
                db.execute(
                    "UPDATE group_messages SET tokens_in=?, tokens_out=?, cost=? WHERE id=("
                    "SELECT MAX(id) FROM group_messages WHERE group_chat_id=?)",
                    (tin, tout, cost, chat_id))
                history.append({"name": m["name"], "text": text})
                await emit("turn", {"agent": m["name"], "content": text})
            except Exception as e:
                err = f"（成员「{m['name']}」回复失败：{e}）"
                save_turn(m["name"], err)
                history.append({"name": m["name"], "text": err})
                await emit("turn_error", {"agent": m["name"], "content": str(e)})

        if round_no >= rounds - 1:
            break
        decision = await providers.moderator_decision(
            db.provider_config(moderator["provider"]), moderator["model"],
            moderator.get("temperature", defaults.get("temperature", 0.7)),
            moderator.get("max_tokens", defaults.get("max_tokens", 4096)),
            cur_question, history, round_no)
        if decision.get("action") == "summarize":
            break
        followup = decision.get("focus") or "请进一步补充说明。"
        await emit("followup", {"content": followup})
        cur_question = followup

    # 主持总结
    summary_prompt = (
        f"你是群聊主持人「{moderator['name']}」。请汇总以下讨论，输出一份结论总结：\n"
        f"原始问题：{question}\n"
        f"讨论过程：\n" + "\n".join(f"- {h['name']}：{h['text']}" for h in history) +
        "\n\n总结要求：1) 核心结论；2) 各成员观点摘要；3) 主要分歧（如有）；4) 下一步建议。分点输出。"
    )
    await emit("synthesis_start", {})
    try:
        text, tin, tout = await providers.reply_for(
            moderator, summary_prompt, pricing,
            moderator.get("temperature", defaults.get("temperature", 0.7)),
            moderator.get("max_tokens", defaults.get("max_tokens", 4096)))
        cost = providers.compute_cost(moderator["model"], tin, tout, pricing)
        save_turn(moderator["name"], text, role="synthesis")
        db.execute(
            "UPDATE group_messages SET tokens_in=?, tokens_out=?, cost=? WHERE id=("
            "SELECT MAX(id) FROM group_messages WHERE group_chat_id=?)",
            (tin, tout, cost, chat_id))
        await emit("synthesis", {"agent": moderator["name"], "content": text})
    except Exception as e:
        await emit("error", {"content": f"主持总结失败：{e}"})

    db.execute("UPDATE group_chats SET updated_at=datetime('now','localtime') WHERE id=?", (chat_id,))
    await emit("done", {})
