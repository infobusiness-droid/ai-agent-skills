/* maestro-cn 视图层 */
let State = {
  agents: [],
  settings: null,
  currentAgentId: null,
  currentConvId: null,
  currentGroupId: null,
  currentRunId: null,
  busy: false,
};

async function loadBase(force = false) {
  if (force || !State.settings) State.settings = await API.get("/api/settings");
  if (force || !State.agents.length) State.agents = await API.get("/api/agents");
}

function agentById(id) { return State.agents.find((a) => a.id === id); }
function providerName(pid) {
  const p = State.settings?.providers?.[pid];
  return p ? p.name : pid;
}
function agentMeta(a) {
  return `${providerName(a.provider)} · ${a.model || "未选模型"}`;
}

const Views = {};

/* ================= 智能体 + 聊天 ================= */
Views.agents = async function (root) {
  await loadBase();
  root.innerHTML = "";
  const pane = el("div", { class: "pane" });

  // 左栏：智能体列表
  const left = el("div", { class: "pane-left" });
  left.appendChild(el("div", { class: "list-head", html: "<b>智能体</b>" +
    `<button class="btn sm primary" id="new-agent-btn">＋ 新建</button>` }));
  const listBox = el("div", { class: "list" });
  renderAgentList(listBox);
  left.appendChild(listBox);
  pane.appendChild(left);

  // 右栏：聊天
  const right = el("div", { class: "pane-right" });
  right.appendChild(el("div", { id: "agent-detail" }));
  pane.appendChild(right);
  root.appendChild(pane);

  left.querySelector("#new-agent-btn").addEventListener("click", () => openAgentEditor());
  renderAgentChat(right, State.currentAgentId);
};

function renderAgentList(box) {
  clear(box);
  for (const a of State.agents) {
    const item = el("div", { class: "list-item" + (a.id === State.currentAgentId ? " active" : ""),
      onclick: () => { State.currentAgentId = a.id; State.currentConvId = null; Views.agents(document.getElementById("view")); } });
    item.appendChild(el("div", { class: "t", text: a.name }));
    item.appendChild(el("div", { class: "d", text: a.role || agentMeta(a) }));
    box.appendChild(item);
  }
}

async function renderAgentChat(right, agentId) {
  const holder = right.querySelector("#agent-detail");
  clear(holder);
  const a = agentById(agentId);
  if (!a) {
    holder.appendChild(el("div", { class: "view", html: `<div class="card muted" style="text-align:center;padding:60px">从左侧选择一个智能体开始对话，或新建智能体。</div>` }));
    return;
  }
  // 会话列表
  let convs = await API.get(`/api/agents/${a.id}/conversations`);
  if (!State.currentConvId && convs.length) State.currentConvId = convs[0].id;
  const convSel = el("select", { class: "grow", style: "max-width:260px" });
  for (const c of convs) {
    const opt = el("option", { value: c.id, text: c.title });
    if (c.id === State.currentConvId) opt.selected = true;
    convSel.appendChild(opt);
  }
  convSel.addEventListener("change", () => {
    State.currentConvId = Number(convSel.value);
    renderAgentChat(right, agentId);
  });

  const head = el("div", { class: "row", style: "padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg2)" });
  head.appendChild(el("div", { class: "grow", html: `<b>${esc(a.name)}</b> <span class="muted">${esc(a.role || "—")} · ${esc(agentMeta(a))}</span>` }));
  head.appendChild(el("button", { class: "btn sm", text: "新对话",
    onclick: async () => {
      const c = await API.post("/api/conversations", { agent_id: a.id });
      State.currentConvId = c.id;
      renderAgentChat(right, agentId);
    } }));
  if (convs.length) head.appendChild(convSel);
  head.appendChild(el("button", { class: "btn sm", text: "编辑",
    onclick: () => openAgentEditor(a) }));
  head.appendChild(el("button", { class: "btn sm", text: "测试",
    onclick: async (ev) => {
      ev.target.disabled = true; ev.target.textContent = "测试中…";
      const r = await API.post(`/api/agents/${a.id}/test`);
      ev.target.disabled = false; ev.target.textContent = "测试";
      r.ok ? toast("连接正常：" + r.reply.slice(0, 40), "ok") : toast("失败：" + r.error, "err");
    } }));
  head.appendChild(el("button", { class: "btn sm danger", text: "删除",
    onclick: async () => {
      if (!confirm(`确认删除智能体「${a.name}」？其所有对话也会删除。`)) return;
      await API.del(`/api/agents/${a.id}`);
      State.agents = await API.get("/api/agents");
      State.currentAgentId = State.agents[0]?.id ?? null;
      State.currentConvId = null;
      Views.agents(document.getElementById("view"));
    } }));
  holder.appendChild(head);

  const scroll = el("div", { class: "chat-scroll" });
  holder.appendChild(scroll);
  if (State.currentConvId) {
    const msgs = await API.get(`/api/conversations/${State.currentConvId}/messages`);
    for (const m of msgs) scroll.appendChild(msgNode(m.role, m.content, null));
  }
  scroll.scrollTop = scroll.scrollHeight;

  const inputArea = el("div", { class: "chat-input-area" });
  const ta = el("textarea", { placeholder: `向「${a.name}」提问…（@其他智能体可征询其意见；输入 /help 查看指令）` });
  const sendBtn = el("button", { class: "btn primary", text: "发送" });
  const inputRow = el("div", { class: "chat-input-row" });
  inputRow.appendChild(ta); inputRow.appendChild(sendBtn);
  inputArea.appendChild(inputRow);
  inputArea.appendChild(el("div", { class: "chat-hint", text: "Ctrl+Enter 发送 · /new 新对话 · /help 帮助" }));
  holder.appendChild(inputArea);

  async function send() {
    const text = ta.value.trim();
    if (!text || State.busy) return;
    if (text.startsWith("/")) {
      if (text === "/new") {
        const c = await API.post("/api/conversations", { agent_id: a.id });
        State.currentConvId = c.id; ta.value = "";
        renderAgentChat(right, agentId);
      } else if (text === "/help") {
        openShortcutHelp();
      } else toast("未知指令：" + text.split(" ")[0], "err");
      return;
    }
    State.busy = true; ta.disabled = true; sendBtn.disabled = true;
    scroll.appendChild(msgNode("user", text, null));
    ta.value = "";
    scroll.scrollTop = scroll.scrollHeight;

    const streamBubble = msgNode("assistant", "", { streaming: true });
    scroll.appendChild(streamBubble);
    scroll.scrollTop = scroll.scrollHeight;

    try {
      await ssePost(`/api/agents/${a.id}/chat/stream`,
        { message: text, conversation_id: State.currentConvId }, (event, data) => {
          if (event === "meta") {
            State.currentConvId = data.conversation_id;
          } else if (event === "mention") {
            const mb = msgNode("assistant", `【${data.agent}】\n${data.content}`, { mention: true });
            scroll.insertBefore(mb, streamBubble);
            scroll.scrollTop = scroll.scrollHeight;
          } else if (event === "chunk") {
            appendChunk(streamBubble, data.delta);
            scroll.scrollTop = scroll.scrollHeight;
          } else if (event === "done") {
            setUsage(streamBubble, data);
          } else if (event === "error") {
            appendChunk(streamBubble, "\n\n（错误：" + data.content + "）");
            toast("对话出错：" + data.content, "err");
          }
        });
    } catch (e) {
      appendChunk(streamBubble, "\n\n（请求失败：" + e.message + "）");
    } finally {
      State.busy = false; ta.disabled = false; sendBtn.disabled = false; ta.focus();
    }
  }
  sendBtn.addEventListener("click", send);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
  ta.focus();
};

