# Long Canvas · 长图编辑器

一个在本机运行的连续长画布编辑器，用来手动调整电商详情页、长海报和多分屏视觉稿。

把多屏内容放在同一张画布上，直接调整文字、图片、图层、留白和衔接。工程保存为包含素材的 JSON，图片导出为 PNG 或 SVG。可选的本机协作服务允许脚本提交局部改稿，由设计者点击确认后应用。

**Local-first long-form design editor** built with React, TypeScript and SVG. Edit connected sections, save portable project files, and export a complete long image. The optional local revision bridge queues section updates for explicit approval inside the editor.

只想直接使用？到 [Releases](https://github.com/zzf-love/long-canvas-editor/releases/latest) 下载 `long-canvas-editor.html`，用桌面浏览器打开即可。不需要解压或安装 Node.js。

## 功能

- 连续长画布与分屏导航；元素可以跨分屏移动、复制和粘贴。
- 编辑文字的字号、行高、字距、字重和颜色；导入 PNG、JPEG、WebP 图片。
- 图层排序、隐藏、锁定、不透明度、链接选择及整体移动缩放。
- 参考线、标尺、吸附、多选对齐、等距分布和分屏高度调整。
- 撤销与重做、浏览器自动保存、完整工程 JSON 导入导出。
- 当前屏 PNG、完整长图 PNG、当前屏 SVG 导出。
- 可选本机文件镜像、局部改稿队列、冲突校验和手动应用。
- 构建时生成单文件 HTML，可用于离线编辑。

仓库内置三个原创通用示例分屏。没有客户工程、商业品牌素材或设计交付文件，也不包含字体文件。

## 快速开始

需要 **Node.js 22.22.2+（22.x）或 24.15.0+（24.x）**、npm 和桌面浏览器。

```sh
git clone https://github.com/zzf-love/long-canvas-editor.git
cd long-canvas-editor
npm ci
npm run build
npm run serve
```

打开 **http://127.0.0.1:7911/**。首次进入显示示例工程，之后优先恢复当前浏览器的自动存档。

开发模式：

```sh
npm run dev
```

打开 http://127.0.0.1:7910/。开发服务器用于界面开发，不提供文件镜像和改稿 API；要使用完整协作流程，请构建后运行 `npm run serve`。

离线使用：构建后打开 `release/long-canvas-editor.html`，无需继续运行 Node.js。不同浏览器或访问地址的自动存档互相独立；切换前先保存工程 JSON。

## 基本使用

1. 在左侧选择分屏，在画布或右侧图层列表中选择元素。
2. 拖动调整位置；双击文字或在属性栏修改。多选后可以对齐、链接或批量调整透明度。
3. 使用“调节底边”或属性栏调整分屏高度，后面的分屏自动顺移。
4. 用“保存工程”保存可继续编辑的 JSON；用“导出图片”交付 PNG 或 SVG。

常用快捷键：`⌘/Ctrl+S` 保存，`⌘/Ctrl+Z` 撤销，`⌘/Ctrl+Shift+Z` 重做，`⌘/Ctrl+C/X/V` 复制／剪切／粘贴，`⌘/Ctrl+D` 复制当前选择。方向键移动 1 px，配合 Shift 移动 10 px；拖动时 Alt 暂停吸附。

更多说明见 [使用指南](docs/usage.md)；脚本协作见 [本机协作协议](docs/local-bridge.md)。

## 保存位置与边界

- 浏览器自动保存使用 IndexedDB；不是云端备份。长期保存请下载完整工程 JSON。
- 本机协作服务默认在 `.local-data/` 保存镜像、备份和待应用更新，此目录已被 Git 忽略。
- 服务只绑定 `127.0.0.1`，检查 Host、来源及自定义请求头。它面向可信的本机用户和脚本，不是可直接部署到公网的多人服务器。
- 当前画布固定宽度 **790 px**；分屏高度可调。适合桌面排版，手机可用来查看导出的图片。
- 图片中的像素文字不能逐字编辑；本工具不提供抠图、像素修图或 PSD 导入导出。
- 字体使用本机字体，优先苹方及系统中文无衬线字体。跨系统的字宽、换行可能不同。
- 默认单张图片上限 20 MB、工程上限 128 MB；PNG 导出最长边 32760 px、总像素上限 3200 万，仍受浏览器可用内存影响。

## 开发与验证

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

测试覆盖几何布局、跨屏导出、图层链接、透明度、复制粘贴、SVG 导入校验、本机协作及浏览器核心流程。CI 使用同样的构建和测试入口。

```text
src/                    编辑器、SVG 渲染、工程数据和交互逻辑
public/seed-project.json 通用示例工程
scripts/                单文件构建、本机服务和改稿 CLI
tests/                  单元与集成测试
e2e/                    浏览器流程测试
docs/                   使用与本机协作文档
```

## 贡献与许可证

欢迎提交 Issue 和 Pull Request。请先阅读 [贡献指南](CONTRIBUTING.md)。

代码及仓库自带的原创示例采用 [MIT License](LICENSE)。依赖保留各自的许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。
