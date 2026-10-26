/* maestro-cn 应用骨架：路由、导航、主题、快捷键 */
(function () {
  const SECTIONS = ["agents", "group", "run", "playbooks", "usage", "settings"];

  function currentRoute() {
    const h = location.hash || "#/agents";
    const [path, query] = h.slice(1).split("?");
    const params = {};
    if (query) {
      for (const kv of query.split("&")) {
        const [k, v] = kv.split("=");
        if (k) params[k] = decodeURIComponent(v || "");
      }
    }
    return { section: (path.split("/")[1] || "agents"), params };
  }

  async function render() {
    const { section, params } = currentRoute();
    document.querySelectorAll(".nav-item").forEach((n) => {
      n.classList.toggle("active", n.dataset.section === section);
    });
    const view = document.getElementById("view");
    try {
      if (Views[section]) await Views[section](view, params);
      else await Views.agents(view);
    } catch (e) {
      view.innerHTML = `<div class="view"><div class="card" style="border-color:var(--err)">
        <b>加载失败</b><div class="muted" style="margin-top:6px">${esc(e.message)}</div>
        <button class="btn sm" style="margin-top:10px" onclick="location.reload()">刷新重试</button></div></div>`;
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("mc-theme", theme);
    const btn = document.getElementById("theme-btn");
    if (btn) btn.textContent = theme === "dark" ? "☾ 深色" : "☀ 浅色";
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("DOMContentLoaded", async () => {
    applyTheme(localStorage.getItem("mc-theme") || "dark");
    document.getElementById("theme-btn").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      applyTheme(cur === "dark" ? "light" : "dark");
    });
    // 全局快捷键
    window.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        const cur = document.documentElement.getAttribute("data-theme");
        applyTheme(cur === "dark" ? "light" : "dark");
      } else if ((e.ctrlKey || e.metaKey) && e.key === "[") {
        e.preventDefault(); switchSection(-1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === "]") {
        e.preventDefault(); switchSection(1);
      } else if (e.key === "/" && tag !== "TEXTAREA" && tag !== "INPUT") {
        e.preventDefault();
        const ta = document.querySelector(".chat-input-row textarea");
        if (ta) ta.focus();
      } else if (e.key === "Escape") {
        document.getElementById("modal-root").innerHTML = "";
      }
    });
    await render();
  });

  function switchSection(delta) {
    const idx = SECTIONS.indexOf(currentRoute().section);
    const next = SECTIONS[(idx + delta + SECTIONS.length) % SECTIONS.length];
    location.hash = "#/" + next;
  }

  // 页面卸载前如果有流式请求，无需特殊处理
})();
