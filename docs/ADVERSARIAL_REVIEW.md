# 对抗审查与修复

日期：2026-10-11（Asia/Shanghai）。审查基线：`a4d210fadb05f39d2fa5f0cc050ba28ae87de31a`。

启动了截图保真度、安全/权限、交互/可访问性三个独立 agent。安全与交互 reviewer 交叉复现了下列竞态，截图 reviewer 提供了动态像素风险线索；三个 agent 随后因账号用量限制中断，未完成全面审查。主 agent 独立复核代码、补充可控异步回归，并执行修复后的隔离浏览器测试。下列结论仅覆盖已有证据。

## 已修复

| 优先级 | 触发与影响 | 修复与证据 |
| --- | --- | --- |
| P2 | 调试器连接尚未返回时页面导航，旧清理逻辑提前丢弃会话；随后连接成功，调试器暂时无人管理。并发结束可能重复断开；断开失败也可能丢失会话记录。 | `src/background.ts` 保留会话直到连接和断开完成；合并并发清理，断开失败保留占用供后续重试。4 项回归覆盖导航/连接交错、重复结束、断开失败重试、连接拒绝后的恢复。 |
| P2 | 预览正在接收元信息或分片时点击清除，迟到响应可再次显示图片；已经提交的复制结束后还会把“已清除”改成“已复制”。 | `src/preview.ts` 用加载代次拒绝过期响应；清除后不创建 Blob URL、不恢复图片、不覆盖清除状态。4 项回归覆盖上述时序及迟到错误。 |
| P2 | 真实 Chrome 中 Chat Navigator 的静态 host 内含 fixed Shadow DOM 浮层，原扫描仅检查普通 DOM，浮动导航被重复拼入长图。 | `src/page-state.ts` 检查无关 host 的开放 Shadow DOM（含嵌套），临时将含浮层的 host 透明，结束恢复原样式；保留正文组件和进度提示。独立夹具在修复前检出 96783 个差异像素，覆盖显式 visibility 子项与正文 Shadow DOM 组件。 |
| P3 | 截图已经完成、系统正在写入剪贴板时，截图用的 Esc 监听和超时仍生效；此时 Clipboard API 已无法取消，输入拦截与真实状态不一致。 | `src/content.ts` 在提交剪贴板前移除截图取消监听及计时器，继续显示“正在复制到剪贴板”。2 项回归确认截图中仍能取消且不写入，进入写入阶段后不拦截 Esc、不触发截图超时。 |

## 验证

- `npm run check`：严格类型检查、15 项测试（5 项几何/预算、10 项竞态）、生产构建全部通过。
- `AUDIT_BASELINE=a4d210f node --import tsx --test tests/races.test.ts` 将相同 10 项竞态测试用于修复前源码：8 项失败、2 项通过；修复后 10 项全部通过。没有放宽断言。
- `EXTRA_ONLY=1 DPRS=1 npm run test:e2e`：9 项通过，含取消、清理时取消、动态内容、生成中拒绝、SPA/整页导航、调试器断开、窗口变化、第二条回答及来源边界。记录：`artifacts/results-audit-lifecycle.json`。
- `DPRS=1 CASES=short,split npm run test:e2e`：5 项通过，含短图、两张分段 PNG、剪贴板拒绝后预览复制/保存，以及 125% 缩放。5 项与独立原生参考的差异像素、平均差异、最大差异均为 0。记录：`artifacts/results-audit-positive.json`。
- `DPRS=1 CASES=shadow_overlay,rich,renderer_role,sticky_negative npm run test:e2e`：浮层修复后 9 项通过，覆盖嵌套 Shadow DOM 浮层、正文 Shadow DOM、显式 visibility 子项、样式恢复、富内容/内部滚动/浅深主题/125% 缩放、新版操作区和负数 sticky 标题；视觉差异全部为 0。修复前后记录：`artifacts/results-audit-overlay-before.json`、`artifacts/results-audit-overlay-after.json`。
- `npm run package`：重新生成生产 `dist/` 和 `release/chatgpt-native-longshot-0.1.0.zip`。
- 几何与拼接实现本轮未改动，因此没有重复全部视觉矩阵。上一轮内部滚动深色 rich 首次出现的 2 个差异像素及后续复测情况仍保留在 `docs/TESTING.md`，没有将它改写为全矩阵无条件通过。

