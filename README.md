# 日志查看器

一个小程序/小游戏日志查看器插件：抓逻辑层与渲染层的 console、未捕获异常、页面路由、网络摘要和 Storage 写入，面板内过滤、搜索、复制、导出；内置可选的 vConsole 视图。

> 第三方插件，非 WeAppDev 官方项目。

## 能力

- 逻辑层 console：log / info / warn / error / debug / dir / table / trace / assert / time / timeEnd，支持 `%s %d %i %f %o %O %j %c` 格式符。
- 渲染层 console 与 window error / unhandledrejection（小程序有 WebView 时）。
- 逻辑层 `wx.onError` / `wx.onUnhandledRejection`。
- 页面路由标记、网络摘要（默认关闭）、Storage 写入（默认关闭）。
- 缓冲区默认 3000 条，批量 250ms 推送到面板；面板关闭期间日志仍在逻辑层内存里，重开面板会补拉。
- vConsole 3.15.1（MIT）作为可选视图：点「vConsole」按钮后，把已抓到的日志喂给 vConsole 的 Log 面板。
- vConsole 脚本约 286KB，超过宿主单内联脚本 256KB 的上限，所以放在 zip 的 `assets/vconsole.min.js`，面板用 `wadPanelLayer.assets.script()` 按需加载。

## 安装

- 推荐：用 `log-viewer.zip` 在「插件 → + → 选择文件 / zip」安装。zip 内含 `assets/vconsole.min.js`，vConsole 按钮可用。
- 单文件：把 `log-viewer.html` 粘贴到「+ → 粘贴 HTML」。内置日志查看器可用，但单 HTML 没有资产目录，vConsole 按钮会提示改用 zip 安装。

### 远程安装（GitHub）

如果客户端只支持远程 URL，用下面任意一个：

- Release zip（推荐）：`https://github.com/1045290202/weappdev-log-viewer/releases/download/v1.0.8/log-viewer.zip`
- Raw zip：`https://raw.githubusercontent.com/1045290202/weappdev-log-viewer/main/log-viewer.zip`
- 单文件 HTML（无 vConsole）：`https://raw.githubusercontent.com/1045290202/weappdev-log-viewer/main/log-viewer.html`

## 使用

打开小程序 → 右上角「⋯」→ 插件 → 启用「日志查看器」→ 打开面板。点「设置 → 测试日志」可以验证 hook 是否生效。

## 限制与注意事项

- 插件逻辑层/渲染层注入依赖调试通道；关闭调试后面板仍可打开，但 logic/render 不工作。
- console hook 在插件注入时安装；注入前已经执行的启动日志可能抓不到，这类日志请用 Chrome DevTools 看。
- 业务代码如果提前缓存了 `console.log` 的引用，或日志由 native/WASM 直接输出，hook 抓不到。
- 渲染层只在小程序里有 WebView；小游戏是 canvas，没有渲染层日志。
- 宿主对单个内联脚本有 256KB 上限；本插件所有内联脚本都低于该值，vConsole 走 zip 资产（单资产上限 4MB）。
- 单条总线消息有 200KB/256KB 限制，插件按 60KB/30KB 分批；每条日志文本与调用栈会截断。
- 面板重开或恢复时最多补拉最近 1500 条日志，避免一次性拉爆总线；更早的日志请及时导出。
- 「暂停」只冻结内置列表，采集和 vConsole 视图仍继续更新。
- 插件重注入/切换小程序时按 sessionId 隔离；旧会话延迟到达的批次不会混入新会话。
- 日志可能含 token、手机号等敏感信息，本插件不上传任何数据；导出前请自行确认。
- vConsole 只能看到它所在面板 WebView 的 console；逻辑层日志是本插件 hook 后转发进去的。vConsole 的 System/Network/Element 面板对小程序无意义，已关闭。

## 开发

```bash
node build.mjs   # 生成 log-viewer.html、README.md、dist/ 和 log-viewer.zip
node verify.mjs  # Node mock 测试逻辑层/渲染层采集
```

`assets/vconsole.min.js` 是 vConsole 3.15.1（MIT），由面板按需加载。

## 版本

1.0.8 — debugger 不存在时也自动输出 [lv] bridge error · debugger unavailable。
1.0.7 — 自动把桥接成功/失败原因打到日志列表（[lv] bridge），并把 render 不可用提示改成可读文案。
1.0.6 — 自动在每个 V8 上下文打一条 console 探针并在面板输出 captured / NOT-captured；面板打开时自动记录 render 的 webView/canvas 状态。
1.0.5 — 增加 Cocos `cc.log` / Egret `egret.log` 引擎 logger 桥接，与 console 自动去重；探测增加 cc/egret 全局对象字段。
1.0.4 — 桥接扩展为所有有 console 的 V8 上下文，探测上下文同时返回渲染层 page/targets/dom（web-view/canvas）。
1.0.3 — 增加 console 自检、V8 上下文探测与 GameGlobal 小游戏 console 桥接，修复小游戏业务日志不在插件上下文时抓不到。
1.0.2 — 增加逻辑层 hook 自愈与面板 3 秒轮询补拉，修复长时间运行后日志突然中断；面板过矮时整面板滚动。
1.0.1 — 面板改为视口固定布局，修复浮窗/短面板内无法滚动；vConsole 改为 zip 资产按需加载。
1.0.0 — 初版。
