# 更新日志

<!-- 维护策略：仅详写最近 2-3 个版本，更早的压成一行摘要。完整提交历史见 git log --oneline。 -->

## v1.3.0

> 多后端存储、性能优化、设置页重构、图标自定义

### 新增

- **多后端存储并存**：IndexedDB 本地、Chrome 同步、WebDAV、GitHub Gist 四种后端可任意组合多选，数据同时写入所有勾选位置
- **IndexedDB 本地大容量**：替代 chrome.storage.local，容量从 10MB 提升至磁盘级（Chrome 下约 60% 磁盘），首次使用自动请求 `navigator.storage.persist()` 持久化
- **WebDAV 云端存储**：支持任意 WebDAV 网盘，fetch + Basic Auth，容量无墙、跨设备
- **GitHub Gist 云备份**：轻量云端备份，单文件约 1MB 限制
- **分类图标自定义**：8 种内置图标（文件夹/星/心/标签/书签/工作/书/音乐）、Emoji 输入、上传图片（canvas 等比压缩至 128×128，WebP 优先）
- **分类颜色自定义**：取色器自由选择，作用于侧边栏分类项的图标与文字
- **站点图标自定义**：自定义字母头像底色、Emoji 图标、上传图片（同样压缩至 128×128），优先级高于 Favicon
- **Chrome 同步配额预警**：用量达 80% 提前提醒，写满时引导切换存储方案，支持「今日不提示」「不再提示」
- **Toast 提示系统**：非阻断堆叠式操作反馈，5 秒自动消失，支持操作按钮（去设置/今日不提示/不再提示），最新在底部、旧的往上顶

### 优化

- **启动本地先行渲染**：快通道（sync/local）毫秒级读取立即渲染，慢通道（cloud/gist）后台竞速，按 `updatedAt` 时间戳 last-write-wins，云端再慢也不白屏
- **远端写入不阻塞 UI**：sync/cloud/gist 统一走后台防抖队列（1.5s 合并、串行、15s 超时），所有增删改拖拽操作即时响应
- **设置页标签页重构**：弹窗内左侧导航（数据存储 / 云端配置 / 备份与恢复），切换标签页时弹窗高度稳定不跳动
- **云端配置独立分块**：WebDAV 与 Gist 配置区分别按后端勾选独立显示，用户名/密码并排双列
- **设置输入防抖**：设置面板输入框 500ms 防抖合并落盘，关闭弹窗时自动 flush 防丢
- **fetch 超时保护**：所有云端请求加 15s AbortController 超时，防止服务无响应时无限挂起

### 修复

- **`state.notifyPrefs` 放置错误**：误置于 `state.settings` 内部而非 `state` 顶层，导致启用 Chrome 同步后触发配额错误时扩展崩溃
- **`saveState` 等待云端 PUT**：所有 UI 操作的 `saveState().then(renderAll)` 会同步等待网络请求完成，云端慢时操作卡顿
- **云端写失败导致渲染链断裂**：`Promise.all` 中云端 PUT reject 会让整条 `.then(renderAll)` 链不执行
- **`chrome.storage.sync.set` 未检查 lastError**：配额错误静默丢数据

### 破坏性变更

- 存储模式从单选枚举（`storageMode`）改为多选对象（`storageBackends`），旧版 `storageMode` 自动兼容映射
- 提示弹窗（`showAlert`）从阻断式 modal 改为非阻断 Toast，`callback` 参数语义变更（立即调用而非关闭时调用）

---

## v1.2.0

- 新增 Chrome 同步存储选项（local / sync / both）、`showAlert` 操作反馈弹窗、导入数据格式校验与错误提示

---

## 更早版本

- **v1.1.0** — UI/UX 全面重新设计（玻璃拟态、FLIP 拖拽、深色模式）、数据导入导出、自动备份、实时时钟问候
- **v1.0.0** — 初始版本：站点管理、分类组织、卡片网格、Chrome 新标签页替换