/* ================= 群聊 ================= */
Views.group = async function (root) {
  await loadBase();
  root.innerHTML = "";
  const pane = el("div", { class: "pane" });
  const left = el("div", { class: "pane-left" });

  // 新建群聊
  const createBox = el("div", { style: "padding:12px 14px;border-bottom:1px solid var(--border)" });
  createBox.appendChild(el("div", { class: "row" },
    el("button", { class: "btn primary sm", text: "＋ 新建群聊", onclick: () => openGroupEditor() })));
  left.appendChild(createBox);

  const listBox = el("div", { class: "list" });
  const groups = await API.get("/api/groupchats");
  for (const g of groups) {
    const item = el("div", { class: "list-item" + (g.id === State.currentGroupId ? " active" : ""),
      onclick: () => { State.currentGroupId = g.id; Views.group(document.getElementById("view")); } });
    item.appendChild(el("div", { class: "t", text: g.title }));
    const names = (g.members || []).map((m) => m.name).join("、");
    item.appendChild(el("div", { class: "d", text: (g.last_message ? g.last_message.sender + "：" : "") + (g.last_message ? g.last_message.content.slice(0, 40) : (names || "暂无成员")) }));
    listBox.appendChild(item);
  }
  left.appendChild(listBox);
  pane.appendChild(left);

  const right = el("div", { class: "pane-right" });
  right.appendChild(el("div", { id: "group-detail" }));
  pane.appendChild(right);
  root.appendChild(pane);
  await renderGroupDetail(right, State.currentGroupId);
};

async function renderGroupDetail(right, gid) {
  const holder = right.querySelector("#group-detail");
  clear(holder);
  if (!gid) {
    holder.appendChild(el("div", { class: "view", html: `<div class="card muted" style="text-align:center;padding:60px">选择或新建一个群聊，让多个智能体围绕同一问题协作讨论。</div>` }));
    return;
  }
  const g = await API.get(`/api/groupchats/${gid}`);
  const a = agentById(g.moderator_id);
  const head = el("div", { style: "padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg2)" });
  head.appendChild(el("div", { class: "row" }));
  head.querySelector(".row").appendChild(el("div", { class: "grow", html: `<b>${esc(g.title)}</b> <span class="muted">主持：${esc(a ? a.name : "—")}</span>` }));
  const modSel = el("select", { class: "sm", style: "max-width:170px" });
  for (const ag of State.agents) {
    const opt = el("option", { value: ag.id, text: ag.name });
    if (ag.id === g.moderator_id) opt.selected = true;
    modSel.appendChild(opt);
  }
  head.querySelector(".row").appendChild(el("button", { class: "btn sm", text: "添加成员", onclick: () => openGroupMembers(g) }));
  head.querySelector(".row").appendChild(el("button", { class: "btn sm danger", text: "删除",
    onclick: async () => {
      if (!confirm(`删除群聊「${g.title}」？`)) return;
      await API.del(`/api/groupchats/${gid}`);
      State.currentGroupId = null;
      Views.group(document.getElementById("view"));
    } }));
  holder.appendChild(head);

  const membersRow = el("div", { style: "padding:8px 16px;border-bottom:1px solid var(--border);background:var(--bg2)" });
  for (const m of g.members) {
    const chip = el("span", { class: "member-chip", html: `${esc(m.name)}` });
    if (m.id !== g.moderator_id) {
      const x = el("span", { class: "x", text: "✕", title: "移除",
        onclick: async () => { await API.del(`/api/groupchats/${gid}/members/${m.id}`); renderGroupDetail(right, gid); } });
      chip.appendChild(x);
    } else chip.appendChild(el("span", { class: "x", style: "color:var(--accent)", text: "主" }));
    membersRow.appendChild(chip);
  }
  holder.appendChild(membersRow);

  const scroll = el("div", { class: "chat-scroll" });
  holder.appendChild(scroll);
  for (const m of g.messages) {
    scroll.appendChild(groupMsgNode(m));
  }
  scroll.scrollTop = scroll.scrollHeight;

  const inputArea = el("div", { class: "chat-input-area" });
  const ta = el("textarea", { placeholder: "输入要群聊讨论的问题…" });
  const rounds = el("select", { style: "max-width:110px" });
  for (const r of [1, 2, 3, 4]) {
    const opt = el("option", { value: r, text: `最多 ${r} 轮` });
    if (r === 2) opt.selected = true;
    rounds.appendChild(opt);
  }
  const runBtn = el("button", { class: "btn primary", text: "发起讨论" });
  const inputRow = el("div", { class: "chat-input-row" });
  inputRow.appendChild(ta); inputRow.appendChild(rounds); inputRow.appendChild(runBtn);
  inputArea.appendChild(inputRow);
  inputArea.appendChild(el("div", { class: "chat-hint", text: "主持人会分派问题给成员、必要时追问，最后输出综合结论。" }));
  holder.appendChild(inputArea);

  async function run() {
    const q = ta.value.trim();
    if (!q || State.busy) return;
    State.busy = true; ta.disabled = true; runBtn.disabled = true;
    ta.value = "";
    scroll.appendChild(msgNode("user", q, null));
    scroll.scrollTop = scroll.scrollHeight;

    try {
      await ssePost(`/api/groupchats/${gid}/run`, { question: q, rounds_max: Number(rounds.value) }, (event, data) => {
        if (event === "start") {
          scroll.appendChild(stepNode(`讨论开始 · 主持：${data.moderator} · 成员：${(data.members || []).join("、")}`, "ok"));
        } else if (event === "round") {
          scroll.appendChild(stepNode(`—— 第 ${data.round}/${data.total} 轮 ——`));
        } else if (event === "turn_start") {
          scroll.appendChild(stepNode(`成员「${data.agent}」正在回答…`));
        } else if (event === "turn") {
          scroll.appendChild(groupMsgNode({ role: "turn", sender: data.agent, content: data.content }));
        } else if (event === "turn_error") {
          scroll.appendChild(stepNode(`「${data.agent}」回答失败：${data.content}`, "err"));
        } else if (event === "followup") {
          scroll.appendChild(stepNode(`主持人追问：${data.content}`, "ok"));
        } else if (event === "synthesis_start") {
          scroll.appendChild(stepNode("主持人正在汇总结论…"));
        } else if (event === "synthesis") {
          scroll.appendChild(groupMsgNode({ role: "synthesis", sender: data.agent, content: data.content }));
        } else if (event === "error") {
          scroll.appendChild(stepNode("错误：" + data.content, "err"));
        }
        scroll.scrollTop = scroll.scrollHeight;
      });
      // 同步服务端最终状态
      const fresh = await API.get(`/api/groupchats/${gid}`);
      clear(scroll);
      for (const m of fresh.messages) scroll.appendChild(groupMsgNode(m));
      scroll.scrollTop = scroll.scrollHeight;
    } catch (e) {
      toast("群聊失败：" + e.message, "err");
    } finally {
      State.busy = false; ta.disabled = false; runBtn.disabled = false; ta.focus();
    }
  }
  runBtn.addEventListener("click", run);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
  });
}

