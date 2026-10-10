# 技术决策记录

研究日期：2026-10-10。

## 选择：一种 CDP 原生引擎

使用 `chrome.debugger` 连接目标标签页，通过 `Page.captureScreenshot({format:'png', fromSurface:true, captureBeyondViewport:false})` 捕获真实浏览器像素。短回答只捕获一次。长回答滚动其真实祖先容器，逐片裁切、无缩放复制到 Canvas。Canvas 只处理已有截图像素，不绘制 DOM。

未选择 `captureVisibleTab`：该方法需要 `<all_urls>` 或已激活的 `activeTab`；注入到网页的按钮点击不属于官方列举的扩展 action、快捷键、菜单、omnibox 等授权入口。要求用户额外点击工具栏才能授权会增加默认流程步骤，全站权限不合理。该接口还有每秒两次的调用限制。

CDP `captureBeyondViewport:true` 对普通文档可截取文档外区域，但不能使内部 `overflow:auto` 中不可见的子内容自动展开。ChatGPT 常有内部滚动容器，因此同一引擎以原生可视片段为通用路径。没有使用 Emulation 修改设备指标，也没有放大正文或创建新的 HTML 排版。完整可见回答本身就是单次原生捕获。

代价：`debugger` 是较宽的敏感权限，安装与捕获时会有 Chrome 提示；与 DevTools 或其他调试器可能冲突。Chrome 118 起活动 debugger 会话保持 Service Worker 存活，因此最低版本设置为 118。每个任务有 120 秒取消期限，后台有额外 5 秒释放租期，不长期保留调试器。

## 站点适配与几何

优先查找 `data-message-author-role=assistant`，回退 `data-role=assistant` 与 `data-testid=assistant-message`，并过滤嵌套角色节点。这些都是兼容性线索，而非官方契约。目标是整个角色元素，保留其富内容，不只取第一个 Markdown 节点。新版渲染器使用 `data-talvt-turn-state` 和助手屏幕阅读器标题；同一 turn 还包含用户提问与思考，因此只取角色标题后的正文。操作区域优先正文之后的语义 toolbar、turn-action-controls、已知原生复制按钮父元素；无法找到时在正文之后放置独立图标。

滚动祖先从目标向外寻找具有真实纵向 overflow 的元素，再加入根滚动元素；实际可见矩形还要和所有裁切祖先、viewport 求交。移动量从内向外分配，读取实际 `scrollTop`，容器到底时把剩余移动分配给外层。保留原始横向滚动位置。

输出左右保留最多 8 CSS px 的原网页背景，并受真实容器边界限制。正文全部宽度若不可见则停止，不默默切掉正文。上下边界取目标角色元素的真实布局边界，保留属于它的内边距。

每片以实际返回位图的 `width / innerWidth` 和 `height / innerHeight` 校验像素密度。没有把 `devicePixelRatio` 直接当截图尺寸，也不把低分辨率位图插值放大。物理 x 裁切范围在首片固定，后续必须一致。纵向用 `round(target.top * scale)` 作为目标局部原点，已覆盖游标以整数物理像素计数，下一片只复制未写入行。`ceil(safe.top * scale)`、`floor(safe.bottom * scale)` 保证源像素在有效区域内；出现空缺或无进展则停止。

每片记录并检查实际目标矩形、viewport、revision 和 scale。源、目标的复制宽高完全一致，关闭 image smoothing。没有通过视觉相似度猜接缝。分段输出也是同一连续游标，跨 PNG 边界的行不会重复。

## 稳定性、干扰与恢复

捕获前等待 `document.fonts.ready` 和每张已存在图片的 decode。临时设置已有图片为 eager 加载；finally 恢复原属性。以连续几次几何/滚动值一致和至少 200ms 无目标 DOM 更新作为稳定条件，最多等 5 秒；字体图片单项最多 10 秒，总任务最多 120 秒。

初次接入调试器后重新测量视口；若提示条改变正文宽度或高度则停止。截图期间目标 MutationObserver（仅忽略新版渲染器非视觉记录 data-dil-message-id）、几何变化、路由、页面连接状态、焦点、窗口大小、像素密度都受检查。不把异步变化造成的不同片段拼成伪完整回答。