竞态测试运行真实协调源码，在 VM 中控制 Chrome API、加载响应和剪贴板 Promise 的完成顺序；它们不等同于操作系统级故障注入。浏览器回归真实加载测试版扩展，使用原生截图和真实 PNG 剪贴板/预览传输。

## 真实 Chrome 验收

用户安装的扩展 `bhkdeloeklfhpembebaiohpoaiakmicd` 已重新加载本项目 `dist/`，并刷新当前 ChatGPT 页面。在「数学答疑」中点击最后一条已完成回答，观察到“长图已复制”，用 macOS「预览」从剪贴板新建图片并保存。`artifacts/real-chatgpt-audit-before.png`、`artifacts/real-chatgpt-audit-after.png` 均为 2153 × 5088；修复后重复的 Chat Navigator 导航不再出现，中文、表格、图示与简单数学表达式保留。结束后页面的 Previous prompt / Conversation minimap / Next prompt 已恢复，调试提示条消失。

此项是实际剪贴板粘贴与视觉检查，没有对真实站点整张图建立独立逐像素参考，也不代表所有复杂公式或嵌入组件已通过。实际图片留在被 Git 忽略的 `artifacts/` 中。

## 后续有价值的优化

1. **动态视觉变化检测**：当前主要观察目标 DOM 与几何，CSS 动画或祖先主题变化可能只改变像素。视频/GIF/Canvas 已属明确限制；可进一步建立 CSS 动画和祖先主题切换夹具，验证后增加暂停导出的保护。此项未形成完整像素复现，本轮未扩大拦截范围。
2. **预览加载中清除时立即通知后台释放**：目前前台已阻止复活并释放已创建的 Blob；尚未取完的后台分片仍按关闭标签页、后续请求过期清理或 service worker 生命周期回收。可增加来源校验的显式释放消息，缩短内存保留时间。它不涉及持久存储或网络上传。
3. **跨应用粘贴验收**：已验证 PNG 剪贴板及 macOS 预览，仍需在用户常用的 Obsidian/微信直接粘贴验收。复杂嵌入组件也应分别核验，不能以本地 KaTeX 夹具替代真实站点。

浮层识别只能检查开放的 Shadow DOM；封闭 Shadow DOM 和跨域 iframe 内部仍不能直接检查，遇到遮挡需单独核验。

本轮没有增加权限、运行时网络请求或遥测。生产扩展仍只申请 debugger 和 clipboardWrite，并限定两个 ChatGPT 域的顶层消息来源。

## 第二轮：体验优化（2026-10-11）

基线 `30dfee9`。三路 reviewer 分别从操作流程、多图预览和异步恢复进行审查，并交叉核对触发条件。确认并修复：

1. 剪贴板尚未写完时，其他回答按钮可点击并清掉进度。现在忙碌时保留原反馈，统一禁用所有截图按钮，包括期间新插入的按钮，结束后恢复。
2. 预览准备期间可以开始新截图，旧预览完成/失败会覆盖新任务提示。现在准备预览也占用同一忙碌状态，显示转圈及“正在准备预览…”，失败后保留重试入口。
3. 第二张及后续图片的复制结果只出现在屏幕外的页顶，不同图片还能同时写入剪贴板。现在每张图片旁显示带编号的进度和结果，共享单次写入保护，并为复制/保存添加含编号的无障碍名称。

验证：`npm run check` 的 18 项测试、严格类型检查与生产构建通过；3 项新增协调时序测试在旧基线全部失败，修复后通过。`npm run test:preview` 在 800×650、360×650 两种窗口通过真实 DOM/CSS 交互验证：第二张图旁反馈可见、没有横向溢出、并发请求只有一次、失败可重试、清除后迟到结果不回写。该预览测试使用受控的剪贴板 Promise，不冒充真实系统写入。

“新回答生成时导出旧回答”暂保留现有保护：新回答可能触发整页自动滚动，需要独立双回答流式夹具验证后再缩小生成检测范围。

`DPRS=1 CASES=short,split npm run test:e2e` 的 5 项真实扩展回归全部通过，覆盖短图、分段预览复制/保存、复制拒绝恢复和 125% 缩放，与独立原生参考的像素差异全部为 0。记录：`artifacts/results-experience.json`。生产安装包已重新生成。
