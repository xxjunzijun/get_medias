# Get Videos

一个按站点拆分处理器的 URL 下载 Web 应用雏形。

## 功能

- 输入 URL 后自动识别 Bilibili、YouTube、Pixiv。
- Bilibili：选择下载 MP4 视频或仅下载 MP3 音频。
- YouTube：选择下载 MP4 视频或仅下载 MP3 音频。
- Pixiv：下载当前页面可解析的图片资源。
- 每个站点逻辑独立在 `src/providers/`，后续加新网站时新增 provider 并在 `src/providers/index.js` 注册即可。

## 运行

```bash
node server.js
```

然后打开 <http://localhost:3000>。

## 下载依赖

后端会调用本机命令行工具：

```bash
brew install yt-dlp ffmpeg gallery-dl
```

或使用 Python 工具安装：

```bash
pipx install yt-dlp
pipx install gallery-dl
```

Pixiv 下载通常需要登录态，建议按 `gallery-dl` 文档配置 cookies 或账号认证。

## 扩展新网站

1. 在 `src/providers/` 新增一个文件。
2. 导出带有 `matches(url)`、`describe(rawUrl)`、`createDownloadPlan(input)` 的 provider。
3. 在 `src/providers/index.js` 中加入 `providers` 数组。