/* ================= 自动执行 ================= */
Views.run = async function (root, params) {
  await loadBase();
  if (params && params.id) State.currentRunId = Number(params.id);
  root.innerHTML = "";
  const pane = el("div", { class: "pane" });
  const left = el("div", { class: "pane-left" });

  const createBox = el("div", { style: "padding:12px 14px;border-bottom:1px solid var(--border)" });
  createBox.appendChild(el("div", { class: "row" },
    el("button", { class: "btn primary sm", text: "＋ 新建自动执行", onclick: () => openRunEditor() })));
  left.appendChild(createBox);

  const listBox = el("div", { class: "list" });
  const runs = await API.get("/api/autoruns");
  for (const r of runs) {
    const item = el("div", { class: "list-item" + (r.id === State.currentRunId ? " active" : ""),
      onclick: () => { State.currentRunId = r.id; Views.run(document.getElementById("view")); } });
    item.appendChild(el("div", { class: "row" }));
    item.querySelector(".row").appendChild(el("div", { class: "grow t", text: r.title }));
    item.querySelector(".row").appendChild(el("span", { class: "badge " + (r.status === "done" ? "ok" : r.status === "error" ? "err" : r.status === "running" ? "warn" : ""), text: r.status === "running" ? "执行中" : r.status === "done" ? "已完成" : r.status === "pending" ? "待执行" : "失败" }));
    const done = r.items.filter((i) => i.status === "done").length;
    item.appendChild(el("div", { class: "d", text: r.mode === "goal" ? "目标模式" : `清单 · ${done}/${r.items.length} 项完成` }));
    listBox.appendChild(item);
  }
  left.appendChild(listBox);
  pane.appendChild(left);

  const right = el("div", { class: "pane-right" });
  right.appendChild(el("div", { id: "run-detail" }));
  pane.appendChild(right);
  root.appendChild(pane);
  await renderRunDetail(right, State.currentRunId);
};

async function renderRunDetail(right, rid) {
  const holder = right.querySelector("#run-detail");
  clear(holder);
  if (!rid) {
    holder.appendChild(el("div", { class: "view", html: `<div class="card muted" style="text-align:center;padding:60px">新建一个自动执行任务：把 Markdown 清单或一个目标交给某个智能体自动逐项完成。</div>` }));
    return;
  }
  const r = await API.get(`/api/autoruns/${rid}`);
  const a = agentById(r.agent_id);
  const head = el("div", { style: "padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg2)" });
  head.appendChild(el("div", { class: "row" }));
  head.querySelector(".row").appendChild(el("div", { class: "grow", html: `<b>${esc(r.title)}</b> <span class="muted">${esc(a ? a.name : "—")} · ${r.mode === "goal" ? "目标模式" : "清单模式"}</span>` }));
  const startBtn = el("button", { class: "btn primary sm", text: r.status === "running" ? "执行中…" : "开始执行",
    disabled: r.status === "running" });
  head.querySelector(".row").appendChild(startBtn);
  holder.appendChild(head);

  const body = el("div", { class: "view", style: "overflow:auto" });
  const bar = el("div", { class: "progress-bar" });
  const barFill = el("div");
  bar.appendChild(barFill);
  body.appendChild(bar);
  const itemsBox = el("div", { style: "margin-top:10px" });
  body.appendChild(itemsBox);

  function renderItems(run) {
    clear(itemsBox);
    const total = run.items.length || 1;
    const done = run.items.filter((i) => i.status === "done" || i.status === "error").length;
    barFill.style.width = Math.round((done / total) * 100) + "%";
    for (const it of run.items) {
      const box = el("div", { class: "item-box " + it.status });
      box.appendChild(el("div", { class: "row" }));
      box.querySelector(".row").appendChild(el("div", { class: "grow", html: `<b>${esc(it.title)}</b> <span class="muted">#${it.idx + 1}</span>` }));
      box.querySelector(".row").appendChild(el("span", { class: "badge " + (it.status === "done" ? "ok" : it.status === "error" ? "err" : it.status === "running" ? "warn" : ""),
        text: it.status === "done" ? "完成" : it.status === "running" ? "执行中" : it.status === "error" ? "失败" : "待执行" }));
      if (it.detail) box.appendChild(el("div", { class: "muted", text: it.detail, style: "margin-top:4px" }));
      if (it.result) box.appendChild(renderMd(it.result));
      itemsBox.appendChild(box);
    }
  }
  renderItems(r);

  async function start() {
    startBtn.disabled = true; startBtn.textContent = "执行中…";
    try {
      await ssePost(`/api/autoruns/${rid}/run`, {}, (event, data) => {
        if (event === "start") toast(`开始执行：共 ${data.total} 项`, "ok");
        else if (event === "item_start") { renderRunDetail(right, rid); }
        else if (event === "item_done" || event === "item_error") { renderRunDetail(right, rid); }
        else if (event === "error") toast("执行出错：" + data.content, "err");
      });
      toast("执行完成", "ok");
    } catch (e) {
      toast("执行失败：" + e.message, "err");
    } finally {
      await Views.run(document.getElementById("view"));
    }
  }
  startBtn.addEventListener("click", start);
  holder.appendChild(body);
}

