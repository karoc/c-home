(function () {
  "use strict";

  // ===== 常量 =====
  var STORAGE_KEY = "cHomeData";
  var SETTINGS_KEY = "cHomeSettings";
  var DEFAULT_CATEGORY_ID = "default";
  var DEFAULT_CATEGORY_NAME = "默认";
  var DEFAULT_BACKUP_PATH = "c-home-backup.json";
  var VERSION = "1.1.0";

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
    settings: {
      autoBackupEnabled: false,
      autoBackupPath: DEFAULT_BACKUP_PATH,
      autoBackupMode: "onChange", // onChange | interval | daily
      autoBackupInterval: 30,     // 分钟
      autoBackupTime: "14:00",    // HH:MM
      lastBackupAt: null,
      storageMode: "local",       // local | sync | both
    },
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
  function readFrom(area, key) {
    return new Promise(function (resolve) {
      chrome.storage[area].get(key, function (res) { resolve(res[key]); });
    });
  }

  function writeTo(area, key, value) {
    return new Promise(function (resolve) {
      var data = {};
      data[key] = value;
      chrome.storage[area].set(data, function () { resolve(); });
    });
  }

  function applySettings(settings) {
    if (!settings) return;
    state.settings.autoBackupEnabled = !!settings.autoBackupEnabled;
    state.settings.autoBackupPath = settings.autoBackupPath || DEFAULT_BACKUP_PATH;
    state.settings.autoBackupMode = ["onChange", "interval", "daily"].indexOf(settings.autoBackupMode) !== -1 ? settings.autoBackupMode : "onChange";
    state.settings.autoBackupInterval = Math.max(1, parseInt(settings.autoBackupInterval, 10) || 30);
    state.settings.autoBackupTime = /^\d{2}:\d{2}$/.test(settings.autoBackupTime || "") ? settings.autoBackupTime : "14:00";
    state.settings.lastBackupAt = settings.lastBackupAt || null;
    state.settings.storageMode = ["local", "sync", "both"].indexOf(settings.storageMode) !== -1 ? settings.storageMode : "local";
  }

  function applyData(data) {
    if (!data || !data.categories) return false;
    state.categories = data.categories;
    state.sites = data.sites || [];
    state.activeCategoryId = data.activeCategoryId || DEFAULT_CATEGORY_ID;
    return true;
  }

  function initDefaultData() {
    state.categories = [{ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME, order: 0 }];
    state.sites = [];
    state.activeCategoryId = DEFAULT_CATEGORY_ID;
    saveState({ backup: false });
  }

  function loadState() {
    return new Promise(function (resolve) {
      // 先读本地设置，确定存储模式
      readFrom("local", SETTINGS_KEY).then(function (settings) {
        applySettings(settings);
        return loadData();
      }).then(resolve);
    });
  }

  function loadData() {
    return new Promise(function (resolve) {
      var mode = state.settings.storageMode;

      if (mode === "local") {
        readFrom("local", STORAGE_KEY).then(function (data) {
          if (applyData(data)) resolve();
          else { initDefaultData(); resolve(); }
        });
        return;
      }

      if (mode === "sync") {
        readFrom("sync", STORAGE_KEY).then(function (data) {
          if (applyData(data)) resolve();
          else { initDefaultData(); resolve(); }
        });
        return;
      }

      // both 模式：优先 sync，sync 为空则回退 local，并互相补全
      readFrom("sync", STORAGE_KEY).then(function (syncData) {
        if (syncData && syncData.categories) {
          applyData(syncData);
          // 顺便把 sync 数据写到 local，保持双份一致
          writeTo("local", STORAGE_KEY, syncData).then(resolve);
        } else {
          readFrom("local", STORAGE_KEY).then(function (localData) {
            if (localData && localData.categories) {
              applyData(localData);
              // local 有数据而 sync 没有，把 local 同步到 sync
              writeTo("sync", STORAGE_KEY, localData).then(resolve);
            } else {
              initDefaultData();
              resolve();
            }
          });
        }
      });
    });
  }

  function saveState(options) {
    options = options || {};
    var data = {
      categories: state.categories,
      sites: state.sites,
      activeCategoryId: state.activeCategoryId,
    };
    var mode = state.settings.storageMode;
    var promises = [];

    if (mode === "local" || mode === "both") {
      promises.push(writeTo("local", STORAGE_KEY, data));
    }
    if (mode === "sync" || mode === "both") {
      promises.push(writeTo("sync", STORAGE_KEY, data));
    }

    return Promise.all(promises).then(function () {
      if (options.backup !== false) autoBackup();
    });
  }

  function saveSettings() {
    var data = {
      autoBackupEnabled: state.settings.autoBackupEnabled,
      autoBackupPath: state.settings.autoBackupPath,
      autoBackupMode: state.settings.autoBackupMode,
      autoBackupInterval: state.settings.autoBackupInterval,
      autoBackupTime: state.settings.autoBackupTime,
      lastBackupAt: state.settings.lastBackupAt,
      storageMode: state.settings.storageMode,
    };
    return writeTo("local", SETTINGS_KEY, data);
  }

  function storageModeLabel(mode) {
    if (mode === "local") return "本地存储";
    if (mode === "sync") return "同步存储";
    return "本地 + 同步";
  }

  function migrateStorage(oldMode, newMode) {
    // 切换时把当前内存数据按新模式写一份，实现迁移
    return saveState({ backup: false });
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

  // ===== 自定义浮层提示 =====
  var tooltipEl = null;

  function initTooltip() {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "tooltip";
    tooltipEl.hidden = true;
    document.body.appendChild(tooltipEl);
  }

  function showTooltip(target, title, url) {
    if (!tooltipEl) return;
    tooltipEl.innerHTML =
      '<div class="tooltip-title">' + escapeHtml(title) + "</div>" +
      (url ? '<div class="tooltip-url">' + escapeHtml(url) + "</div>" : "");
    tooltipEl.hidden = false;

    // 先让浏览器排版以获取尺寸
    void tooltipEl.offsetWidth;

    var rect = target.getBoundingClientRect();
    var ttRect = tooltipEl.getBoundingClientRect();
    var gap = 10;

    // 默认在目标上方居中
    var left = rect.left + rect.width / 2 - ttRect.width / 2;
    var top = rect.top - ttRect.height - gap;

    // 贴边修正
    left = Math.max(gap, Math.min(left, window.innerWidth - ttRect.width - gap));
    // 上方空间不足时放到下方
    if (top < gap) {
      top = rect.bottom + gap;
      tooltipEl.classList.add("below");
    } else {
      tooltipEl.classList.remove("below");
    }

    tooltipEl.style.left = left + "px";
    tooltipEl.style.top = top + "px";
    tooltipEl.classList.add("visible");
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.remove("visible");
    setTimeout(function () {
      if (!tooltipEl.classList.contains("visible")) tooltipEl.hidden = true;
    }, 200);
  }

  function attachSiteTooltips() {
    sitesGridEl.querySelectorAll(".site-card").forEach(function (card) {
      card.addEventListener("mouseenter", function () {
        var id = card.getAttribute("data-id");
        var s = siteById(id);
        if (s) showTooltip(card, s.name, s.url);
      });
      card.addEventListener("mouseleave", hideTooltip);
    });
  }

  function attachCategoryTooltips() {
    categoryListEl.querySelectorAll(".category-item").forEach(function (item) {
      item.addEventListener("mouseenter", function () {
        var id = item.getAttribute("data-id");
        var cat = categoryById(id);
        if (cat) showTooltip(item, cat.name, "");
      });
      item.addEventListener("mouseleave", hideTooltip);
    });
  }

  // ===== 渲染：分类侧边栏 =====
  function renderCategories() {
    var cats = sortedCategories();
    var html = cats.map(function (c) {
      var count = state.sites.filter(function (s) { return s.categoryId === c.id; }).length;
      var isActive = c.id === state.activeCategoryId;
      var isDefault = c.id === DEFAULT_CATEGORY_ID;
      var actions =
        '<button class="cat-edit" aria-label="重命名" data-action="rename-category" data-id="' + c.id + '">' + EDIT_ICON + "</button>" +
        (isDefault
          ? ""
          : '<button class="cat-del" aria-label="删除" data-action="delete-category" data-id="' + c.id + '">×</button>');
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
    attachCategoryTooltips();
  }

  // ===== 渲染：站点网格 =====
  function renderSites() {
    // 拖拽过程中不要重绘，避免破坏占位符与原卡片
    if (dragSiteId) return;

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
        '<div class="site-card" draggable="true" role="link" tabindex="0" data-id="' + s.id + '" data-url="' + escapeHtml(s.url) + '">' +
        '<div class="site-actions">' +
        '<button aria-label="编辑" data-action="edit-site" data-id="' + s.id + '">' + EDIT_ICON + "</button>" +
        '<button aria-label="删除" data-action="delete-site" data-id="' + s.id + '">×</button>' +
        "</div>" +
        // 先用本地生成的字母头像占位，避免等待 favicon 时出现空白
        '<img class="site-icon" src="' + escapeHtml(fallback) + '" alt="" ' +
        'data-icon="' + escapeHtml(icon) + '" data-fallback="' + escapeHtml(fallback) + '" />' +
        '<span class="site-name">' + escapeHtml(s.name) + "</span>" +
        (host ? '<span class="site-url">' + escapeHtml(host) + "</span>" : "") +
        "</div>"
      );
    }).join("");

    // 后台加载真实 favicon，加载完成后再替换占位图
    loadFavicons();
    attachSiteTooltips();
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
    saveState({ backup: false }).then(renderAll);
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
    resetConfirmModal();
    $("confirmText").textContent = text;
    confirmCallback = callback;
    $("confirmModal").hidden = false;
  }

  function showAlert(text, callback) {
    resetConfirmModal();
    $("confirmText").textContent = text;
    confirmCallback = callback || function () {};
    $("confirmCancel").hidden = true;
    $("confirmOk").textContent = "知道了";
    $("confirmOk").classList.remove("danger");
    $("confirmOk").classList.add("primary");
    $("confirmModal").hidden = false;
  }

  function resetConfirmModal() {
    $("confirmCancel").hidden = false;
    $("confirmOk").textContent = "确认";
    $("confirmOk").classList.remove("primary");
    $("confirmOk").classList.add("danger");
  }

  function closeConfirm() {
    $("confirmModal").hidden = true;
    confirmCallback = null;
    resetConfirmModal();
  }

  // ===== 设置与数据备份 =====
  function openSettingsModal() {
    $("versionBadge").textContent = "v" + VERSION;
    $("autoBackupEnabled").checked = state.settings.autoBackupEnabled;
    $("autoBackupPath").value = state.settings.autoBackupPath;
    $("autoBackupMode").value = state.settings.autoBackupMode;
    $("autoBackupInterval").value = state.settings.autoBackupInterval;
    $("autoBackupTime").value = state.settings.autoBackupTime;
    updateBackupOptionsVisibility();
    updateLastBackupInfo();
    updateStorageModeUI();
    $("settingsModal").hidden = false;
  }

  function updateStorageModeUI() {
    var mode = state.settings.storageMode;
    var radios = document.querySelectorAll('input[name="storageMode"]');
    radios.forEach(function (radio) { radio.checked = radio.value === mode; });

    var hint = $("storageHint");
    if (mode === "local") {
      hint.textContent = "数据仅保存在本机，可通过导入/导出功能迁移数据；移除扩展或换设备前请先导出备份。";
    } else if (mode === "sync") {
      hint.textContent = "数据会同步到所有登录同一 Google 账号的 Chrome。注意容量限制约 100KB。";
    } else {
      hint.textContent = "同时写入本地和同步存储，优先从同步读取；换设备可同步，本机也保留一份副本。";
    }
  }

  function updateBackupOptionsVisibility() {
    var mode = $("autoBackupMode").value;
    $("intervalOption").classList.toggle("visible", mode === "interval");
    $("dailyOption").classList.toggle("visible", mode === "daily");
  }

  function updateLastBackupInfo() {
    var el = $("lastBackupInfo");
    if (!state.settings.lastBackupAt) {
      el.textContent = "尚未自动备份";
      return;
    }
    var date = new Date(state.settings.lastBackupAt);
    el.textContent = "上次自动备份：" + date.toLocaleString("zh-CN");
  }

  function closeSettingsModal() {
    $("settingsModal").hidden = true;
  }

  function buildExportData() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      categories: state.categories,
      sites: state.sites,
      activeCategoryId: state.activeCategoryId,
    };
  }

  function exportData() {
    var payload = buildExportData();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var filename = "c-home-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true,
    }, function () {
      URL.revokeObjectURL(url);
    });
  }

  function importData(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var payload = JSON.parse(e.target.result);
        if (!Array.isArray(payload.categories) || !Array.isArray(payload.sites)) {
          throw new Error("备份文件格式不正确");
        }
        showConfirm("导入将覆盖当前所有分类和站点，是否继续？", function () {
          state.categories = payload.categories;
          state.sites = payload.sites;
          state.activeCategoryId = payload.activeCategoryId || DEFAULT_CATEGORY_ID;
          // 确保至少有一个默认分类
          if (!categoryById(DEFAULT_CATEGORY_ID)) {
            state.categories.push({ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME, order: nextOrder(state.categories) });
          }
          saveState().then(function () {
            renderAll();
            closeSettingsModal();
            showAlert("导入成功，数据已恢复。", function () {});
          });
        });
      } catch (err) {
        showAlert(
          "导入失败：无法识别该文件。\n\n可能原因：\n" +
          "1. 选择的不是 C-Home 导出的 JSON 备份文件\n" +
          "2. 文件已损坏或内容被修改\n" +
          "3. 备份来自不兼容的旧版本\n\n" +
          "解决方法：\n" +
          "• 请重新选择正确的备份文件\n" +
          "• 或在能正常使用的设备/浏览器上重新导出一份备份",
          function () {}
        );
      }
    };
    reader.onerror = function () {
      showAlert(
        "导入失败：无法读取文件。\n\n" +
        "请检查文件是否存在、是否有读取权限，或尝试重新导出一份备份后再导入。",
        function () {}
      );
    };
    reader.readAsText(file);
  }

  function doBackup(filename) {
    filename = (filename || state.settings.autoBackupPath || DEFAULT_BACKUP_PATH).trim();
    if (!filename) filename = DEFAULT_BACKUP_PATH;
    var payload = buildExportData();
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false,
      conflictAction: "overwrite",
    }, function () {
      URL.revokeObjectURL(url);
    });
  }

  var backupIntervalId = null;
  var backupCheckId = null;
  var backupDebounceId = null;

  function autoBackup() {
    if (!state.settings.autoBackupEnabled) return;
    if (state.settings.autoBackupMode !== "onChange") return;
    if (backupDebounceId) clearTimeout(backupDebounceId);
    backupDebounceId = setTimeout(performBackup, 3000);
  }

  function performBackup() {
    doBackup(state.settings.autoBackupPath);
    state.settings.lastBackupAt = new Date().toISOString();
    saveSettings();
    if (!$("settingsModal").hidden) updateLastBackupInfo();
  }

  function scheduleBackup() {
    if (backupIntervalId) { clearInterval(backupIntervalId); backupIntervalId = null; }
    if (backupCheckId) { clearInterval(backupCheckId); backupCheckId = null; }
    if (backupDebounceId) { clearTimeout(backupDebounceId); backupDebounceId = null; }

    if (!state.settings.autoBackupEnabled) return;

    if (state.settings.autoBackupMode === "interval") {
      var ms = state.settings.autoBackupInterval * 60 * 1000;
      backupIntervalId = setInterval(performBackup, ms);
    } else if (state.settings.autoBackupMode === "daily") {
      backupCheckId = setInterval(checkDailyBackup, 60 * 1000);
      checkDailyBackup();
    }
  }

  function checkDailyBackup() {
    if (!state.settings.autoBackupEnabled || state.settings.autoBackupMode !== "daily") return;
    var now = new Date();
    var timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes());
    if (timeStr !== state.settings.autoBackupTime) return;

    var last = state.settings.lastBackupAt ? new Date(state.settings.lastBackupAt) : null;
    if (last && last.getFullYear() === now.getFullYear() && last.getMonth() === now.getMonth() && last.getDate() === now.getDate()) {
      return;
    }
    performBackup();
  }

  // ===== 拖拽排序：站点（占位符 + FLIP 动画）=====
  var dragSiteId = null;
  var dragOriginal = null;
  var dragPlaceholder = null;
  var dragImageClone = null;

  function cleanupSiteDrag() {
    document.querySelectorAll(".category-item.drop-target").forEach(function (el) {
      el.classList.remove("drop-target");
    });
    if (dragOriginal) {
      dragOriginal.classList.remove("dragging");
      dragOriginal.style.display = "";
      dragOriginal = null;
    }
    if (dragPlaceholder && dragPlaceholder.parentNode) {
      dragPlaceholder.parentNode.removeChild(dragPlaceholder);
      dragPlaceholder = null;
    }
    if (dragImageClone && dragImageClone.parentNode) {
      dragImageClone.parentNode.removeChild(dragImageClone);
      dragImageClone = null;
    }
    sitesGridEl.classList.remove("is-dragging");
    dragSiteId = null;
  }

  // FLIP 动画：先记录位置，变更 DOM，再反向平移并播放过渡
  function flipMove(container, mutate, excludeEl) {
    var items = Array.from(container.children);
    var firstRects = items.map(function (el) { return el.getBoundingClientRect(); });

    mutate();

    var lastRects = items.map(function (el) { return el.getBoundingClientRect(); });
    items.forEach(function (el, i) {
      if (el === excludeEl) return;
      var first = firstRects[i];
      var last = lastRects[i];
      var dx = first.left - last.left;
      var dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = "none";
      el.style.transform = "translate(" + dx.toFixed(2) + "px, " + dy.toFixed(2) + "px)";
    });

    // 强制布局，确保反向 transform 已应用
    void container.offsetWidth;

    items.forEach(function (el) {
      if (el === excludeEl) return;
      el.style.transition = "";
      el.style.transform = "";
    });
  }

  function getInsertIndex(card, clientX) {
    var children = Array.from(sitesGridEl.children);
    var placeholderIndex = children.indexOf(dragPlaceholder);
    var targetIndex = children.indexOf(card);
    var rect = card.getBoundingClientRect();
    // 以目标卡片的垂直中线为界：光标在左半区插入到前面，右半区插入到后面
    // 这样左右拖拽的触发阈值对称，都是 50%
    var after = clientX > rect.left + rect.width / 2;
    var newIndex = after ? targetIndex + 1 : targetIndex;
    if (placeholderIndex !== -1 && newIndex > placeholderIndex) newIndex -= 1;
    return newIndex;
  }

  function movePlaceholderTo(index) {
    var children = Array.from(sitesGridEl.children);
    var currentIndex = children.indexOf(dragPlaceholder);
    if (currentIndex === index || index < 0 || index > children.length - 1) return false;

    flipMove(sitesGridEl, function () {
      var ref = sitesGridEl.children[index];
      if (index < currentIndex) {
        sitesGridEl.insertBefore(dragPlaceholder, ref);
      } else {
        var next = ref.nextSibling;
        if (next) sitesGridEl.insertBefore(dragPlaceholder, next);
        else sitesGridEl.appendChild(dragPlaceholder);
      }
    }, dragPlaceholder);

    return true;
  }

  function applySiteOrder(placeholderIndex) {
    var catId = state.activeCategoryId;
    var sites = sitesByCategory(catId);
    var fromIdx = -1;
    sites.forEach(function (s, i) { if (s.id === dragSiteId) fromIdx = i; });
    if (fromIdx === -1) return;
    var moved = sites.splice(fromIdx, 1)[0];
    sites.splice(placeholderIndex, 0, moved);
    sites.forEach(function (s, i) { s.order = i; });
    saveState().then(function () {
      cleanupSiteDrag();
      renderSites();
    });
  }

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
      dragOriginal = card;

      // 使用显式 drag image，避免后续隐藏原卡片导致 ghost 丢失
      var rect = card.getBoundingClientRect();
      dragImageClone = card.cloneNode(true);
      dragImageClone.style.position = "fixed";
      dragImageClone.style.left = "-9999px";
      dragImageClone.style.top = "-9999px";
      dragImageClone.style.width = rect.width + "px";
      dragImageClone.style.height = rect.height + "px";
      dragImageClone.style.zIndex = "-1";
      dragImageClone.style.margin = "0";
      document.body.appendChild(dragImageClone);
      e.dataTransfer.setDragImage(dragImageClone, e.offsetX, e.offsetY);

      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragSiteId);

      // 延迟创建占位符并隐藏原卡片
      setTimeout(function () {
        if (!dragSiteId || !dragOriginal) return;
        // 创建占位符，替换原卡片位置
        dragPlaceholder = document.createElement("div");
        dragPlaceholder.className = "site-card site-card-placeholder";
        dragOriginal.parentNode.insertBefore(dragPlaceholder, dragOriginal);
        dragOriginal.classList.add("dragging");
        dragOriginal.style.display = "none";
        sitesGridEl.classList.add("is-dragging");
      }, 0);
    });

    sitesGridEl.addEventListener("dragend", function (e) {
      cleanupSiteDrag();
    });

    sitesGridEl.addEventListener("dragover", function (e) {
      e.preventDefault();
      if (!dragSiteId || !dragPlaceholder) return;

      var card = e.target.closest(".site-card");
      if (!card || card === dragPlaceholder) return;

      var newIndex = getInsertIndex(card, e.clientX);
      var children = Array.from(sitesGridEl.children);
      var placeholderIndex = children.indexOf(dragPlaceholder);
      if (newIndex === placeholderIndex) return;

      movePlaceholderTo(newIndex);
      e.dataTransfer.dropEffect = "move";
    });

    sitesGridEl.addEventListener("drop", function (e) {
      e.preventDefault();
      if (!dragSiteId || !dragPlaceholder) return;
      var children = Array.from(sitesGridEl.children);
      applySiteOrder(children.indexOf(dragPlaceholder));
    });

    // 站点卡片键盘导航：回车或空格打开链接
    sitesGridEl.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest(".site-card");
      if (!card) return;
      var url = card.getAttribute("data-url");
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  function moveSiteToCategory(siteId, categoryId) {
    var s = siteById(siteId);
    if (!s || s.categoryId === categoryId) {
      cleanupSiteDrag();
      return;
    }
    s.categoryId = categoryId;
    // 放到目标分类末尾
    s.order = nextOrder(state.sites.filter(function (x) { return x.categoryId === categoryId; }));
    state.activeCategoryId = categoryId;
    saveState().then(function () {
      cleanupSiteDrag();
      renderAll();
    });
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
      document.querySelectorAll(".category-item.drop-target").forEach(function (el) {
        el.classList.remove("drop-target");
      });
      dragCatId = null;
    });

    categoryListEl.addEventListener("dragover", function (e) {
      e.preventDefault();
      var item = e.target.closest(".category-item");
      if (!item) return;
      // 站点拖到分类上：高亮目标分类
      if (dragSiteId && item.getAttribute("data-id") !== siteById(dragSiteId).categoryId) {
        document.querySelectorAll(".category-item.drop-target").forEach(function (el) {
          if (el !== item) el.classList.remove("drop-target");
        });
        item.classList.add("drop-target");
        e.dataTransfer.dropEffect = "move";
        return;
      }
      // 分类拖到分类上
      if (dragCatId && item.getAttribute("data-id") !== dragCatId) {
        document.querySelectorAll(".category-item.drop-target").forEach(function (el) {
          el.classList.remove("drop-target");
        });
        e.dataTransfer.dropEffect = "move";
      }
    });

    categoryListEl.addEventListener("dragleave", function (e) {
      var item = e.target.closest(".category-item");
      if (item) item.classList.remove("drop-target");
    });

    categoryListEl.addEventListener("drop", function (e) {
      e.preventDefault();
      var item = e.target.closest(".category-item");
      if (!item) return;
      var targetId = item.getAttribute("data-id");

      // 站点拖到分类：移动站点
      if (dragSiteId) {
        moveSiteToCategory(dragSiteId, targetId);
        return;
      }

      // 分类排序
      if (dragCatId && targetId !== dragCatId) {
        var rect = item.getBoundingClientRect();
        var after = e.clientY > rect.top + rect.height / 2;
        reorderCategories(dragCatId, targetId, after);
      }
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
    $("settingsBtn").addEventListener("click", openSettingsModal);

    // 设置弹窗
    $("exportBtn").addEventListener("click", exportData);
    $("backupNowBtn").addEventListener("click", function () {
      doBackup();
      state.settings.lastBackupAt = new Date().toISOString();
      saveSettings().then(updateLastBackupInfo);
    });
    $("importInput").addEventListener("change", function (e) {
      importData(e.target.files[0]);
      e.target.value = ""; // 允许重复选择同一文件
    });
    $("autoBackupEnabled").addEventListener("change", function (e) {
      state.settings.autoBackupEnabled = e.target.checked;
      saveSettings().then(scheduleBackup);
    });
    $("autoBackupPath").addEventListener("input", function (e) {
      state.settings.autoBackupPath = e.target.value.trim() || DEFAULT_BACKUP_PATH;
      saveSettings();
    });
    $("autoBackupMode").addEventListener("change", function (e) {
      state.settings.autoBackupMode = e.target.value;
      updateBackupOptionsVisibility();
      saveSettings().then(scheduleBackup);
    });
    $("autoBackupInterval").addEventListener("input", function (e) {
      var val = parseInt(e.target.value, 10);
      state.settings.autoBackupInterval = Math.max(1, isNaN(val) ? 30 : val);
      saveSettings().then(scheduleBackup);
    });
    $("autoBackupTime").addEventListener("input", function (e) {
      var val = e.target.value;
      state.settings.autoBackupTime = /^\d{2}:\d{2}$/.test(val) ? val : "14:00";
      saveSettings().then(scheduleBackup);
    });
    document.querySelectorAll('input[name="storageMode"]').forEach(function (radio) {
      radio.addEventListener("change", function (e) {
        if (!e.target.checked) return;
        var newMode = e.target.value;
        var oldMode = state.settings.storageMode;
        if (newMode === oldMode) return;

        // 先恢复 UI，等用户确认后再真正切换
        updateStorageModeUI();

        showConfirm("切换存储位置会把当前数据迁移到「" + storageModeLabel(newMode) + "」，是否继续？", function () {
          state.settings.storageMode = newMode;
          updateStorageModeUI();
          migrateStorage(oldMode, newMode).then(function () {
            saveSettings();
            showAlert("存储位置已切换为「" + storageModeLabel(newMode) + "」，当前数据已迁移。", function () {});
          });
        });
      });
    });

    // 搜索
    searchInputEl.addEventListener("input", function () {
      state.search = searchInputEl.value;
      renderSites();
    });

    // 全局点击委托
    document.addEventListener("click", function (e) {
      // 站点卡片点击：打开链接
      var card = e.target.closest(".site-card");
      if (card && !e.target.closest(".site-actions")) {
        var url = card.getAttribute("data-url");
        if (url) window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

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
        case "close-settings-modal":
          closeSettingsModal();
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
    ["siteModal", "categoryModal", "confirmModal", "settingsModal"].forEach(function (mid) {
      $(mid).addEventListener("click", function (e) {
        if (e.target === $(mid)) {
          if (mid === "confirmModal") closeConfirm();
          else if (mid === "siteModal") closeSiteModal();
          else if (mid === "settingsModal") closeSettingsModal();
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
        if (!$("settingsModal").hidden) { closeSettingsModal(); return; }
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
    console.log("[C-Home] app.js v5 loaded");
    initTooltip();
    bindEvents();
    startClock();
    scheduleBackup();
    renderAll();
  });
})();
