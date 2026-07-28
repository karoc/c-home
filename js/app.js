(function () {
  "use strict";

  // ===== 常量 =====
  var STORAGE_KEY = "cHomeData";
  var DEFAULT_CATEGORY_ID = "default";
  var DEFAULT_CATEGORY_NAME = "默认";

  var CAT_ICON =
    '<svg class="cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>' +
    "</svg>";

  var EDIT_ICON =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
    '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>' +
    "</svg>";

  // ===== 状态 =====
  var state = {
    categories: [], // {id, name, order}
    sites: [],      // {id, name, url, categoryId, order}
    activeCategoryId: DEFAULT_CATEGORY_ID,
    search: "",
  };

  var editingSiteId = null;
  var editingCategoryId = null;
  var confirmCallback = null;

  // ===== DOM 引用 =====
  var $ = function (id) { return document.getElementById(id); };
  var categoryListEl = $("categoryList");
  var sitesGridEl = $("sitesGrid");
  var mainTitleEl = $("mainTitle");
  var emptyStateEl = $("emptyState");
  var searchInputEl = $("searchInput");

  // ===== 工具函数 =====
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeUrl(url) {
    url = (url || "").trim();
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    return url;
  }

  function hostnameOf(url) {
    try {
      return new URL(normalizeUrl(url)).hostname;
    } catch (e) {
      return "";
    }
  }

  function displayHost(url) {
    var host = hostnameOf(url);
    return host.replace(/^www\./, "");
  }

  // 站点默认图标：优先用站点真实 favicon，失败回退到字母头像
  function faviconUrl(url, size) {
    // 64px 已足够覆盖 56px 卡片图标 + 2x 屏，体积比 128px 小很多
    size = size || 64;
    var host = hostnameOf(url);
    if (!host) return "";
    return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(host) + "&sz=" + size;
  }

  var AVATAR_COLORS = [
    "#4f46e5", "#7c3aed", "#db2777", "#ea580c",
    "#059669", "#0891b2", "#dc2626", "#2563eb"
  ];

  function letterAvatar(name) {
    var letter = (((name || "").trim())[0] || "?").toUpperCase();
    var code = name ? name.charCodeAt(0) : 0;
    var color = AVATAR_COLORS[code % AVATAR_COLORS.length];
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">' +
      '<rect width="128" height="128" rx="30" fill="' + color + '"/>' +
      '<text x="50%" y="50%" dy=".35em" font-size="60" ' +
      'font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-weight="600" fill="#fff" text-anchor="middle">' +
      escapeXml(letter) + "</text></svg>";
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, function (c) {
      return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c];
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function pad(n) {
    return n < 10 ? "0" + n : n;
  }

  // ===== 时间问候 =====
  function updateClock() {
    var now = new Date();
    var hours = pad(now.getHours());
    var minutes = pad(now.getMinutes());
    var clockEl = $("clock");
    if (clockEl) clockEl.textContent = hours + ":" + minutes;
  }

  function updateGreeting() {
    var now = new Date();
    var hour = now.getHours();
    var greeting = "你好";
    if (hour < 6) greeting = "夜深了";
    else if (hour < 11) greeting = "早上好";
    else if (hour < 14) greeting = "中午好";
    else if (hour < 18) greeting = "下午好";
    else greeting = "晚上好";

    var greetingEl = $("greeting");
    if (greetingEl) greetingEl.textContent = greeting;

    var options = { year: "numeric", month: "long", day: "numeric", weekday: "long" };
    var dateLineEl = $("dateLine");
    if (dateLineEl) dateLineEl.textContent = now.toLocaleDateString("zh-CN", options);
  }

  function startClock() {
    updateClock();
    updateGreeting();
    setInterval(function () {
      updateClock();
      var now = new Date();
      if (now.getSeconds() === 0) updateGreeting();
    }, 1000);
  }

  // ===== 存储 =====
  function loadState() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEY, function (res) {
        var data = res[STORAGE_KEY];
        if (data && data.categories) {
          state.categories = data.categories;
          state.sites = data.sites || [];
          state.activeCategoryId = data.activeCategoryId || DEFAULT_CATEGORY_ID;
        } else {
          // 初始化默认分类
          state.categories = [{ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME, order: 0 }];
          state.sites = [];
          state.activeCategoryId = DEFAULT_CATEGORY_ID;
          saveState();
        }
        resolve();
      });
    });
  }

  function saveState() {
    return new Promise(function (resolve) {
      var data = {};
      data[STORAGE_KEY] = {
        categories: state.categories,
        sites: state.sites,
        activeCategoryId: state.activeCategoryId,
      };
      chrome.storage.local.set(data, function () { resolve(); });
    });
  }

  // ===== 查询辅助 =====
  function sortedCategories() {
    return state.categories.slice().sort(function (a, b) { return a.order - b.order; });
  }

  function sitesByCategory(catId) {
    return state.sites
      .filter(function (s) { return s.categoryId === catId; })
      .sort(function (a, b) { return a.order - b.order; });
  }

  function categoryById(id) {
    return state.categories.filter(function (c) { return c.id === id; })[0] || null;
  }

  function siteById(id) {
    return state.sites.filter(function (s) { return s.id === id; })[0] || null;
  }

  function nextOrder(arr) {
    return arr.reduce(function (m, x) { return Math.max(m, x.order); }, -1) + 1;
  }

  // ===== 渲染：分类侧边栏 =====
  function renderCategories() {
    var cats = sortedCategories();
    var html = cats.map(function (c) {
      var count = state.sites.filter(function (s) { return s.categoryId === c.id; }).length;
      var isActive = c.id === state.activeCategoryId;
      var isDefault = c.id === DEFAULT_CATEGORY_ID;
      var actions =
        '<button class="cat-edit" title="重命名" data-action="rename-category" data-id="' + c.id + '">' + EDIT_ICON + "</button>" +
        (isDefault
          ? ""
          : '<button class="cat-del" title="删除" data-action="delete-category" data-id="' + c.id + '">×</button>');
      return (
        '<li class="category-item' + (isActive ? " active" : "") + '" ' +
        'draggable="true" data-id="' + c.id + '" data-action="select-category">' +
        '<span class="cat-grip">⋮⋮</span>' +
        CAT_ICON +
        '<span class="cat-name">' + escapeHtml(c.name) + "</span>" +
        '<span class="cat-count">' + count + "</span>" +
        '<span class="cat-actions">' + actions + "</span>" +
        "</li>"
      );
    }).join("");
    categoryListEl.innerHTML = html;
  }

  // ===== 渲染：站点网格 =====
  function renderSites() {
    var activeCat = categoryById(state.activeCategoryId) || categoryById(DEFAULT_CATEGORY_ID);
    if (activeCat) state.activeCategoryId = activeCat.id;
    mainTitleEl.textContent = activeCat ? activeCat.name : "全部站点";

    var sites = activeCat ? sitesByCategory(activeCat.id) : [];
    var kw = state.search.trim().toLowerCase();
    if (kw) {
      sites = sites.filter(function (s) {
        return s.name.toLowerCase().indexOf(kw) !== -1 || s.url.toLowerCase().indexOf(kw) !== -1;
      });
    }

    if (sites.length === 0) {
      sitesGridEl.innerHTML = "";
      emptyStateEl.hidden = false;
      return;
    }
    emptyStateEl.hidden = true;

    sitesGridEl.innerHTML = sites.map(function (s) {
      var icon = faviconUrl(s.url);
      var fallback = letterAvatar(s.name);
      var host = displayHost(s.url);
      return (
        '<a class="site-card" draggable="true" data-id="' + s.id + '" href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<div class="site-actions">' +
        '<button title="编辑" data-action="edit-site" data-id="' + s.id + '">' + EDIT_ICON + "</button>" +
        '<button title="删除" data-action="delete-site" data-id="' + s.id + '">×</button>' +
        "</div>" +
        // 先用本地生成的字母头像占位，避免等待 favicon 时出现空白
        '<img class="site-icon" src="' + escapeHtml(fallback) + '" alt="" ' +
        'data-icon="' + escapeHtml(icon) + '" data-fallback="' + escapeHtml(fallback) + '" />' +
        '<span class="site-name">' + escapeHtml(s.name) + "</span>" +
        (host ? '<span class="site-url">' + escapeHtml(host) + "</span>" : "") +
        "</a>"
      );
    }).join("");

    // 后台加载真实 favicon，加载完成后再替换占位图
    loadFavicons();
  }

  // 后台加载 favicon 并替换占位图
  function loadFavicons() {
    var imgs = sitesGridEl.querySelectorAll(".site-icon[data-icon]");
    imgs.forEach(function (img) {
      var iconUrl = img.dataset.icon;
      if (!iconUrl) {
        img.removeAttribute("data-icon");
        return;
      }
      var loader = new Image();
      loader.onload = function () {
        img.src = iconUrl;
        img.removeAttribute("data-icon");
      };
      loader.onerror = function () {
        // 保持字母头像，清理 data-icon 避免重复尝试
        img.removeAttribute("data-icon");
      };
      loader.src = iconUrl;
    });
  }

  function renderAll() {
    renderCategories();
    renderSites();
    renderCategoryOptions();
  }

  function renderCategoryOptions() {
    var sel = $("siteCategory");
    sel.innerHTML = sortedCategories().map(function (c) {
      var selAttr = c.id === state.activeCategoryId ? " selected" : "";
      return '<option value="' + c.id + '"' + selAttr + ">" + escapeHtml(c.name) + "</option>";
    }).join("");
  }

  // ===== 分类操作 =====
  function openCategoryModal(mode, id) {
    editingCategoryId = id || null;
    $("categoryModalTitle").textContent = mode === "rename" ? "重命名分类" : "新建分类";
    $("categoryName").value = mode === "rename" && id ? (categoryById(id) || {}).name || "" : "";
    $("categoryModal").hidden = false;
    setTimeout(function () { $("categoryName").focus(); }, 30);
  }

  function closeCategoryModal() {
    $("categoryModal").hidden = true;
    editingCategoryId = null;
  }

  function submitCategory(e) {
    e.preventDefault();
    var name = $("categoryName").value.trim();
    if (!name) return;
    if (editingCategoryId) {
      var cat = categoryById(editingCategoryId);
      if (cat) cat.name = name;
    } else {
      state.categories.push({ id: uid(), name: name, order: nextOrder(state.categories) });
    }
    closeCategoryModal();
    saveState().then(renderAll);
  }

  function deleteCategory(id) {
    if (id === DEFAULT_CATEGORY_ID) return;
    var cat = categoryById(id);
    if (!cat) return;
    var count = state.sites.filter(function (s) { return s.categoryId === id; }).length;
    var msg = "确认删除分类「" + cat.name + "」？";
    if (count > 0) msg += "\n其中 " + count + " 个站点将移动到「" + DEFAULT_CATEGORY_NAME + "」。";
    showConfirm(msg, function () {
      // 站点迁移到默认分类
      state.sites.forEach(function (s) {
        if (s.categoryId === id) s.categoryId = DEFAULT_CATEGORY_ID;
      });
      state.categories = state.categories.filter(function (c) { return c.id !== id; });
      if (state.activeCategoryId === id) state.activeCategoryId = DEFAULT_CATEGORY_ID;
      saveState().then(renderAll);
    });
  }

  function selectCategory(id) {
    state.activeCategoryId = id;
    state.search = "";
    searchInputEl.value = "";
    saveState().then(renderAll);
  }

  // ===== 站点操作 =====
  function openSiteModal(mode, id) {
    editingSiteId = id || null;
    $("siteModalTitle").textContent = mode === "edit" ? "编辑站点" : "添加站点";
    renderCategoryOptions();
    if (mode === "edit" && id) {
      var s = siteById(id);
      if (s) {
        $("siteName").value = s.name;
        $("siteUrl").value = s.url;
        $("siteCategory").value = s.categoryId;
      }
    } else {
      $("siteName").value = "";
      $("siteUrl").value = "";
      $("siteCategory").value = state.activeCategoryId;
    }
    updatePreview();
    $("siteModal").hidden = false;
    setTimeout(function () { $("siteName").focus(); }, 30);
  }

  function closeSiteModal() {
    $("siteModal").hidden = true;
    editingSiteId = null;
  }

  function submitSite(e) {
    e.preventDefault();
    var name = $("siteName").value.trim();
    var rawUrl = $("siteUrl").value.trim();
    var categoryId = $("siteCategory").value;
    if (!name || !rawUrl) return;
    var url = normalizeUrl(rawUrl);

    if (editingSiteId) {
      var s = siteById(editingSiteId);
      if (s) {
        s.name = name;
        s.url = url;
        s.categoryId = categoryId;
      }
    } else {
      state.sites.push({
        id: uid(),
        name: name,
        url: url,
        categoryId: categoryId,
        order: nextOrder(state.sites.filter(function (x) { return x.categoryId === categoryId; })),
      });
    }
    closeSiteModal();
    if (categoryId !== state.activeCategoryId) state.activeCategoryId = categoryId;
    saveState().then(renderAll);
  }

  function deleteSite(id) {
    var s = siteById(id);
    if (!s) return;
    showConfirm("确认删除站点「" + s.name + "」？", function () {
      state.sites = state.sites.filter(function (x) { return x.id !== id; });
      saveState().then(renderAll);
    });
  }

  function updatePreview() {
    var name = $("siteName").value.trim() || "站点名称";
    var url = $("siteUrl").value.trim();
    $("previewName").textContent = name;
    var img = $("previewIcon");
    var fallback = letterAvatar(name);
    if (url) {
      // 弹窗预览同样先显示占位图，再异步加载 favicon
      img.src = fallback;
      var src = faviconUrl(url);
      var loader = new Image();
      loader.onload = function () { img.src = src; };
      loader.onerror = function () { img.src = fallback; };
      loader.src = src;
    } else {
      img.src = fallback;
    }
  }

  // ===== 确认弹窗 =====
  function showConfirm(text, callback) {
    $("confirmText").textContent = text;
    confirmCallback = callback;
    $("confirmModal").hidden = false;
  }

  function closeConfirm() {
    $("confirmModal").hidden = true;
    confirmCallback = null;
  }

  // ===== 拖拽排序：站点 =====
  var dragSiteId = null;

  function bindSiteDrag() {
    // 图标加载失败回退到字母头像（捕获阶段，error 不冒泡；CSP 禁止内联 onerror）
    sitesGridEl.addEventListener("error", function (e) {
      var img = e.target;
      if (!img || img.tagName !== "IMG" || !img.dataset.fallback || img.dataset.failed) return;
      img.dataset.failed = "1";
      img.src = img.dataset.fallback;
    }, true);

    sitesGridEl.addEventListener("dragstart", function (e) {
      var card = e.target.closest(".site-card");
      if (!card) return;
      dragSiteId = card.getAttribute("data-id");
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      // 阻止 <a> 默认拖拽行为
      e.dataTransfer.setData("text/plain", dragSiteId);
    });

    sitesGridEl.addEventListener("dragend", function (e) {
      var card = e.target.closest(".site-card");
      if (card) card.classList.remove("dragging");
      document.querySelectorAll(".site-card.drag-over").forEach(function (el) {
        el.classList.remove("drag-over");
      });
      dragSiteId = null;
    });

    sitesGridEl.addEventListener("dragover", function (e) {
      e.preventDefault();
      var card = e.target.closest(".site-card");
      if (!card || card.getAttribute("data-id") === dragSiteId) return;
      document.querySelectorAll(".site-card.drag-over").forEach(function (el) {
        el.classList.remove("drag-over");
      });
      card.classList.add("drag-over");
      e.dataTransfer.dropEffect = "move";
    });

    sitesGridEl.addEventListener("dragleave", function (e) {
      var card = e.target.closest(".site-card");
      if (card) card.classList.remove("drag-over");
    });

    sitesGridEl.addEventListener("drop", function (e) {
      e.preventDefault();
      var card = e.target.closest(".site-card");
      if (!card || !dragSiteId) return;
      var targetId = card.getAttribute("data-id");
      if (targetId === dragSiteId) return;
      reorderSites(dragSiteId, targetId);
    });
  }

  function reorderSites(fromId, toId) {
    var catId = state.activeCategoryId;
    var sites = sitesByCategory(catId);
    var fromIdx = -1, toIdx = -1;
    sites.forEach(function (s, i) {
      if (s.id === fromId) fromIdx = i;
      if (s.id === toId) toIdx = i;
    });
    if (fromIdx === -1 || toIdx === -1) return;
    var moved = sites.splice(fromIdx, 1)[0];
    sites.splice(toIdx, 0, moved);
    // 重新分配 order
    sites.forEach(function (s, i) { s.order = i; });
    saveState().then(renderSites);
  }

  // ===== 拖拽排序：分类 =====
  var dragCatId = null;

  function bindCategoryDrag() {
    categoryListEl.addEventListener("dragstart", function (e) {
      var item = e.target.closest(".category-item");
      if (!item) return;
      dragCatId = item.getAttribute("data-id");
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragCatId);
    });

    categoryListEl.addEventListener("dragend", function (e) {
      var item = e.target.closest(".category-item");
      if (item) item.classList.remove("dragging");
      dragCatId = null;
    });

    categoryListEl.addEventListener("dragover", function (e) {
      e.preventDefault();
      var item = e.target.closest(".category-item");
      if (!item || item.getAttribute("data-id") === dragCatId) return;
      e.dataTransfer.dropEffect = "move";
    });

    categoryListEl.addEventListener("drop", function (e) {
      e.preventDefault();
      var item = e.target.closest(".category-item");
      if (!item || !dragCatId) return;
      var targetId = item.getAttribute("data-id");
      if (targetId === dragCatId) return;
      var rect = item.getBoundingClientRect();
      var after = e.clientY > rect.top + rect.height / 2;
      reorderCategories(dragCatId, targetId, after);
    });
  }

  function reorderCategories(fromId, toId, after) {
    var cats = sortedCategories();
    var fromIdx = -1, toIdx = -1;
    cats.forEach(function (c, i) {
      if (c.id === fromId) fromIdx = i;
      if (c.id === toId) toIdx = i;
    });
    if (fromIdx === -1 || toIdx === -1) return;
    var moved = cats.splice(fromIdx, 1)[0];
    // 移除后目标索引可能变化
    if (fromIdx < toIdx) toIdx -= 1;
    if (after) toIdx += 1;
    cats.splice(toIdx, 0, moved);
    cats.forEach(function (c, i) { c.order = i; });
    saveState().then(renderAll);
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    // 顶部按钮
    $("addSiteBtn").addEventListener("click", function () { openSiteModal("add"); });
    $("addCategoryBtn").addEventListener("click", function () { openCategoryModal("add"); });

    // 搜索
    searchInputEl.addEventListener("input", function () {
      state.search = searchInputEl.value;
      renderSites();
    });

    // 全局点击委托
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-action]");
      if (!t) return;
      var action = t.getAttribute("data-action");
      var id = t.getAttribute("data-id");

      switch (action) {
        case "select-category":
          // 点击分类项本体（非操作按钮）
          if (e.target.closest(".cat-actions")) return;
          selectCategory(id);
          break;
        case "rename-category":
          e.preventDefault();
          e.stopPropagation();
          openCategoryModal("rename", id);
          break;
        case "delete-category":
          e.preventDefault();
          e.stopPropagation();
          deleteCategory(id);
          break;
        case "edit-site":
          e.preventDefault();
          e.stopPropagation();
          openSiteModal("edit", id);
          break;
        case "delete-site":
          e.preventDefault();
          e.stopPropagation();
          deleteSite(id);
          break;
        case "close-site-modal":
          closeSiteModal();
          break;
        case "close-category-modal":
          closeCategoryModal();
          break;
        case "empty-add":
          openSiteModal("add");
          break;
      }
    });

    // 弹窗表单
    $("siteForm").addEventListener("submit", submitSite);
    $("categoryForm").addEventListener("submit", submitCategory);
    $("siteName").addEventListener("input", updatePreview);
    $("siteUrl").addEventListener("input", updatePreview);

    // 点遮罩关闭弹窗
    ["siteModal", "categoryModal", "confirmModal"].forEach(function (mid) {
      $(mid).addEventListener("click", function (e) {
        if (e.target === $(mid)) {
          if (mid === "confirmModal") closeConfirm();
          else if (mid === "siteModal") closeSiteModal();
          else closeCategoryModal();
        }
      });
    });

    // 确认弹窗按钮
    $("confirmOk").addEventListener("click", function () {
      var cb = confirmCallback;
      closeConfirm();
      if (cb) cb();
    });
    $("confirmCancel").addEventListener("click", closeConfirm);

    // ESC 关闭弹窗
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!$("confirmModal").hidden) { closeConfirm(); return; }
        if (!$("siteModal").hidden) closeSiteModal();
        if (!$("categoryModal").hidden) closeCategoryModal();
      }
    });

    // 拖拽
    bindSiteDrag();
    bindCategoryDrag();
  }

  // ===== 初始化 =====
  loadState().then(function () {
    bindEvents();
    startClock();
    renderAll();
  });
})();