/* ================= 剧本库 ================= */
Views.playbooks = async function (root) {
  await loadBase();
  root.innerHTML = "";
  const view = el("div", { class: "view" });
  view.appendChild(el("div", { class: "view-title", text: "剧本库" }));
  view.appendChild(el("div", { class: "view-sub", text: "把常用的自动执行清单保存为剧本，随时一键运行。" }));
  const list = await API.get("/api/playbooks");
  if (!list.length) {
    view.appendChild(el("div", { class: "card muted", style: "text-align:center;padding:40px" }, "还没有剧本。在「自动执行」里创建任务后，点“保存为剧本”即可收藏。"));
  } else {
    const grid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px" });
    for (const p of list) {
      const items = JSON.parse(p.items || "[]");
      const card = el("div", { class: "card" });
      card.appendChild(el("div", { class: "row" }));
      card.querySelector(".row").appendChild(el("div", { class: "grow", html: `<b>${esc(p.name)}</b>` }));
      card.querySelector(".row").appendChild(el("span", { class: "badge", text: p.mode === "goal" ? "目标" : "清单" }));
      card.appendChild(el("div", { class: "muted", style: "margin:6px 0 10px", text: `${items.length} 项 · ${p.created_at}` }));
      const row = el("div", { class: "row" });
      row.appendChild(el("button", { class: "btn primary sm grow", text: "运行", onclick: () => runPlaybook(p) }));
      row.appendChild(el("button", { class: "btn sm danger", text: "删除", onclick: async () => {
        if (!confirm("删除该剧本？")) return;
        await API.del(`/api/playbooks/${p.id}`);
        Views.playbooks(document.getElementById("view"));
      } }));
      card.appendChild(row);
      grid.appendChild(card);
    }
    view.appendChild(grid);
  }
  root.appendChild(view);
};

async function runPlaybook(p) {
  // 选择执行智能体
  const modal = openModal(`<h3>运行剧本「${esc(p.name)}」</h3>
    <label>选择执行智能体</label><select id="pb-agent"></select>
    <div class="row" style="margin-top:16px;justify-content:flex-end">
      <button class="btn" id="pb-cancel">取消</button>
      <button class="btn primary" id="pb-ok">开始执行</button>
    </div>`);
  const sel = modal.querySelector("#pb-agent");
  for (const a of State.agents) sel.appendChild(el("option", { value: a.id, text: a.name }));
  modal.querySelector("#pb-cancel").addEventListener("click", closeModal);
  modal.querySelector("#pb-ok").addEventListener("click", async () => {
    closeModal();
    const items = JSON.parse(p.items || "[]");
    const r = await API.post("/api/autoruns", {
      agent_id: Number(sel.value), title: p.name, mode: p.mode, goal: p.goal, items,
    });
    State.currentRunId = r.id;
    location.hash = "#/run";
    await Views.run(document.getElementById("view"));
    toast("已创建自动执行任务，可在右侧点击「开始执行」", "ok");
  });
}

/* ================= 用量统计 ================= */
Views.usage = async function (root) {
  root.innerHTML = "";
  const view = el("div", { class: "view" });
  view.appendChild(el("div", { class: "view-title", text: "用量统计" }));
  view.appendChild(el("div", { class: "view-sub", text: "按本地记录估算的 token 用量与费用（价格以设置中的示例价为准，可修改）。" }));
  const u = await API.get("/api/usage");

  const stats = el("div", { class: "stat-grid" });
  stats.appendChild(statCard("累计费用", fmtCost(u.total.cost)));
  stats.appendChild(statCard("输入 Tokens", fmtTokens(u.total.tokens_in)));
  stats.appendChild(statCard("输出 Tokens", fmtTokens(u.total.tokens_out)));
  stats.appendChild(statCard("总 Tokens", fmtTokens(u.total.tokens_in + u.total.tokens_out)));
  view.appendChild(stats);

  view.appendChild(el("h3", { text: "按智能体", style: "font-size:15px;margin:18px 0 8px" }));
  const t1 = el("table", { class: "data" });
  t1.appendChild(el("thead", { html: "<tr><th>智能体</th><th>输入</th><th>输出</th><th>费用</th></tr>" }));
  const tb1 = el("tbody");
  for (const a of u.by_agent) {
    tb1.appendChild(el("tr", { html: `<td>${esc(a.name)}</td><td>${fmtTokens(a.tokens_in)}</td><td>${fmtTokens(a.tokens_out)}</td><td>${fmtCost(a.cost)}</td>` }));
  }
  if (!u.by_agent.length) tb1.appendChild(el("tr", { html: '<td colspan="4" class="muted">暂无数据</td>' }));
  t1.appendChild(tb1);
  view.appendChild(t1);

  view.appendChild(el("h3", { text: "最近 30 天", style: "font-size:15px;margin:18px 0 8px" }));
  const t2 = el("table", { class: "data" });
  t2.appendChild(el("thead", { html: "<tr><th>日期</th><th>输入</th><th>输出</th><th>费用</th></tr>" }));
  const tb2 = el("tbody");
  for (const d of u.by_day) {
    tb2.appendChild(el("tr", { html: `<td>${esc(d.date)}</td><td>${fmtTokens(d.tokens_in)}</td><td>${fmtTokens(d.tokens_out)}</td><td>${fmtCost(d.cost)}</td>` }));
  }
  if (!u.by_day.length) tb2.appendChild(el("tr", { html: '<td colspan="4" class="muted">暂无数据</td>' }));
  t2.appendChild(tb2);
  view.appendChild(t2);
  root.appendChild(view);
};