MutationObserver 与几何检查无法检测视频、GIF、Canvas 内部自行变化的像素。此类内容须先暂停，分片不能承诺同一时刻的动态画面。完整页面导航会销毁 content script，因此后台另通过 tabs.onUpdated 的 loading 事件主动断开会话，避免调试器跟随标签页进入新文档。

临时用 `visibility:hidden !important` 隐藏扩展按钮和目标之外的 fixed/sticky 浮层及 tooltip，保持占位尺寸。新版相对定位 composer、绝对定位 thread footer 背景与返回底部按钮按语义属性额外排除。不会隐藏目标、其祖先或内部组件。内部 sticky 顶部覆盖带在后续片中作为不可用区域避开；自然位置的标题应在之前的片中完整保留。负数 sticky inset 仍可能留下实际可见的标题带，按其真实矩形而非负偏移阈值裁剪。进度提示保持可见，按其实际矩形从每片底部可用范围中排除，不改变正文布局；捕获时取消提示阴影，避免阴影像素越过排除边界。复杂悬浮布局仍需真实页面核验。

每项临时 CSS 属性保存原值及 important 优先级，只恢复被修改的属性，避免覆盖网页其他并发更新。finally 释放 Canvas、ImageBitmap 和调试会话，等待 Chrome 移除调试提示条后的视口稳定，再恢复所有滚动、属性和图片 loading；否则底部 scrollTop 可能被提示条的异步消失再次夹紧。取消使用 AbortController，Esc 可操作；浏览器原生截图 API 不可中断，会等待该次响应后停止，不会继续写剪贴板。

## 剪贴板与输出

content script 调用 `navigator.clipboard.write([new ClipboardItem({'image/png':blob})])`，在持有 `clipboardWrite` 权限且页面有焦点时异步写入。严格 await，reject 不提示成功。没有假设 Offscreen Document 能自动复制 PNG。

失败和多 PNG 结果留在页面内存，用户可主动打开扩展预览。预览按 1 MiB 消息分块转移，避免 Chrome JSON 消息大小限制。后台数据仅短暂保留，预览取完即移除，待取数据最多五分钟或随 SW 休眠丢弃；页面仍可重新发送原结果。预览独立持有本地 Blob，关闭/清除后 revoke，刷新不恢复旧截图。PNG 保存采用 Blob URL 的下载链接，不申请 downloads 或持久存储权限。

单 Canvas 最多 2400 万像素、8192 高，驻留一个画布和一个分片位图；完成一段即转 PNG 并释放画布。总输出最多 1.92 亿像素、16 张、64 MiB 编码数据。PNG/base64 仍有内存开销；预算不代表所有设备都能分配到上限，编码失败会明确报错。

## 参考项目与许可证

- [Long Region Screenshot](https://github.com/massu-heisenberg/long-region-screenshot)，研究提交 `2d0f51b985932c3cc611783d96c0ee4f344a5d83`。已读 README、content.js、service-worker.js、manifest。采用最大 overflow 容器、调试器连接后测量、CDP 分片、整张 OffscreenCanvas；固定延时、超大 Canvas 与整容器范围不满足本项目全部要求。源码还把原生返回比例转换到输出 DPR，存在重采样可能。本项目用实际位图像素密度且 1:1 拷贝，限定单条回答，增量分段。
- [Chat Longshot](https://github.com/Garonix/AiChat_Longshot)，研究提交 `ed426d058564078ef2fbe93f639d6ce698f2ee98`。已读 README、manifest、background.js 与定位/滚动/拼接的 content-script.js。工具栏 invocation 获得 activeTab，用户选择一个或两个范围，captureVisibleTab 560ms 节流，导出 JPG/多图/PDF，隐藏较多平台元素。其范围选择、格式与权限流程不适合本项目的一键单回答 PNG。

两个提交均未找到 LICENSE 文件或 README 中明确授权说明；不能假定无许可证源码可以复制。本项目独立编写，没有移植第三方源码、图标或样式。开发/测试依赖的许可证以各包自身 LICENSE 为准，运行时产物不包含这些测试工具或 KaTeX。

## 官方资料

- [activeTab 与授权手势](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [captureVisibleTab 的权限和频率](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)
- [chrome.debugger、onDetach、受支持 CDP 域](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [Page.captureScreenshot 协议](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot)
- [Service Worker 生命周期与 Chrome 118 debugger 保活](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [扩展中的 Clipboard API 与 clipboardWrite](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard)
- [Clipboard.write 完成语义和 PNG 类型](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write)
