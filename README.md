# 旅行手账（GitHub Pages 版）

这是适合手机浏览器的静态旅行手账。网站代码公开发布到 GitHub Pages；私人行程、照片和备份保存在设备的 IndexedDB 中，不提交仓库。应用不收集 API Key，不自动调用模型，不包含付费云资源。

## 使用方法

1. 打开手机网址，可先查看河北美院历史示例（仅为计划，没有实际游玩记录）。
2. 点击“新建”，填写地址、时间、交通方式与偏好，生成并复制攻略请求。
3. 在自己使用的 AI 聊天中粘贴请求，让 AI 搜索核实后返回 JSON。
4. 返回网页导入结果，核对时间与取舍，确认才保存。
5. 旅行中可以手动编辑、重排、锁定，或者复制调整请求后导入新方案。
6. 在“保存与备份”导出完整 JSON 备份，再导入另一台设备即可迁移。

首次联网打开并完成离线资源准备后，可以离线打开、查看和编辑。高德关键词搜索、外部来源、AI 聊天仍需网络。手机系统浏览器可以添加到主屏幕；微信内置浏览器和系统浏览器各自保存数据。

照片每张最多 3 MiB、每篇最多 12 张；备份 v2 对相同图片去重，兼容导入旧 v1 备份。保存最多 40 个版本，超出后淘汰最早版本。导出备份总量上限 128 MiB，超过时会提示整理，避免产生无法恢复的备份。

页面本身公开访问，任何访客只会看到脱敏示例和他们自己的本机数据。当前版本不提供账户登录、跨设备自动同步、服务器分享链接或网站内自动 AI 生成。

## 本地预览

需要 Node.js 24 和 npm。在本目录运行：

```sh
npm ci
npm run dev
```

发布前运行 `npm run build`，确认 `dist/` 构建成功。`dist/` 是构建产物，不需要提交。

## 发布到 GitHub Pages

1. 在自己的 GitHub 账号中新建一个**公开**仓库，例如 `travel-notebook`，仓库只存放本目录的网站代码。
2. 将本目录代码推送到该仓库的 `main` 分支。不要推送个人行程、导出的数据文件、照片、API Key 或 `.env` 文件。
3. 打开仓库的 **Settings → Pages**，在 **Build and deployment → Source** 选择 **GitHub Actions**。
4. `.github/workflows/pages.yml` 会在每次推送 `main` 后运行 `npm ci`、`npm run build` 并发布 `dist/`。也可以从 Actions 页面手动运行。
5. 发布地址通常是 `https://<GitHub 用户名>.github.io/<仓库名>/`。首次发布后，以 Pages 设置页显示的网址为准。

项目站点位于网址子路径。Vite 配置应使用相对 `base: './'`，页面内部导航应使用 hash 路由或保持单页，以便刷新后仍能打开。离线缓存的 service worker 也应使用相对路径和当前站点作用域。

GitHub Pages 提供公开的静态网页，**不提供私人登录、服务端数据库或私有 API**。设备本地保存的攻略不会自动同步到其他设备；请使用应用内导出功能自行备份。清理网站数据、卸载浏览器或使用无痕模式可能丢失数据。将来需要跨设备同步或真正的账户访问控制时，需增加独立后端。

## 部署依据

- [GitHub：配置 Pages 发布源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub：使用自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Vite：部署静态网站](https://vite.dev/guide/static-deploy.html)
