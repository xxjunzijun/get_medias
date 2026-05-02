# Get Videos

一个按站点拆分处理器的 URL 下载 Web 应用雏形。

## 功能

- 输入 URL 后自动识别 Bilibili、YouTube、Pixiv。
- Bilibili：选择下载 MP4 视频或仅下载 MP3 音频。
- YouTube：选择下载 MP4 视频或仅下载 MP3 音频。
- Pixiv：下载当前页面可解析的图片资源。
- 每个下载任务会放进独立文件夹。Bilibili / YouTube 使用视频标题，Pixiv 使用作品标题；拿不到标题时会退回到任务 ID。
- 可以在网页里浏览 `downloads/` 下已下载的内容，图片会显示预览，音频和视频可以直接播放。
- 每个站点逻辑独立在 `src/providers/`，后续加新网站时新增 provider 并在 `src/providers/index.js` 注册即可。

## 运行

```bash
node server.js
```

然后打开 <http://localhost:3000>。

## Linux 私有部署

当前项目可以部署在 Linux 上，推荐先作为私有服务使用，不要直接裸露到公网。

以 Ubuntu / Debian 为例：

```bash
sudo apt update
sudo apt install -y nodejs npm ffmpeg python3 python3-pip pipx git
pipx install yt-dlp
pipx install gallery-dl
pipx ensurepath
```

重新打开终端，确认工具可用：

```bash
node --version
yt-dlp --version
ffmpeg -version
gallery-dl --version
```

拉取项目并启动：

```bash
git clone https://github.com/xxjunzijun/get_medias.git
cd get_medias
node server.js
```

然后访问：

```text
http://服务器IP:3000
```

如果部署在云服务器上，更建议用 SSH 隧道访问：

```bash
ssh -L 3000:localhost:3000 user@your-server
```

然后在本机浏览器打开：

```text
http://localhost:3000
```

Linux 服务器没有桌面环境时，Pixiv 授权里的「用系统浏览器打开」通常不可用。可以在网页里复制授权链接，用本机浏览器完成登录，再把 callback URL 或 `code` 粘回网页提交。授权成功后，`gallery-dl` 配置会写入运行服务用户的：

```bash
~/.config/gallery-dl/config.json
```

如果提交 Pixiv code 时出现 `fetch failed`，通常是服务器无法连接 Pixiv 的 OAuth 接口，或 systemd 服务没有继承代理环境变量。可以先在服务器上测试：

```bash
curl -I https://oauth.secure.pixiv.net/auth/token
```

如果服务器需要代理，systemd 服务文件里要显式加入环境变量，例如：

```ini
Environment=HTTPS_PROXY=http://127.0.0.1:7890
Environment=HTTP_PROXY=http://127.0.0.1:7890
Environment=NO_PROXY=localhost,127.0.0.1
```

修改后重载并重启：

```bash
sudo systemctl daemon-reload
sudo systemctl restart get-medias
journalctl -u get-medias -f
```

服务日志会打印 Pixiv OAuth 失败原因，包括 `fetch` 的底层 `cause` 和是否检测到代理环境变量。

生产化部署前建议补上登录鉴权、任务持久化、下载文件清理、限流，以及 systemd 或 Docker 部署配置。

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

Pixiv 下载通常需要登录态。网页里解析 Pixiv URL 后，可以在 Pixiv 授权卡片里启动 `gallery-dl oauth:pixiv` 流程。

也可以在终端手动运行：

```bash
gallery-dl oauth:pixiv
```

按终端提示登录 Pixiv 并授权后，`gallery-dl` 会保存 refresh token，之后网页里的 Pixiv 下载任务就能复用这个登录态。

Safari 在 Pixiv 授权后可能提示“网址无效”。这通常是正常的，复制地址栏或 Network 面板里包含 `code=` 的 callback 地址，再粘贴回网页即可。

如果 Safari 跳转后 Network 记录消失，需要在点击「继续使用此账号」前启用 Network 面板里的 Preserve Log / 保留日志。也可以复制网页里的授权链接到 Chrome 或 Edge，打开 DevTools Network 并勾选 Preserve log 后重试。

## 扩展新网站

1. 在 `src/providers/` 新增一个文件。
2. 导出带有 `matches(url)`、`describe(rawUrl)`、`createDownloadPlan(input)` 的 provider。
3. 在 `src/providers/index.js` 中加入 `providers` 数组。