/* ================= 设置 ================= */
Views.settings = async function (root) {
  await loadBase(true);
  root.innerHTML = "";
  const view = el("div", { class: "view" });
  view.appendChild(el("div", { class: "view-title", text: "设置" }));
  view.appendChild(el("div", { class: "view-sub", text: "模型提供商、价格与外部工具配置。API Key 只保存在本机 SQLite 中。" }));

  const form = el("div", { id: "settings-form" });

  // 提供商
  const provBox = el("div", { class: "card", style: "margin-bottom:14px" });
  provBox.appendChild(el("h3", { text: "模型提供商", style: "margin:0 0 6px;font-size:15px" }));
  provBox.appendChild(el("div", { class: "muted", style: "margin-bottom:10px" }, "填写 Base URL 与 API Key 即可使用；未配置时可把智能体切到「离线演示（mock）」体验完整功能。"));
  for (const [pid, p] of Object.entries(State.settings.providers)) {
    const box = el("div", { class: "item-box", style: "margin-top:10px" });
    box.appendChild(el("div", { class: "row" }));
    box.querySelector(".row").appendChild(el("div", { class: "grow", html: `<b>${esc(p.name)}</b> <span class="muted">${esc(pid)}</span>` }));
    box.appendChild(el("label", { text: "Base URL" }));
    box.appendChild(el("input", { value: p.base_url, "data-key": `providers.${pid}.base_url` }));
    box.appendChild(el("label", { text: "API Key" }));
    const keyInput = el("input", { type: "password", value: p.api_key, placeholder: p.api_key ? "已配置（显示为掩码）" : "粘贴 API Key", "data-key": `providers.${pid}.api_key` });
    box.appendChild(keyInput);
    box.appendChild(el("label", { text: "可用模型（逗号分隔）" }));
    box.appendChild(el("input", { value: (p.models || []).join(", "), "data-key": `providers.${pid}.models` }));
    box.appendChild(el("label", { text: "默认模型" }));
    const defSel = el("select", { "data-key": `providers.${pid}.default_model` });
    for (const m of p.models || []) {
      const opt = el("option", { value: m, text: m });
      if (m === p.default_model) opt.selected = true;
      defSel.appendChild(opt);
    }
    box.appendChild(defSel);
    provBox.appendChild(box);
  }
  form.appendChild(provBox);

  // 价格
  const priceBox = el("div", { class: "card", style: "margin-bottom:14px" });
  priceBox.appendChild(el("h3", { text: "价格（元 / 百万 token）", style: "margin:0 0 4px;font-size:15px" }));
  priceBox.appendChild(el("div", { class: "muted", style: "margin-bottom:8px" }, "以下为示例价格，请以各家官网实时报价为准；成本统计按此计算。"));
  const pt = el("table", { class: "data" });
  pt.appendChild(el("thead", { html: "<tr><th>模型</th><th>输入</th><th>输出</th></tr>" }));
  const ptb = el("tbody");
  for (const [model, pr] of Object.entries(State.settings.pricing)) {
    const tr = el("tr");
    tr.appendChild(el("td", { text: model }));
    const tdIn = el("td");
    tdIn.appendChild(el("input", { type: "number", step: "0.1", value: pr.in, style: "width:90px", "data-pricing": model, "data-side": "in" }));
    tr.appendChild(tdIn);
    const tdOut = el("td");
    tdOut.appendChild(el("input", { type: "number", step: "0.1", value: pr.out, style: "width:90px", "data-pricing": model, "data-side": "out" }));
    tr.appendChild(tdOut);
    ptb.appendChild(tr);
  }
  pt.appendChild(ptb);
  priceBox.appendChild(pt);
  form.appendChild(priceBox);

  // 默认参数 + workbuddy
  const miscBox = el("div", { class: "card", style: "margin-bottom:14px" });
  miscBox.appendChild(el("h3", { text: "默认参数与外部工具", style: "margin:0 0 8px;font-size:15px" }));
  miscBox.appendChild(el("label", { text: "默认温度" }));
  miscBox.appendChild(el("input", { type: "number", step: "0.1", min: "0", max: "2", value: State.settings.defaults.temperature, "data-key": "defaults.temperature" }));
  miscBox.appendChild(el("label", { text: "默认最大输出 token" }));
  miscBox.appendChild(el("input", { type: "number", step: "128", value: State.settings.defaults.max_tokens, "data-key": "defaults.max_tokens" }));
  miscBox.appendChild(el("div", { style: "height:10px" }));
  miscBox.appendChild(el("label", { text: "workbuddy 适配器（预留）" }));
  const wb = State.settings.workbuddy || {};
  const wbRow = el("div", { class: "row" });
  const wbChk = el("input", { type: "checkbox", id: "wb-enabled", style: "width:auto" });
  if (wb.enabled) wbChk.checked = true;
  wbRow.appendChild(wbChk);
  wbRow.appendChild(el("label", { text: "启用外部 CLI 适配器", style: "margin:0" }));
  miscBox.appendChild(wbRow);
  miscBox.appendChild(el("label", { text: "命令模板（{prompt} 为任务内容占位符）" }));
  miscBox.appendChild(el("input", { value: wb.command_template || "", id: "wb-template" }));
  miscBox.appendChild(el("label", { text: "工作目录" }));
  miscBox.appendChild(el("input", { value: wb.workdir || "", id: "wb-workdir" }));
  miscBox.appendChild(el("div", { class: "field-hint", text: wb.note || "" }));
  form.appendChild(miscBox);

  // 豆包 Key 指引
  const guideBox = el("div", { class: "card", style: "margin-bottom:14px" });
  guideBox.appendChild(el("h3", { text: "豆包（火山方舟）API Key 申请指引", style: "margin:0 0 8px;font-size:15px" }));
  guideBox.appendChild(el("div", { class: "md", html: guideHtml() }));
  form.appendChild(guideBox);

  const saveRow = el("div", { class: "row", style: "margin-top:6px" });
  saveRow.appendChild(el("button", { class: "btn primary", text: "保存设置", id: "save-settings" }));
  saveRow.appendChild(el("span", { class: "muted", text: "保存后即时生效" }));
  form.appendChild(saveRow);

  view.appendChild(form);
  root.appendChild(view);

  view.querySelector("#save-settings").addEventListener("click", async () => {
    try {
      const s = JSON.parse(JSON.stringify(State.settings));
      // 提供商字段
      form.querySelectorAll("[data-key]").forEach((inp) => {
        const path = inp.getAttribute("data-key").split(".");
        let o = s;
        for (const k of path.slice(0, -1)) o = o[k];
        const last = path[path.length - 1];
        o[last] = last === "models" ? inp.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) : inp.value;
      });
      // 默认模型下拉同步
      form.querySelectorAll("select[data-key]").forEach((sel) => {
        const path = sel.getAttribute("data-key").split(".");
        let o = s;
        for (const k of path.slice(0, -1)) o = o[k];
        o[path[path.length - 1]] = sel.value;
      });
      // 价格
      form.querySelectorAll("[data-pricing]").forEach((inp) => {
        const m = inp.getAttribute("data-pricing");
        if (!s.pricing[m]) s.pricing[m] = { in: 0, out: 0 };
        s.pricing[m][inp.getAttribute("data-side")] = Number(inp.value) || 0;
      });
      // 默认参数
      s.defaults.temperature = Number(form.querySelector('[data-key="defaults.temperature"]').value) || 0.7;
      s.defaults.max_tokens = Number(form.querySelector('[data-key="defaults.max_tokens"]').value) || 4096;
      // workbuddy
      s.workbuddy.enabled = form.querySelector("#wb-enabled").checked;
      s.workbuddy.command_template = form.querySelector("#wb-template").value;
      s.workbuddy.workdir = form.querySelector("#wb-workdir").value;
      State.settings = await API.put("/api/settings", s);
      toast("设置已保存", "ok");
    } catch (e) {
      toast("保存失败：" + e.message, "err");
    }
  });
};

