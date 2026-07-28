# C-Home 启动页

自定义 Chrome 新标签页，支持站点管理、分类组织、拖拽排序，自动适配深色模式。

## 功能

- **站点管理** — 添加、编辑、删除常用站点，自动获取站点图标（Favicon），失败回退到字母头像
- **分类组织** — 创建分类对站点分组，支持重命名、删除，删除分类时站点自动迁移到默认分类
- **拖拽排序** — 站点卡片和分类列表均可拖拽调整顺序
- **实时时钟** — 显示当前时间，根据时段自动切换问候语（早上好/下午好/晚上好/夜深了）
- **站点搜索** — 在当前分类下按名称或地址搜索站点
- **深色模式** — 跟随系统 `prefers-color-scheme` 自动切换
- **数据持久化** — 使用 Chrome Storage API 存储，关闭页面不丢失

## 安装

1. 打开 Chrome，进入 `chrome://extensions`
2. 开启右上角"开发者模式"
3. 点击"加载已解压的扩展程序"，选择本项目目录
4. 打开新标签页即可使用

## 项目结构

```
c-home/
├── manifest.json      # Chrome 扩展清单
├── newtab.html        # 新标签页入口
├── css/style.css      # 样式（含深色模式）
├── js/app.js          # 应用逻辑
├── AGENTS.md          # AI 代理规则
└── .claude/CLAUDE.md  # Claude 配置
```

## 技术栈

纯原生 JavaScript，无外部依赖。使用 Chrome Extension Manifest V3。