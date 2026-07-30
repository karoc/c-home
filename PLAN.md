# PLAN — 大容量存储多选项并存改造

> 状态日期：2026-07-30。本文件为当前活跃工作线程的源真相，编辑前必读。

## 目标

当前存储方案容量小（`chrome.storage.local` ~10MB、`sync` ~100KB），无法满足大数量存储。
在保留现有 local/sync/both 选项的前提下，新增"大容量"选项，多选项并存。

## 已确认的方案（主流 / 经过实践 / 符合趋势）

证据：MDN《Storage quotas and eviction criteria》(2026-01 更新)、《IndexedDB API》。

- **本地大容量 = IndexedDB**：Chrome/Chromium 下配额为总磁盘 60%（1TB≈600GB），
  支持索引/事务/blob，是 Web 与扩展大容量结构化存储的官方推荐。采用极简 idb-keyval
  风格内联封装（~零依赖，契合本项目风格）。
- **持久化**：`navigator.storage.persist()`，Chrome 按使用频率自动批准、无弹窗，避免 LRU 回收。
- **跨设备大容量 = WebDAV**：用户自有网盘，无配额墙，fetch + Basic Auth。
- **轻量云备份 = GitHub Gist**：单文件 1MB 软限/总量 100MB，仅作轻量备份，不属"大容量"。
- `chrome.storage.sync`（100KB）保留为小数据跨设备同步。

## 存储模式（多选 backend，任意组合并存）

`state.settings.storageBackends = { local, sync, cloud, gist }`，各为 bool，可任意组合（至少一个）。

- **写入**：IndexedDB 同步等待（毫秒级）；sync/cloud/gist 走后台防抖队列（1.5s 合并、串行、失败 toast 一次），全量快照写所有勾选远端，不阻塞 UI。
- **读取**：快通道 `sync -> local` 先渲染；云端 `cloud -> gist` 后台竞速，按数据内 `updatedAt` 时间戳 last-write-wins——云端更新则应用并重渲染（保留原时间戳回写收敛，避免多设备盖戳乒乓），更旧则本地回写云端自愈。仅本地为空（新设备）才同步等待云端。都空则 `initDefaultData`。
- **旧数据迁移**：所有启用后端都空时，回退查旧版位置 `chrome.storage.local[STORAGE_KEY]` 与 `sync[STORAGE_KEY]`，找到即迁到当前后端并写入，避免旧用户数据"消失"。
- **向后兼容**：读取旧 settings 的 `storageMode` 字符串（local/sync/cloud/gist/both）自动映射为 `storageBackends`；`both` -> {local, cloud}。
- 云端凭证（WebDAV/Gist）存 `chrome.storage.local[CLOUD_CONFIG_KEY]`，经设置面板配置；仓库内 `config/settings.json` 仅为开发参考模板，扩展运行时不读取。

| backend | 实现 | 容量定位 |
|---|---|---|
| `local` | IndexedDB（idb-keyval 风格内联封装） | 大（磁盘级，Chrome 60% 磁盘） |
| `sync` | chrome.storage.sync | 小（100KB）跨设备 |
| `cloud` | WebDAV（fetch + Basic Auth） | 大（用户网盘）跨设备 |
| `gist` | GitHub Gist API | 轻量云备份（~1MB） |

## 执行顺序与边界

1. app.js：IndexedDB 封装 + persist + WebDAV/Gist get/put + cloudConfig 读写。
2. app.js：**多选 backend 重构** -- `storageMode` 枚举 -> `storageBackends` 对象；读取优先级 cloud->gist->sync->local；旧版 `storageMode` 兼容映射；旧数据迁移层（chrome.storage.local/sync -> 当前后端）。
3. newtab.html：存储位置 radio -> 4 个 checkbox（多选）+ WebDAV/Gist 配置区。
4. manifest.json：加 `host_permissions:["<all_urls>"]`；版本->1.3.0。
5. README.md：更新数据存储说明为多选并存 + 迁移说明。
6. 校验：语法/ID/函数一致性；各后端读写、多选组合、旧数据迁移。

## 验证与验收证据

- 静态：`node --check js/app.js` 通过；`manifest.json` JSON 合法；newtab.html DOM ID 齐全；
  函数均已定义且被调用；storageBackend checkbox 值与 JS 一致（local/sync/cloud/gist）。
- 运行时（待人工在 Chrome 加载扩展确认）：
  - 旧版用户升级：`chrome.storage.local` 旧数据自动迁到 IndexedDB，不丢失。
  - 多选组合（如 local+cloud）写入两侧；启动本地先渲染，云端较新数据后台到达后自动换上。
  - cloud/gist 配置后读写；`navigator.storage.persisted()` 为 true。
- 修复了未提交代码中缺失的 idbKeyval*/performWebdav* 函数导致的 ReferenceError。

## 风险与回退

- `<all_urls>` host 权限较宽，未来若上架商店可改 `optional_host_permissions` 按需请求。
- WebDAV 服务器若目录不存在，PUT 可能失败 → 通过 alert 提示，不静默丢数据。
- IndexedDB best-effort 模式下极端磁盘压力可能被 LRU 回收 → 已加 persist 缓解。

## 未完成 / 后续

- `optional_host_permissions` 化（降低权限面）。
- 云端写入失败的统一重试/退避。
- 数据量超 Gist 限制时的分片（当前仅轻量备份定位，不做）。