function guideHtml() {
  return `<ol>
    <li>打开火山引擎控制台并登录/注册：<code>https://console.volcengine.com</code>（未实名需先完成企业或个人实名认证）。</li>
    <li>进入「火山方舟」控制台：<code>https://console.volcengine.com/ark</code>。</li>
    <li>在「开通管理」中开通需要的模型（如 doubao-seed、doubao-1.5 系列），开通即可。</li>
    <li>左侧「API Key 管理」→「创建 API Key」，复制保存（只显示一次）。</li>
    <li>把 Key 粘贴到上方「火山方舟·豆包」的 API Key 栏，Base URL 保持 <code>https://ark.cn-beijing.volces.com/api/v3</code>，保存即可。</li>
    <li>模型名可直接填 <code>doubao-seed-1.6-flash</code>、<code>doubao-1.5-pro-32k</code> 等已开通模型；如使用接入点方式，可填 <code>ep-xxxx</code> 接入点 ID。</li>
  </ol>
  <p class="muted">其他提供商同理：DeepSeek（platform.deepseek.com）、通义千问（百炼 bailian.console.aliyun.com）、智谱（open.bigmodel.cn）、Kimi（platform.moonshot.cn）。</p>`;
}

/* ================= 弹窗编辑器 ================= */
function openAgentEditor(a) {
  const isNew = !a;
  a = a || { name: "", role: "", system_prompt: "", provider: "ark", model: "", temperature: 0.7, max_tokens: 4096, kind: "llm", cli_config: {}, workdir: "" };
  const modal = openModal(`<h3>${isNew ? "新建智能体" : "编辑智能体"}</h3>
    <label>名称</label><input id="ae-name" value="${esc(a.name)}">
    <label>角色描述（一句话）</label><input id="ae-role" value="${esc(a.role)}">
    <label>系统提示词（System Prompt）</label><textarea id="ae-prompt" style="min-height:100px">${esc(a.system_prompt)}</textarea>
    <div class="row">
      <div class="grow"><label>提供商</label><select id="ae-provider"></select></div>
      <div class="grow"><label>模型</label><input id="ae-model" list="model-list" value="${esc(a.model)}"><datalist id="model-list"></datalist></div>
    </div>
    <div class="row">
      <div class="grow"><label>温度</label><input id="ae-temp" type="number" step="0.1" min="0" max="2" value="${a.temperature}"></div>
      <div class="grow"><label>最大输出 token</label><input id="ae-max" type="number" step="128" value="${a.max_tokens}"></div>
    </div>
    <label>类型</label><select id="ae-kind">
      <option value="llm" ${a.kind !== "cli" ? "selected" : ""}>LLM 模型</option>
      <option value="cli" ${a.kind === "cli" ? "selected" : ""}>外部 CLI 工具（workbuddy）</option>
    </select>
    <div id="ae-cli-box" style="display:${a.kind === "cli" ? "block" : "none"}">
      <label>命令模板（{prompt} 占位符）</label><input id="ae-cmd" value="${esc((a.cli_config || {}).command_template || "")}">
      <label>工作目录</label><input id="ae-workdir" value="${esc(a.workdir || "")}">
    </div>
    <div class="row" style="margin-top:18px;justify-content:flex-end">
      <button class="btn" id="ae-cancel">取消</button>
      <button class="btn primary" id="ae-save">保存</button>
    </div>`);

  const provSel = modal.querySelector("#ae-provider");
  for (const [pid, p] of Object.entries(State.settings.providers)) {
    const opt = el("option", { value: pid, text: p.name });
    if (pid === a.provider) opt.selected = true;
    provSel.appendChild(opt);
  }
  function syncModels() {
    const p = State.settings.providers[provSel.value];
    const dl = modal.querySelector("#model-list");
    dl.innerHTML = "";
    for (const m of p?.models || []) dl.appendChild(el("option", { value: m }));
  }
  syncModels();
  provSel.addEventListener("change", syncModels);
  modal.querySelector("#ae-kind").addEventListener("change", (e) => {
    modal.querySelector("#ae-cli-box").style.display = e.target.value === "cli" ? "block" : "none";
  });

  modal.querySelector("#ae-cancel").addEventListener("click", closeModal);
  modal.querySelector("#ae-save").addEventListener("click", async () => {
    const body = {
      name: modal.querySelector("#ae-name").value.trim(),
      role: modal.querySelector("#ae-role").value.trim(),
      system_prompt: modal.querySelector("#ae-prompt").value,
      provider: provSel.value,
      model: modal.querySelector("#ae-model").value.trim(),
      temperature: Number(modal.querySelector("#ae-temp").value) || 0.7,
      max_tokens: Number(modal.querySelector("#ae-max").value) || 4096,
      kind: modal.querySelector("#ae-kind").value,
      cli_config: { command_template: modal.querySelector("#ae-cmd").value },
      workdir: modal.querySelector("#ae-workdir").value,
    };
    if (!body.name) { toast("名称不能为空", "err"); return; }
    if (body.kind === "cli" && !body.cli_config.command_template) { toast("CLI 类型需填写命令模板", "err"); return; }
    try {
      if (isNew) await API.post("/api/agents", body);
      else await API.put(`/api/agents/${a.id}`, body);
      State.agents = await API.get("/api/agents");
      closeModal();
      Views.agents(document.getElementById("view"));
      toast(isNew ? "智能体已创建" : "已保存", "ok");
    } catch (e) { toast("保存失败：" + e.message, "err"); }
  });
}

