(function () {
  "use strict";

  // ===== 常量 =====
  var STORAGE_KEY = "cHomeData";
  var SETTINGS_KEY = "cHomeSettings";
  var CLOUD_CONFIG_KEY = "cHomeCloudConfig";
  var NOTIFY_PREFS_KEY = "cHomeNotifyPrefs";
  var DEFAULT_CATEGORY_ID = "default";
  var DEFAULT_CATEGORY_NAME = "默认";
  var DEFAULT_BACKUP_PATH = "c-home-backup.json";
  var VERSION = "1.3.0";

  // 分类内置图标库（feather 风格）
  var BUILTIN_CAT_ICONS = {
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line>',
    bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>',
    music: '<path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle>',
  };

  function builtinIconSvg(name) {
    return (
      '<svg class="cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      (BUILTIN_CAT_ICONS[name] || BUILTIN_CAT_ICONS.folder) +
      "</svg>"
    );
  }

  // 分类图标渲染：image > emoji > builtin
  function categoryIconHtml(c) {
    var icon = c.icon;
    if (icon && icon.type === "image") {
      return '<img class="cat-icon cat-icon-img" src="' + escapeHtml(icon.value) + '" alt="" />';
    }
    if (icon && icon.type === "emoji") {
      return '<span class="cat-icon cat-icon-emoji">' + escapeHtml(icon.value) + "</span>";
    }
    return builtinIconSvg(icon && icon.type === "builtin" ? icon.name : "folder");
  }

  var ICON_MAX_SIZE = 128;

  // 上传图片 -> 等比压缩到 128x128 以内（只缩不放）-> dataURL（WebP 优先，回退 PNG）
  function fileToIconDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error("请选择图片文件"));
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, ICON_MAX_SIZE / Math.max(img.width, img.height));
          var cw = Math.max(1, Math.round(img.width * scale));
          var ch = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
          var url = canvas.toDataURL("image/webp", 0.9);
          if (!url || url.indexOf("data:image/webp") !== 0) {
            url = canvas.toDataURL("image/png");
          }
          resolve(url);
        };
        img.onerror = function () { reject(new Error("图片读取失败")); };
        img.src = e.target.result;
      };
      reader.onerror = function () { reject(new Error("文件读取失败")); };
      reader.readAsDataURL(file);
    });
  }

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
      openInCurrentTab: true,     // 点击站点在当前页打开；false 则新标签页打开
      storageBackends: { local: true, sync: false, cloud: false, gist: false },
    },
    dataUpdatedAt: null, // 数据快照的最后写入时间（last-write-wins 用）
    notifyPrefs: { syncQuotaUntil: 0, syncQuotaForever: false }, // 提醒免打扰
    cloudConfig: {
      webdav: { enabled: false, url: "", username: "", password: "", path: "/c-home/", basicAuth: true },
      gist: { enabled: false, token: "", gistId: "" },
    },
  };

  var editingSiteId = null;
  var editingCategoryId = null;
  var confirmCallback = null;
  // 弹窗编辑草稿：颜色 + 图标（{type:"builtin"|"emoji"|"image", name?, value?}）
  var categoryDraft = { color: null, icon: null };
  var siteDraft = { color: null, icon: null };

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

  function openSiteUrl(url) {
    if (state.settings.openInCurrentTab) {
      location.assign(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
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

  function letterAvatar(name, color) {
    var letter = (((name || "").trim())[0] || "?").toUpperCase();
    var code = name ? name.charCodeAt(0) : 0;
    color = color || AVATAR_COLORS[code % AVATAR_COLORS.length];
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
    return new Promise(function (resolve, reject) {
      var data = {};
      data[key] = value;
      chrome.storage[area].set(data, function () {
        // sync 有写入配额（~120 次/分），失败必须暴露而不是静默丢数据
        var err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  // ===== IndexedDB（本地大容量） =====
  var IDB_NAME = "cHomeDB";
  var IDB_STORE = "kv";
  var idbDBPromise = null;

  function idbGetDB() {
    if (idbDBPromise) return idbDBPromise;
    idbDBPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return idbDBPromise;
  }

  function idbKeyvalGet(key) {
    return idbGetDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readonly");
        var req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbKeyvalSet(key, val) {
    return idbGetDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(function () {}).catch(function () {});
    }
  }

  // 带超时的 fetch：防止云端服务无响应时请求无限挂起
  var CLOUD_FETCH_TIMEOUT = 15000;

  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = timeoutMs || CLOUD_FETCH_TIMEOUT;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    options = options || {};
    options.signal = ctrl.signal;
    return fetch(url, options).finally(function () { clearTimeout(timer); });
  }

  // ===== 云端配置（WebDAV / Gist） =====
  function applyCloudConfig(cfg) {
    if (!cfg) return;
    if (cfg.webdav) {
      state.cloudConfig.webdav.enabled = !!cfg.webdav.enabled;
      state.cloudConfig.webdav.url = cfg.webdav.url || "";
      state.cloudConfig.webdav.username = cfg.webdav.username || "";
      state.cloudConfig.webdav.password = cfg.webdav.password || "";
      state.cloudConfig.webdav.path = cfg.webdav.path || "/c-home/";
      state.cloudConfig.webdav.basicAuth = cfg.webdav.basicAuth !== false;
    }
    if (cfg.gist) {
      state.cloudConfig.gist.enabled = !!cfg.gist.enabled;
      state.cloudConfig.gist.token = cfg.gist.token || "";
      state.cloudConfig.gist.gistId = cfg.gist.gistId || "";
    }
  }

  function saveCloudConfig() {
    return writeTo("local", CLOUD_CONFIG_KEY, state.cloudConfig);
  }

  function webdavFileUrl() {
    var cfg = state.cloudConfig.webdav;
    var base = (cfg.url || "").replace(/\/+$/, "");
    var path = cfg.path || "/c-home/";
    if (path.charAt(0) !== "/") path = "/" + path;
    if (!/\/$/.test(path)) path = path + "/";
    return base + path + "c-home-data.json";
  }

  function webdavHeaders() {
    var cfg = state.cloudConfig.webdav;
    var headers = { "Content-Type": "application/json" };
    if (cfg.basicAuth !== false && cfg.username) {
      headers["Authorization"] = "Basic " + btoa(cfg.username + ":" + (cfg.password || ""));
    }
    return headers;
  }

  function performWebdavPut(data) {
    var cfg = state.cloudConfig.webdav;
    if (!cfg.enabled || !cfg.url) return Promise.resolve();
    return fetchWithTimeout(webdavFileUrl(), {
      method: "PUT",
      headers: webdavHeaders(),
      body: JSON.stringify(data),
    }).then(function (r) {
      if (!r.ok) throw new Error("WebDAV PUT " + r.status);
    });
  }

  function performWebdavGet() {
    var cfg = state.cloudConfig.webdav;
    if (!cfg.enabled || !cfg.url) return Promise.resolve(null);
    return fetchWithTimeout(webdavFileUrl(), { method: "GET", headers: webdavHeaders() })
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("WebDAV GET " + r.status);
        return r.json();
      })
      .catch(function () { return null; });
  }

  function gistHeaders() {
    return {
      "Content-Type": "application/json",
      "Accept": "application/vnd.github+json",
      "Authorization": "token " + (state.cloudConfig.gist.token || ""),
    };
  }

  function performGistPut(data) {
    var cfg = state.cloudConfig.gist;
    if (!cfg.enabled || !cfg.token) return Promise.resolve();
    var body = {
      description: "C-Home backup",
      public: false,
      files: { "c-home-data.json": { content: JSON.stringify(data) } },
    };
    var gistId = cfg.gistId;
    var url = "https://api.github.com/gists" + (gistId ? "/" + gistId : "");
    var method = gistId ? "PATCH" : "POST";
    return fetchWithTimeout(url, { method: method, headers: gistHeaders(), body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) throw new Error("Gist " + method + " " + r.status);
        return r.json();
      })
      .then(function (g) {
        if (!gistId && g && g.id) {
          state.cloudConfig.gist.gistId = g.id;
          saveCloudConfig();
        }
      });
  }

  function performGistGet() {
    var cfg = state.cloudConfig.gist;
    if (!cfg.enabled || !cfg.token || !cfg.gistId) return Promise.resolve(null);
    return fetchWithTimeout("https://api.github.com/gists/" + cfg.gistId, { headers: gistHeaders() })
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("Gist GET " + r.status);
        return r.json();
      })
      .then(function (g) {
        if (!g || !g.files) return null;
        var f = g.files["c-home-data.json"];
        if (!f || !f.content) return null;
        try { return JSON.parse(f.content); } catch (e) { return null; }
      })
      .catch(function () { return null; });
  }

  function applySettings(settings) {
    if (!settings) return;
    state.settings.autoBackupEnabled = !!settings.autoBackupEnabled;
    state.settings.autoBackupPath = settings.autoBackupPath || DEFAULT_BACKUP_PATH;
    state.settings.autoBackupMode = ["onChange", "interval", "daily"].indexOf(settings.autoBackupMode) !== -1 ? settings.autoBackupMode : "onChange";
    state.settings.autoBackupInterval = Math.max(1, parseInt(settings.autoBackupInterval, 10) || 30);
    state.settings.autoBackupTime = /^\d{2}:\d{2}$/.test(settings.autoBackupTime || "") ? settings.autoBackupTime : "14:00";
    state.settings.lastBackupAt = settings.lastBackupAt || null;
    state.settings.openInCurrentTab = settings.openInCurrentTab !== false;
    applyStorageBackends(settings);
  }

  function applyStorageBackends(settings) {
    var bk = state.settings.storageBackends;
    if (settings && settings.storageBackends) {
      bk.local = !!settings.storageBackends.local;
      bk.sync = !!settings.storageBackends.sync;
      bk.cloud = !!settings.storageBackends.cloud;
      bk.gist = !!settings.storageBackends.gist;
    } else if (settings && settings.storageMode) {
      var m = settings.storageMode;
      bk.local = (m === "local" || m === "both");
      bk.sync = (m === "sync");
      bk.cloud = (m === "cloud" || m === "both");
      bk.gist = (m === "gist");
    }
    if (!(bk.local || bk.sync || bk.cloud || bk.gist)) bk.local = true;
  }

  function cloneBackends(bk) {
    return { local: !!bk.local, sync: !!bk.sync, cloud: !!bk.cloud, gist: !!bk.gist };
  }

  function anyBackendEnabled(bk) {
    return !!(bk.local || bk.sync || bk.cloud || bk.gist);
  }

  function applyData(data) {
    if (!data || !data.categories) return false;
    state.categories = data.categories;
    state.sites = data.sites || [];
    state.activeCategoryId = data.activeCategoryId || DEFAULT_CATEGORY_ID;
    state.dataUpdatedAt = data.updatedAt || null;
    return true;
  }

  function initDefaultData() {
    state.categories = [{ id: DEFAULT_CATEGORY_ID, name: DEFAULT_CATEGORY_NAME, order: 0 }];
    state.sites = [];
    state.activeCategoryId = DEFAULT_CATEGORY_ID;
    saveState({ backup: false });
  }

  function loadState() {
    return Promise.all([
      readFrom("local", SETTINGS_KEY),
      readFrom("local", CLOUD_CONFIG_KEY),
      readFrom("local", NOTIFY_PREFS_KEY),
    ]).then(function (r) {
      applySettings(r[0]);
      applyCloudConfig(r[1]);
      if (r[2]) {
        state.notifyPrefs.syncQuotaUntil = r[2].syncQuotaUntil || 0;
        state.notifyPrefs.syncQuotaForever = !!r[2].syncQuotaForever;
      }
      requestPersistentStorage();
      return loadData();
    });
  }

  function readFromBackend(b) {
    if (b === "local") return idbKeyvalGet(STORAGE_KEY);
    if (b === "sync") return readFrom("sync", STORAGE_KEY);
    if (b === "cloud") return performWebdavGet();
    if (b === "gist") return performGistGet();
    return Promise.resolve(null);
  }

  function writeToBackend(b, data) {
    if (b === "local") return idbKeyvalSet(STORAGE_KEY, data);
    if (b === "sync") return writeTo("sync", STORAGE_KEY, data);
    if (b === "cloud") return performWebdavPut(data);
    if (b === "gist") return performGistPut(data);
    return Promise.resolve();
  }

  function tryMigrateLegacy() {
    return readFrom("local", STORAGE_KEY).then(function (localLegacy) {
      if (localLegacy && localLegacy.categories) return localLegacy;
      return readFrom("sync", STORAGE_KEY).then(function (syncLegacy) {
        return (syncLegacy && syncLegacy.categories) ? syncLegacy : null;
      });
    });
  }

  function readSafe(b) {
    return readFromBackend(b).catch(function (err) {
      console.error("[C-Home] read " + b + " failed:", err && err.message);
      return null;
    });
  }

  // 串行尝试一组后端，返回第一个有效数据，都没有则 null
  function tryBackendsInOrder(list) {
    return new Promise(function (resolve) {
      (function next(i) {
        if (i >= list.length) { resolve(null); return; }
        readSafe(list[i]).then(function (data) {
          if (data && data.categories) resolve(data);
          else next(i + 1);
        });
      })(0);
    });
  }

  function dataTs(d) {
    var t = d && d.updatedAt ? Date.parse(d.updatedAt) : 0;
    return isNaN(t) ? 0 : t;
  }

  // 快通道（本地毫秒级）：sync -> local；慢通道（网络）：cloud -> gist
  function fastBackends() {
    return ["sync", "local"].filter(function (b) { return state.settings.storageBackends[b]; });
  }

  function remoteBackends() {
    return ["cloud", "gist"].filter(function (b) { return state.settings.storageBackends[b]; });
  }

  function loadData() {
    return tryBackendsInOrder(fastBackends()).then(function (localData) {
      if (localData) {
        // 本地有数据：立即渲染，云端在后台竞速
        applyData(localData);
        refreshFromRemote();
        return;
      }
      // 本地为空（新设备/首次）：等云端
      return tryBackendsInOrder(remoteBackends()).then(function (remoteData) {
        if (remoteData) {
          applyData(remoteData);
          return saveState({ backup: false, keepTimestamp: true });
        }
        return tryMigrateLegacy().then(function (legacy) {
          if (applyData(legacy)) return saveState({ backup: false });
          initDefaultData();
        });
      });
    });
  }

  // 后台拉取云端，按 updatedAt 比较（last-write-wins）：
  // 云端更新 -> 应用并重渲染，保留原时间戳收敛各后端（避免多设备盖戳乒乓）；
  // 云端更旧 -> 本地数据回写云端自愈。
  function refreshFromRemote() {
    var remotes = remoteBackends();
    if (!remotes.length) return;
    tryBackendsInOrder(remotes).then(function (remoteData) {
      if (!remoteData) return;
      var remoteTs = dataTs(remoteData);
      var localTs = state.dataUpdatedAt ? Date.parse(state.dataUpdatedAt) : 0;
      if (isNaN(localTs)) localTs = 0;
      if (remoteTs > localTs) {
        applyData(remoteData);
        renderAll();
        saveState({ backup: false, keepTimestamp: true });
      } else if (remoteTs < localTs) {
        scheduleRemoteSync();
      }
    });
  }

  function currentData(stamp) {
    // stamp=false 时保留原时间戳：后台同步与云端数据回写不应伪造"最后修改时间"
    if (stamp !== false) state.dataUpdatedAt = new Date().toISOString();
    return {
      categories: state.categories,
      sites: state.sites,
      activeCategoryId: state.activeCategoryId,
      updatedAt: state.dataUpdatedAt,
    };
  }

  // ===== 远端后台同步（sync/cloud/gist：防抖 + 串行队列，不阻塞 UI） =====
  var REMOTE_SYNC_DEBOUNCE = 1500;
  var remoteSyncTimer = null;
  var remoteSyncRunning = false;
  var remoteSyncPending = false;
  var remoteSyncFailNotified = false;

  function remoteBackendLabel(b) {
    return b === "cloud" ? "WebDAV" : b === "gist" ? "GitHub Gist" : "Chrome 同步";
  }

  function scheduleRemoteSync() {
    remoteSyncPending = true;
    if (remoteSyncTimer) clearTimeout(remoteSyncTimer);
    remoteSyncTimer = setTimeout(flushRemoteSync, REMOTE_SYNC_DEBOUNCE);
  }

  function flushRemoteSync() {
    if (remoteSyncTimer) {
      clearTimeout(remoteSyncTimer);
      remoteSyncTimer = null;
    }
    if (remoteSyncRunning || !remoteSyncPending) return;

    var bk = state.settings.storageBackends;
    var data = currentData(false);
    var promises = [];
    var failures = [];
    ["sync", "cloud", "gist"].forEach(function (b) {
      if (bk[b]) {
        promises.push(writeToBackend(b, data).catch(function (err) {
          failures.push({ backend: b, message: err && err.message ? err.message : "" });
        }));
      }
    });
    if (!promises.length) {
      remoteSyncPending = false;
      return;
    }

    remoteSyncRunning = true;
    remoteSyncPending = false;
    Promise.all(promises).then(function () {
      remoteSyncRunning = false;

      if (!failures.length) {
        remoteSyncFailNotified = false;
        syncQuotaAlertShown = false;
        // 同步成功后检查 sync 用量，接近配额提前预警
        if (bk.sync) checkSyncUsage();
      } else {
        var syncQuotaHit = failures.some(function (f) {
          return f.backend === "sync" && /quota/i.test(f.message);
        });
        if (syncQuotaHit) {
          // Chrome 同步配额打满：引导用户切换存储方案
          showSyncQuotaAlert("exceeded");
        } else if (!remoteSyncFailNotified) {
          remoteSyncFailNotified = true;
          showAlert("远端同步失败：数据已保存在本地，稍后会随下次变更自动重试。请检查云端配置、网络或同步配额。", null);
        }
      }

      if (remoteSyncPending) scheduleRemoteSync();
    });
  }

  // ===== Chrome 同步配额预警与引导 =====
  var SYNC_QUOTA_BYTES = 102400; // chrome.storage.sync 总配额 100KB
  var SYNC_WARN_RATIO = 0.8;     // 用量达到 80% 提前预警
  var syncQuotaAlertShown = false; // 本次会话内只主动提醒一次（同步成功后重置）

  function saveNotifyPrefs() {
    return writeTo("local", NOTIFY_PREFS_KEY, state.notifyPrefs);
  }

  function endOfToday() {
    var d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  }

  function syncQuotaMuted() {
    if (!state.notifyPrefs) return false;
    if (state.notifyPrefs.syncQuotaForever) return true;
    return Date.now() < (state.notifyPrefs.syncQuotaUntil || 0);
  }

  function checkSyncUsage() {
    if (!chrome.storage.sync.getBytesInUse) return;
    chrome.storage.sync.getBytesInUse(null, function (bytes) {
      if (chrome.runtime.lastError || typeof bytes !== "number") return;
      var ratio = bytes / SYNC_QUOTA_BYTES;
      if (ratio >= SYNC_WARN_RATIO) {
        showSyncQuotaAlert("warning", Math.round(ratio * 100));
      }
    });
  }

  function showSyncQuotaAlert(kind, percent) {
    if (syncQuotaAlertShown || syncQuotaMuted()) return;
    syncQuotaAlertShown = true;
    var text =
      kind === "exceeded"
        ? "Chrome 同步空间已写满，本次更改未能同步（本地数据不受影响）。建议改用 IndexedDB 本地或 WebDAV 云端，并在「数据存储」中取消勾选 Chrome 同步。"
        : "Chrome 同步空间已用约 " + percent + "%（上限 100KB）。数据继续增长可能导致同步失败，建议提前切换到 IndexedDB 本地或 WebDAV 云端。";
    showAlert(text, null, {
      actions: [
        { label: "去设置", primary: true, onClick: function () { openSettingsModal(); } },
        {
          label: "今日不再提示",
          onClick: function () {
            state.notifyPrefs.syncQuotaUntil = endOfToday();
            saveNotifyPrefs();
          },
        },
        {
          label: "不再提示",
          onClick: function () {
            state.notifyPrefs.syncQuotaForever = true;
            saveNotifyPrefs();
          },
        },
      ],
    });
  }

  function saveState(options) {
    options = options || {};
    var data = currentData(!options.keepTimestamp);
    var bk = state.settings.storageBackends;
    var promises = [];

    // IndexedDB 本地写入是毫秒级，等待即可
    if (bk.local) promises.push(writeToBackend("local", data));

    if (bk.sync || bk.cloud || bk.gist) {
      if (options.waitRemote) {
        // 显式迁移：等待所有远端，单个失败不阻塞整体流程
        ["sync", "cloud", "gist"].forEach(function (b) {
          if (bk[b]) {
            promises.push(writeToBackend(b, data).catch(function () {
              showAlert("「" + remoteBackendLabel(b) + "」写入失败，数据已保存到其他存储位置。", null);
            }));
          }
        });
      } else {
        // 常规保存：远端后台同步，不阻塞 UI，也避免 sync 写入配额打满
        scheduleRemoteSync();
      }
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
      openInCurrentTab: state.settings.openInCurrentTab,
      storageBackends: cloneBackends(state.settings.storageBackends),
    };
    return writeTo("local", SETTINGS_KEY, data);
  }

  function storageBackendsLabel(bk) {
    var names = [];
    if (bk.cloud) names.push("WebDAV");
    if (bk.gist) names.push("Gist");
    if (bk.sync) names.push("同步");
    if (bk.local) names.push("IndexedDB");
    return names.length ? names.join(" + ") : "未选择";
  }

  function migrateStorage() {
    return saveState({ backup: false, waitRemote: true });
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
        'draggable="true" data-id="' + c.id + '" data-action="select-category"' +
        (c.color ? ' style="color:' + escapeHtml(c.color) + '"' : "") + ">" +
        '<span class="cat-grip">⋮⋮</span>' +
        categoryIconHtml(c) +
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
  // 站点图标：自定义 image > emoji > favicon（失败回退自定义色字母头像）
  function siteIconHtml(s) {
    var icon = s.icon;
    if (icon && icon.type === "image") {
      return '<img class="site-icon" src="' + escapeHtml(icon.value) + '" alt="" />';
    }
    if (icon && icon.type === "emoji") {
      return '<span class="site-icon site-icon-emoji">' + escapeHtml(icon.value) + "</span>";
    }
    var favicon = faviconUrl(s.url);
    var fallback = letterAvatar(s.name, s.color);
    // 先用本地生成的字母头像占位，避免等待 favicon 时出现空白
    return (
      '<img class="site-icon" src="' + escapeHtml(fallback) + '" alt="" ' +
      'data-icon="' + escapeHtml(favicon) + '" data-fallback="' + escapeHtml(fallback) + '" />'
    );
  }

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
      var host = displayHost(s.url);
      return (
        '<div class="site-card" draggable="true" role="link" tabindex="0" data-id="' + s.id + '" data-url="' + escapeHtml(s.url) + '">' +
        '<div class="site-actions">' +
        '<button aria-label="编辑" data-action="edit-site" data-id="' + s.id + '">' + EDIT_ICON + "</button>" +
        '<button aria-label="删除" data-action="delete-site" data-id="' + s.id + '">×</button>' +
        "</div>" +
        siteIconHtml(s) +
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
  function renderCategoryIconGrid() {
    var grid = $("categoryIconGrid");
    grid.innerHTML = Object.keys(BUILTIN_CAT_ICONS).map(function (name) {
      var active = categoryDraft.icon && categoryDraft.icon.type === "builtin" && categoryDraft.icon.name === name ? " active" : "";
      return (
        '<button type="button" class="icon-choice' + active + '" data-icon-name="' + name + '" aria-label="' + name + '">' +
        builtinIconSvg(name) +
        "</button>"
      );
    }).join("");
  }

  function updateCategoryIconPreview() {
    renderCategoryIconGrid();
    var box = $("categoryIconPreview");
    var icon = categoryDraft.icon;
    if (icon && icon.type === "image") {
      box.innerHTML = '<img src="' + escapeHtml(icon.value) + '" alt="" />';
    } else if (icon && icon.type === "emoji") {
      box.textContent = icon.value;
    } else {
      box.innerHTML = "";
    }
  }

  function openCategoryModal(mode, id) {
    editingCategoryId = id || null;
    var cat = mode === "rename" && id ? categoryById(id) : null;
    $("categoryModalTitle").textContent = mode === "rename" ? "重命名分类" : "新建分类";
    $("categoryName").value = cat ? cat.name || "" : "";
    categoryDraft.color = cat && cat.color ? cat.color : null;
    categoryDraft.icon = cat && cat.icon ? { type: cat.icon.type, name: cat.icon.name, value: cat.icon.value } : null;
    $("categoryColor").value = categoryDraft.color || "#4f46e5";
    $("categoryIconEmoji").value = categoryDraft.icon && categoryDraft.icon.type === "emoji" ? categoryDraft.icon.value : "";
    updateCategoryIconPreview();
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
      if (cat) {
        cat.name = name;
        cat.color = categoryDraft.color || undefined;
        cat.icon = categoryDraft.icon || undefined;
      }
    } else {
      state.categories.push({
        id: uid(),
        name: name,
        order: nextOrder(state.categories),
        color: categoryDraft.color || undefined,
        icon: categoryDraft.icon || undefined,
      });
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
    renderAll();
    saveState({ backup: false });
  }

  // ===== 站点操作 =====
  function openSiteModal(mode, id) {
    editingSiteId = id || null;
    $("siteModalTitle").textContent = mode === "edit" ? "编辑站点" : "添加站点";
    renderCategoryOptions();
    var s = mode === "edit" && id ? siteById(id) : null;
    if (s) {
      $("siteName").value = s.name;
      $("siteUrl").value = s.url;
      $("siteCategory").value = s.categoryId;
    } else {
      $("siteName").value = "";
      $("siteUrl").value = "";
      $("siteCategory").value = state.activeCategoryId;
    }
    siteDraft.color = s && s.color ? s.color : null;
    siteDraft.icon = s && s.icon ? { type: s.icon.type, value: s.icon.value } : null;
    $("siteIconColor").value = siteDraft.color || "#4f46e5";
    $("siteIconEmoji").value = siteDraft.icon && siteDraft.icon.type === "emoji" ? siteDraft.icon.value : "";
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
        s.color = siteDraft.color || undefined;
        s.icon = siteDraft.icon || undefined;
      }
    } else {
      state.sites.push({
        id: uid(),
        name: name,
        url: url,
        categoryId: categoryId,
        order: nextOrder(state.sites.filter(function (x) { return x.categoryId === categoryId; })),
        color: siteDraft.color || undefined,
        icon: siteDraft.icon || undefined,
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
    var box = $("previewIcon");
    var icon = siteDraft.icon;
    if (icon && icon.type === "image") {
      box.innerHTML = '<img src="' + escapeHtml(icon.value) + '" alt="" />';
      return;
    }
    if (icon && icon.type === "emoji") {
      box.innerHTML = '<span class="preview-emoji">' + escapeHtml(icon.value) + "</span>";
      return;
    }
    // 默认：字母头像占位（应用自定义颜色），再异步加载 favicon
    var fallback = letterAvatar(name, siteDraft.color);
    box.innerHTML = '<img src="' + escapeHtml(fallback) + '" alt="" />';
    if (url) {
      var imgEl = box.firstChild;
      var src = faviconUrl(url);
      var loader = new Image();
      loader.onload = function () { if (imgEl.parentNode) imgEl.src = src; };
      loader.src = src;
    }
  }

  // ===== 确认弹窗 =====
  function showConfirm(text, callback) {
    resetConfirmModal();
    $("confirmText").textContent = text;
    confirmCallback = callback;
    $("confirmModal").hidden = false;
  }

  // ===== Toast 提示（非阻断，堆叠：最新在底部，5 秒自动消失） =====
  var TOAST_DURATION = 5000;
  var TOAST_MAX = 5;
  var TOAST_CLOSE_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="18" y1="6" x2="6" y2="18"></line>' +
    '<line x1="6" y1="6" x2="18" y2="18"></line>' +
    "</svg>";

  function showAlert(text, callback, options) {
    options = options || {};
    var container = $("toastContainer");

    var toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");

    var body = document.createElement("div");
    body.className = "toast-body";

    var p = document.createElement("p");
    p.className = "toast-text";
    p.textContent = text;
    body.appendChild(p);

    if (options.actions && options.actions.length) {
      var row = document.createElement("div");
      row.className = "toast-actions";
      options.actions.forEach(function (a) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "toast-action" + (a.primary ? " primary" : "");
        btn.textContent = a.label;
        btn.addEventListener("click", function () {
          dismissToast(toast);
          if (a.onClick) a.onClick();
        });
        row.appendChild(btn);
      });
      body.appendChild(row);
    }

    var close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "关闭");
    close.innerHTML = TOAST_CLOSE_ICON;
    close.addEventListener("click", function () { dismissToast(toast); });

    toast.appendChild(body);
    toast.appendChild(close);

    // 超出上限时移除最旧的（顶部）
    while (container.children.length >= TOAST_MAX) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(toast);

    // 强制回流后加 visible，触发进入动画
    void toast.offsetWidth;
    toast.classList.add("visible");

    // 带操作按钮的 toast 常驻等用户决策；普通 toast 5 秒自动消失
    var duration = options.duration || (options.actions && options.actions.length ? 0 : TOAST_DURATION);
    if (duration > 0) {
      toast._timer = setTimeout(function () { dismissToast(toast); }, duration);
    }

    if (callback) callback();
  }

  function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    clearTimeout(toast._timer);
    toast.classList.remove("visible");
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
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
    $("openInCurrentTab").checked = state.settings.openInCurrentTab;
    $("autoBackupEnabled").checked = state.settings.autoBackupEnabled;
    $("autoBackupPath").value = state.settings.autoBackupPath;
    $("autoBackupMode").value = state.settings.autoBackupMode;
    $("autoBackupInterval").value = state.settings.autoBackupInterval;
    $("autoBackupTime").value = state.settings.autoBackupTime;
    updateBackupOptionsVisibility();
    updateLastBackupInfo();
    populateCloudConfigUI();
    updateStorageUI();
    switchSettingsTab("general");
    $("settingsModal").hidden = false;
  }

  function populateCloudConfigUI() {
    var w = state.cloudConfig.webdav;
    var g = state.cloudConfig.gist;
    $("webdavEnabled").checked = w.enabled;
    $("webdavUrl").value = w.url;
    $("webdavUsername").value = w.username;
    $("webdavPassword").value = w.password;
    $("webdavPath").value = w.path;
    $("gistEnabled").checked = g.enabled;
    $("gistToken").value = g.token;
    $("gistId").value = g.gistId;
  }

  function collectCloudConfigFromUI() {
    state.cloudConfig.webdav.enabled = $("webdavEnabled").checked;
    state.cloudConfig.webdav.url = $("webdavUrl").value.trim();
    state.cloudConfig.webdav.username = $("webdavUsername").value;
    state.cloudConfig.webdav.password = $("webdavPassword").value;
    state.cloudConfig.webdav.path = $("webdavPath").value.trim() || "/c-home/";
    state.cloudConfig.gist.enabled = $("gistEnabled").checked;
    state.cloudConfig.gist.token = $("gistToken").value.trim();
    state.cloudConfig.gist.gistId = $("gistId").value.trim();
  }

  function onCloudConfigChange() {
    collectCloudConfigFromUI();
    debouncedSaveCloudConfig();
  }

  function updateStorageUI() {
    var bk = state.settings.storageBackends;
    document.querySelectorAll('input[name="storageBackend"]').forEach(function (cb) {
      cb.checked = !!bk[cb.value];
    });

    var hint = $("storageHint");
    var enabled = [];
    if (bk.cloud) enabled.push("WebDAV");
    if (bk.gist) enabled.push("Gist");
    if (bk.sync) enabled.push("同步");
    if (bk.local) enabled.push("IndexedDB");
    if (enabled.length === 0) {
      hint.textContent = "未选择任何存储位置，请至少勾选一个。";
    } else if (enabled.length === 1) {
      hint.textContent = "数据保存到「" + enabled[0] + "」。读取优先级：云端 → 同步 → 本地。";
    } else {
      hint.textContent = "同时写入：" + enabled.join(" + ") + "。读取按 云端 → 同步 → 本地 优先，先拿到数据的后端为准。";
    }

    var webdavBlock = $("webdavBlock");
    var gistBlock = $("gistBlock");
    var cloudEmpty = $("cloudEmptyHint");
    if (webdavBlock) webdavBlock.hidden = !bk.cloud;
    if (gistBlock) gistBlock.hidden = !bk.gist;
    if (cloudEmpty) cloudEmpty.hidden = bk.cloud || bk.gist;
  }

  function switchSettingsTab(tab) {
    document.querySelectorAll(".settings-nav-item").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-settings-tab") === tab);
    });
    document.querySelectorAll(".settings-panel").forEach(function (panel) {
      panel.classList.toggle("active", panel.getAttribute("data-settings-panel") === tab);
    });
  }

  // ===== 通用防抖（带 flush，防止弹窗关闭时丢掉最后一次输入） =====
  function debounce(fn, ms) {
    var t = null;
    var debounced = function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        fn();
      }, ms);
    };
    debounced.flush = function () {
      if (t) {
        clearTimeout(t);
        t = null;
        fn();
      }
    };
    return debounced;
  }

  // 设置项输入每 keystroke 都触发落盘/重建定时器，防抖合并
  var debouncedSaveSettings = debounce(saveSettings, 500);
  var debouncedSaveSettingsAndSchedule = debounce(function () {
    saveSettings().then(scheduleBackup);
  }, 500);
  var debouncedSaveCloudConfig = debounce(saveCloudConfig, 500);

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
    //  flush 防抖中的落盘，避免弹窗关闭丢掉最后一击
    debouncedSaveSettings.flush();
    debouncedSaveSettingsAndSchedule.flush();
    debouncedSaveCloudConfig.flush();
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
      if (url) openSiteUrl(url);
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
    document.querySelectorAll(".settings-nav-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        switchSettingsTab(btn.getAttribute("data-settings-tab"));
      });
    });
    $("gotoStorageTabBtn").addEventListener("click", function () {
      switchSettingsTab("storage");
    });
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
    $("openInCurrentTab").addEventListener("change", function (e) {
      state.settings.openInCurrentTab = e.target.checked;
      saveSettings();
    });
    $("autoBackupPath").addEventListener("input", function (e) {
      state.settings.autoBackupPath = e.target.value.trim() || DEFAULT_BACKUP_PATH;
      debouncedSaveSettings();
    });
    $("autoBackupMode").addEventListener("change", function (e) {
      state.settings.autoBackupMode = e.target.value;
      updateBackupOptionsVisibility();
      saveSettings().then(scheduleBackup);
    });
    $("autoBackupInterval").addEventListener("input", function (e) {
      var val = parseInt(e.target.value, 10);
      state.settings.autoBackupInterval = Math.max(1, isNaN(val) ? 30 : val);
      debouncedSaveSettingsAndSchedule();
    });
    $("autoBackupTime").addEventListener("input", function (e) {
      var val = e.target.value;
      state.settings.autoBackupTime = /^\d{2}:\d{2}$/.test(val) ? val : "14:00";
      debouncedSaveSettingsAndSchedule();
    });
    document.querySelectorAll('input[name="storageBackend"]').forEach(function (cb) {
      cb.addEventListener("change", function (e) {
        var b = e.target.value;
        var next = cloneBackends(state.settings.storageBackends);
        next[b] = e.target.checked;

        if (!anyBackendEnabled(next)) {
          e.target.checked = true;
          showAlert("请至少保留一个存储位置。", function () {});
          return;
        }

        e.target.checked = state.settings.storageBackends[b];
        showConfirm("切换存储位置会把当前数据迁移到「" + storageBackendsLabel(next) + "」，是否继续？", function () {
          state.settings.storageBackends = next;
          updateStorageUI();
          migrateStorage().then(function () {
            saveSettings();
            showAlert("存储位置已切换为「" + storageBackendsLabel(next) + "」，当前数据已迁移。", function () {});
          });
        });
      });
    });

    ["webdavEnabled", "webdavUrl", "webdavUsername", "webdavPassword", "webdavPath",
     "gistEnabled", "gistToken", "gistId"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("change", onCloudConfigChange);
      el.addEventListener("input", onCloudConfigChange);
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
        if (url) openSiteUrl(url);
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

    // 分类弹窗：颜色 + 图标
    $("categoryColor").addEventListener("input", function (e) {
      categoryDraft.color = e.target.value;
    });
    $("categoryColorReset").addEventListener("click", function () {
      categoryDraft.color = null;
      $("categoryColor").value = "#4f46e5";
    });
    $("categoryIconGrid").addEventListener("click", function (e) {
      var btn = e.target.closest(".icon-choice");
      if (!btn) return;
      categoryDraft.icon = { type: "builtin", name: btn.getAttribute("data-icon-name") };
      $("categoryIconEmoji").value = "";
      updateCategoryIconPreview();
    });
    $("categoryIconEmoji").addEventListener("input", function (e) {
      var v = e.target.value.trim();
      categoryDraft.icon = v ? { type: "emoji", value: v } : null;
      updateCategoryIconPreview();
    });
    $("categoryIconFile").addEventListener("change", function (e) {
      var file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      fileToIconDataUrl(file).then(function (url) {
        categoryDraft.icon = { type: "image", value: url };
        $("categoryIconEmoji").value = "";
        updateCategoryIconPreview();
      }).catch(function (err) {
        showAlert(err.message || "图片处理失败", null);
      });
    });
    $("categoryIconClear").addEventListener("click", function () {
      categoryDraft.icon = null;
      $("categoryIconEmoji").value = "";
      updateCategoryIconPreview();
    });

    // 站点弹窗：图标颜色 + 自定义图标
    $("siteIconColor").addEventListener("input", function (e) {
      siteDraft.color = e.target.value;
      updatePreview();
    });
    $("siteIconColorReset").addEventListener("click", function () {
      siteDraft.color = null;
      $("siteIconColor").value = "#4f46e5";
      updatePreview();
    });
    $("siteEmojiQuick").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-emoji]");
      if (!btn) return;
      var v = btn.getAttribute("data-emoji");
      $("siteIconEmoji").value = v;
      siteDraft.icon = { type: "emoji", value: v };
      updatePreview();
    });
    $("siteIconEmoji").addEventListener("input", function (e) {
      var v = e.target.value.trim();
      siteDraft.icon = v ? { type: "emoji", value: v } : null;
      updatePreview();
    });
    $("siteIconFile").addEventListener("change", function (e) {
      var file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      fileToIconDataUrl(file).then(function (url) {
        siteDraft.icon = { type: "image", value: url };
        $("siteIconEmoji").value = "";
        updatePreview();
      }).catch(function (err) {
        showAlert(err.message || "图片处理失败", null);
      });
    });
    $("siteIconClear").addEventListener("click", function () {
      siteDraft.icon = null;
      $("siteIconEmoji").value = "";
      updatePreview();
    });

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
  initTooltip();
  bindEvents();
  startClock();
  renderAll();
  loadState().then(function () {
    scheduleBackup();
    renderAll();
    console.log("[C-Home] app.js v5 loaded");
  }).catch(function (err) {
    console.error("[C-Home] load failed:", err && err.message);
  });
})();
