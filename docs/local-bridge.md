# 本机编辑器桥接

桥接服务把浏览器中的工程同步到本机，并接收外部工具提交的分屏更新。它不调用任何 AI 服务；可以由人工、脚本或你自行配置的 AI 工具生成更新 JSON。

## 启动与配置

先运行 `npm run build`，再运行 `npm run serve`，打开 `http://127.0.0.1:7911`。服务只绑定 IPv4 回环地址，不提供局域网访问。请使用这个地址，`localhost` 会被严格的 Host 检查拒绝。直接双击 `release/long-canvas-editor.html` 也能使用编辑器，但不会连接本机桥接。

在仓库根目录创建 `.env`，或设置同名环境变量：

```dotenv
LONG_CANVAS_PORT=7911
LONG_CANVAS_DATA_DIR=.local-data
```

环境变量优先于 `.env`；相对数据目录始终以仓库根目录为基准。脚本使用自身所在位置寻找构建产物、配置和数据，不受启动目录影响。CLI 的输入、输出文件路径则以调用者当前目录为基准。

数据目录包含 `current-project.json`、`updates/` 和 `backups/`。新建目录使用 `0700` 权限，JSON 文件使用 `0600` 权限；实际支持由操作系统决定。默认数据目录和 `.env` 均应保留在 Git 忽略列表中。自定义数据目录也不要提交进公共仓库。

## 取稿、提交、手动应用

1. 在编辑器中打开工程，等待“文件已同步”。只保留一个负责同步的编辑窗口。
2. 取出当前工程作为本次修改的基线：

   ```sh
   node scripts/background-update.mjs snapshot ./working-copy.json
   ```

   输出必须是新的 `.json` 文件。命令拒绝覆盖已有文件和目标符号链接，避免误改手动保存的稿件。

3. 根据这份基线生成一个分屏更新文件。保留未修改元素的 ID；不要把完整工程冒充局部更新。更新结构如下：

   ```json
   {
     "kind": "long-canvas-page-update",
     "schemaVersion": 1,
     "targetProjectId": "来自 working-copy.json 的工程 ID",
     "pageId": "待修改分屏 ID",
     "sourceWidth": 790,
     "title": "调整标题位置",
     "preserveLayerOrder": true,
     "removeElementIds": [],
     "elements": [],
     "assets": {}
   }
   ```

   `sourceWidth` 必须照抄目标分屏的值，未必是 790。`elements` 填入新增或替换的完整元素；`assets` 只填所需素材。省略 `height` 会保留现有分屏高度。相同素材 ID 不能指向不同素材。详细类型见 `src/types.ts` 和 `src/pageUpdate.ts`。

4. 明确提供更新文件和原始基线提交：

   ```sh
   node scripts/background-update.mjs submit ./page-update.json ./working-copy.json
   node scripts/background-update.mjs status
   ```

   可以在最后加一个由英文字母、数字、下划线或短横线组成的唯一更新 ID。对同一内容重试相同 ID 是幂等的；不同内容必须使用新 ID。

5. 编辑器发现更新后只显示提示。用户点击应用按钮后，才会修改画布、保存结果并回传状态。一次点击仅批准当前更新；刷新页面、切换工程或出现下一条更新，都不会沿用这次批准。

桥接会核对目标分屏的 SHA-256 校验值。如果取稿后用户手动改过该分屏，旧更新会被拒绝，原稿保留。其他分屏的编辑不构成冲突。需要基于新稿重做时，重新取稿并生成更新；不要仅替换基线文件来绕过冲突。提交前快照和首次同步快照保存在 `backups/`，应用后的撤销仍由编辑器负责。

## HTTP 协议

所有 API 请求都需要 `X-Long-Canvas-Bridge: 1`。涉及浏览器会话的接口还需要 `X-Long-Canvas-Client: <会话ID>`；会话租约为 10 秒，由心跳续期。请求体只接受 `application/json`，上限 128 MB，读取期限 30 秒。未完成的上传不会占用状态写入队列。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/status` | 同步状态、分屏校验值和最近更新状态 |
| `GET /api/snapshot` | 获取当前完整 JSON 快照；未同步时返回 409 |
| `PUT /api/snapshot` | 编辑器同步工程；需要会话 ID |
| `GET /api/heartbeat` | 续期同步会话；需要会话 ID |
| `POST /api/updates` | 提交 `{id, expectedPageHash, patch}` |
| `GET /api/updates/next?projectId=...` | 发现一条排队更新；需要会话 ID |
| `POST /api/updates/:id/ack` | 回传 `{state: "applied"}` 或 `{state: "rejected", error: "..."}`；需要会话 ID |

## 访问边界

服务只提供 `/`、`/editor.html` 和上述 API，不提供任意文件下载、目录浏览或路径写入接口。数据目录、备份、`.env` 和源码不作为静态资源发布。Host、Origin 和浏览器跨站请求检查用于阻止普通网页访问桥接；自定义请求头不是密码，本机进程仍属于信任范围。

本服务用于单用户本机工作，不具备多用户鉴权。不要通过反向代理、端口转发或修改监听地址把它公开到互联网。分屏内容会在浏览器应用前经过编辑器的 JSON/SVG/素材校验；服务器仅承担队列、快照和冲突检查。只有来自你信任来源的工程和更新才应进入工作流程。