function openGroupEditor() {
  const modal = openModal(`<h3>新建群聊</h3>
    <label>群聊名称</label><input id="ge-title" placeholder="例如：新品上市策划">
    <label>主持人智能体</label><select id="ge-mod"></select>
    <label>参与成员</label><div id="ge-members"></div>
    <div class="row" style="margin-top:18px;justify-content:flex-end">
      <button class="btn" id="ge-cancel">取消</button>
      <button class="btn primary" id="ge-ok">创建</button>
    </div>`);
  const modSel = modal.querySelector("#ge-mod");
  for (const a of State.agents) modSel.appendChild(el("option", { value: a.id, text: a.name + "（" + a.role + "）" }));
  const membersBox = modal.querySelector("#ge-members");
  for (const a of State.agents) {
    const row = el("label", { style: "display:flex;gap:8px;align-items:center;margin:4px 0;font-size:13px" });
    row.appendChild(el("input", { type: "checkbox", value: a.id, style: "width:auto" }));
    row.appendChild(document.createTextNode(a.name));
    membersBox.appendChild(row);
  }
  modal.querySelector("#ge-cancel").addEventListener("click", closeModal);
  modal.querySelector("#ge-ok").addEventListener("click", async () => {
    const title = modal.querySelector("#ge-title").value.trim() || "新群聊";
    const mids = [...membersBox.querySelectorAll("input:checked")].map((c) => Number(c.value));
    if (mids.length < 1) { toast("请至少选择一名成员", "err"); return; }
    try {
      const g = await API.post("/api/groupchats", { title, moderator_id: Number(modSel.value), member_ids: mids });
      closeModal();
      State.currentGroupId = g.id;
      Views.group(document.getElementById("view"));
      toast("群聊已创建", "ok");
    } catch (e) { toast("创建失败：" + e.message, "err"); }
  });
}

function openGroupMembers(g) {
  const modal = openModal(`<h3>添加成员到「${esc(g.title)}」</h3>
    <div id="gm-list"></div>
    <div class="row" style="margin-top:18px;justify-content:flex-end">
      <button class="btn" id="gm-cancel">取消</button>
      <button class="btn primary" id="gm-ok">添加</button>
    </div>`);
  const listBox = modal.querySelector("#gm-list");
  const existing = new Set((g.members || []).map((m) => m.id));
  for (const a of State.agents) {
    if (existing.has(a.id)) continue;
    const row = el("label", { style: "display:flex;gap:8px;align-items:center;margin:4px 0;font-size:13px" });
    row.appendChild(el("input", { type: "checkbox", value: a.id, style: "width:auto" }));
    row.appendChild(document.createTextNode(a.name));
    listBox.appendChild(row);
  }
  if (!listBox.children.length) listBox.appendChild(el("div", { class: "muted" }, "没有可添加的智能体了。"));
  modal.querySelector("#gm-cancel").addEventListener("click", closeModal);
  modal.querySelector("#gm-ok").addEventListener("click", async () => {
    const ids = [...listBox.querySelectorAll("input:checked")].map((c) => Number(c.value));
    if (!ids.length) { closeModal(); return; }
    try {
      await API.post(`/api/groupchats/${g.id}/members`, { agent_ids: ids });
      closeModal();
      Views.group(document.getElementById("view"));
    } catch (e) { toast("添加失败：" + e.message, "err"); }
  });
}

function openRunEditor() {
  const modal = openModal(`<h3>新建自动执行</h3>
    <label>名称</label><input id="re-title" placeholder="例如：新品上线清单">
    <label>执行智能体</label><select id="re-agent"></select>
    <label>模式</label>
    <div class="row">
      <label style="margin:0;display:flex;gap:6px;align-items:center"><input type="radio" name="re-mode" value="checklist" checked style="width:auto"> 清单模式</label>
      <label style="margin:0;display:flex;gap:6px;align-items:center"><input type="radio" name="re-mode" value="goal" style="width:auto"> 目标模式</label>
    </div>
    <div id="re-goal-box" style="display:none"><label>目标描述</label><textarea id="re-goal"></textarea></div>
    <div id="re-items-box">
      <label>任务清单（标题 + 可选详情）</label>
      <div id="re-items"></div>
      <button class="btn sm" id="re-add">＋ 添加任务</button>
      <button class="btn sm" id="re-parse" title="粘贴 Markdown 清单自动解析">粘贴清单解析</button>
    </div>
    <div class="row" style="margin-top:18px;justify-content:flex-end">
      <button class="btn" id="re-cancel">取消</button>
      <button class="btn primary" id="re-ok">创建并执行</button>
    </div>`);
  const agentSel = modal.querySelector("#re-agent");
  for (const a of State.agents) agentSel.appendChild(el("option", { value: a.id, text: a.name }));

  function addItemRow(title = "", detail = "") {
    const box = el("div", { class: "item-box" });
    box.appendChild(el("input", { class: "re-title", placeholder: "任务标题", value: title }));
    box.appendChild(el("textarea", { class: "re-detail", placeholder: "任务详情（可选）", style: "min-height:40px;margin-top:6px", value: detail }));
    box.appendChild(el("button", { class: "btn sm danger", text: "移除", style: "margin-top:6px", onclick: () => box.remove() }));
    modal.querySelector("#re-items").appendChild(box);
  }
  addItemRow();
  addItemRow();

  modal.querySelector("input[value=checklist]").addEventListener("change", (e) => {
    modal.querySelector("#re-items-box").style.display = e.target.checked ? "block" : "none";
    modal.querySelector("#re-goal-box").style.display = e.target.checked ? "none" : "block";
  });
  modal.querySelector("input[value=goal]").addEventListener("change", (e) => {
    modal.querySelector("#re-items-box").style.display = e.target.checked ? "none" : "block";
    modal.querySelector("#re-goal-box").style.display = e.target.checked ? "block" : "none";
  });
  modal.querySelector("#re-add").addEventListener("click", () => addItemRow());
  modal.querySelector("#re-parse").addEventListener("click", () => {
    const pasted = prompt("粘贴 Markdown 清单（每行一条，支持：- 标题 / - 标题：详情）");
    if (!pasted) return;
    const box = modal.querySelector("#re-items");
    box.innerHTML = "";
    for (const line of pasted.split("\n")) {
      const l = line.replace(/^[-*\s]+/, "").trim();
      if (!l) continue;
      const idx = l.indexOf("：");
      if (idx > 0) addItemRow(l.slice(0, idx), l.slice(idx + 1));
      else addItemRow(l);
    }
  });

  modal.querySelector("#re-cancel").addEventListener("click", closeModal);
  modal.querySelector("#re-ok").addEventListener("click", async () => {
    const mode = modal.querySelector("input[name=re-mode]:checked").value;
    const title = modal.querySelector("#re-title").value.trim() || "自动执行";
    const body = { agent_id: Number(agentSel.value), title, mode };
    if (mode === "goal") {
      body.goal = modal.querySelector("#re-goal").value.trim();
      if (!body.goal) { toast("目标不能为空", "err"); return; }
    } else {
      const items = [...modal.querySelectorAll("#re-items .item-box")].map((b) => ({
        title: b.querySelector(".re-title").value.trim(), detail: b.querySelector(".re-detail").value.trim(),
      })).filter((i) => i.title);
      if (!items.length) { toast("至少填写一个任务标题", "err"); return; }
      body.items = items;
    }
    try {
      const r = await API.post("/api/autoruns", body);
      closeModal();
      State.currentRunId = r.id;
      if (location.hash !== "#/run") location.hash = "#/run";
      await Views.run(document.getElementById("view"));
      toast("任务已创建，可在右侧点击「开始执行」", "ok");
    } catch (e) { toast("创建失败：" + e.message, "err"); }
  });
}

function openShortcutHelp() {
  openModal(`<h3>快捷键与指令</h3>
    <table class="data">
      <tr><th>快捷键</th><th>功能</th></tr>
      <tr><td>Ctrl+J</td><td>切换深色 / 浅色主题</td></tr>
      <tr><td>Ctrl+[  /  Ctrl+]</td><td>切换侧栏板块</td></tr>
      <tr><td>Ctrl+Enter</td><td>发送消息</td></tr>
      <tr><td>/</td><td>聚焦输入框</td></tr>
      <tr><td>Esc</td><td>关闭弹窗</td></tr>
    </table>
    <div class="muted" style="margin-top:10px">聊天输入 /new 新对话，/help 查看本帮助。</div>`);
}

/* ================= 消息渲染 ================= */
function msgNode(role, content, opt) {
  opt = opt || {};
  const wrap = el("div", { class: "msg " + role + (opt.mention ? " mention" : "") });
  const who = el("div", { class: "who" });
  if (opt.mention) who.appendChild(el("span", { class: "tag", text: "征询" }));
  who.appendChild(el("span", { text: role === "user" ? "我" : "智能体" }));
  wrap.appendChild(who);
  const bubble = el("div", { class: "bubble" });
  if (content) bubble.appendChild(renderMd(content));
  wrap.appendChild(bubble);
  return wrap;
}
function appendChunk(node, delta) {
  node._raw = (node._raw || "") + delta;
  let bubble = node.querySelector(".bubble");
  if (!bubble) { bubble = el("div", { class: "bubble" }); node.appendChild(bubble); }
  bubble.innerHTML = "";
  bubble.appendChild(renderMd(node._raw));
  const scroll = node.closest(".chat-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}
function setUsage(node, data) {
  const meta = el("div", { class: "meta", text: `输入 ${fmtTokens(data.tokens_in)} · 输出 ${fmtTokens(data.tokens_out)} · ${fmtCost(data.cost)}` });
  node.appendChild(meta);
}
function groupMsgNode(m) {
  const role = m.role === "synthesis" ? "synthesis" : m.role === "user" ? "user" : "assistant";
  const wrap = el("div", { class: "msg " + role });
  const who = el("div", { class: "who" });
  who.appendChild(el("span", { text: m.role === "user" ? "我" : (m.sender || "成员") }));
  if (m.role === "synthesis") who.appendChild(el("span", { class: "tag", text: "总结" }));
  wrap.appendChild(who);
  const bubble = el("div", { class: "bubble" });
  bubble.appendChild(renderMd(m.content));
  wrap.appendChild(bubble);
  if (m.cost) wrap.appendChild(el("div", { class: "meta", text: fmtCost(m.cost) }));
  return wrap;
}
function stepNode(text, cls = "") {
  return el("div", { class: "step-line " + cls, text });
}
function statCard(k, v) {
  const c = el("div", { class: "stat-card" });
  c.appendChild(el("div", { class: "k", text: k }));
  c.appendChild(el("div", { class: "v", text: v }));
  return c;
}
