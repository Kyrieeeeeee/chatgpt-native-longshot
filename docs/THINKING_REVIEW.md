# 思考强度快捷键对抗审查与优化

日期：2026-10-18。基线为本轮开始的0.2.4工作区，优化版0.2.5。三个agent分别审查延迟/原生控件、输入队列/焦点、误判/关联边界，再交叉复核；未操作用户日常GPT标签页。修改前源码快照：`/private/tmp/longshot-thinking-before-024.tar.gz`。

## 已复现的问题

- 原生/ARIA滑块每次强制等待80ms，再以40ms间隔轮询确认；迟到菜单也被40ms量化等待。
- `busy`期间的新快捷键直接丢弃，原测试甚至将3次命令只执行1次判为通过。
- 每次切换都关闭自己打开的菜单，连续切换反复打开；确认过程反复发现触发器。
- `aria-controls`关联节点尚未挂载时会退回全页，可能操作唯一但无关的同名菜单/滑块。
- 双选中、空ARIA当前值、偏离步长、旧defaultValue和错误方向标签存在误操作或误报窗口。
- 焦点恢复把任意dialog当作自有弹层，可能抢回用户新焦点；富文本选区未显式保存，文本节点split后旧偏移可抛异常。
- 等待菜单时开始截图或路由改变，旧操作缺少每步的上下文检查。

## 最终实现

`thinking.ts`负责快捷键请求、焦点快照与生命周期；`thinking-queue.ts`将离散按键按FIFO串行；`thinking-controls.ts`只操作当前站点可见原生控件，发现档位后执行并确认。

- 首次按键立即启动，不新增防抖。每个离散左右键都保序；一个burst复用仍打开的滑块菜单，只在最后统一关闭自己打开的选择器。
- 长按自动repeat仍忽略，避免一按多跳。最多12个未完成步骤，超量明确提示；失败/取消清空剩余步骤，取消未结束时明确拒绝新上下文操作。
- 去掉固定80ms等待。MutationObserver只在等待期间存在，DOM/ARIA提交立即读取，纯文本变更合到一帧；属性无DOM记录时120ms稀疏兜底，仍保留1800ms失败预算。
- 原生range的setter本身不算成功：需独立ARIA文字、实际变化的value属性或触发器标签确认，并在下一帧复查。支持同触发器滑块整体重建；触发器替换、URL变化和截图忙碌会停止。
- 有controls但节点失联时绝不全页后退。无controls只接受明确label关联、composer内或本次点击后新出现的菜单，保留portal兼容。
- 空边界/当前值、偏离step网格、多选中、禁用控件拒绝；方向/环绕与可识别档位标签一致才接受。
- 保存textarea选择起止/方向及富文本anchor/focus偏移，不改写草稿。只在用户没有新操作且焦点仍归本次菜单时恢复；输入、组词、点击别处、路由/可见性变化取消旧操作。节点重构时不强行恢复失效偏移。
- Fn+左右对应End/Home的既有习惯保持；IME keyCode229、组合键、合成导航事件和本扩展面板不触发切换。备用⌥⇧Y保持。

没有调用私有API、伪造站点存储、缓存跨账号档位或新增权限/后台常驻轮询。控件观察器、RAF和定时器在成功、失败及abort时释放。

## 可复现验证

- `npm run check`：43项单元/时序测试、类型检查与生产构建。
- `npm run test:thinking`：中英文2/3/4档、双向环绕、native/custom slider、拒绝确认、通用picker重开、草稿/光标、平台遮蔽、文档冲突、跳过禁用档；3次离散命令执行3次，快速End/End/Home复用一个滑块菜单。
- `npm run test:thinking-audit`：14项控件红队反例，加8项真实可信键盘/点击交互反例，含反向选区、splitText、用户新输入/焦点、SPA、无关联dialog、截图中途开始。
- `test:tokens`与`test:gemini`：ChatGPT胶囊/正文发送与Gemini真实Quill回归，避免快捷键协调器破坏编辑器流程。

全部浏览器测试使用独立临时Chromium及本地夹具，不使用用户profile。控件红队基线8例有5例失败，最终扩展14例通过。截图竞态测试的VM只需截图逻辑，已将原来的hotkey局部stub改为thinking模块stub；新协调器通过独立真实浏览器测试，不将VM缺window当作生产缺陷。

## 延迟口径与复现

`thinking-benchmark.mjs`在相同夹具上，分别bundle修改前源码快照和最终源码，各场景5次，测请求到已确认成功提示的中位数。它直接驱动捕获的快捷键回调，不测物理Fn事件或登录态网络/动画。原始记录：`artifacts/thinking-024-before.json`和`thinking-025-after.json`。

```sh
THINKING_SOURCE=/private/tmp/longshot-thinking-before-024 THINKING_LABEL=024-before node tests/thinking-benchmark.mjs
THINKING_LABEL=025-after node tests/thinking-benchmark.mjs
npm run test:thinking
npm run test:thinking-audit
```

初步优化将滑块83ms降到约23ms，但普通菜单因为额外RAF从约1ms增加至14ms，generic picker增加至31ms。此候选未作为最终结果：最终对DOM/ARIA提交立即确认，只保留滑块接受后的下一帧复核。以下以最终复测记录为准。

| 相同场景（5次中位数） | 0.2.4 | 0.2.5 |
| --- | ---: | ---: |
| 普通菜单 | 1.0ms | 1.3ms |
| 原生滑块 | 83.0ms | 8.7ms |
| ARIA滑块 | 83.1ms | 7.4ms |
| 250ms迟到菜单 | 292.7ms | 253.5ms |
| 通用模型picker | 1.2ms | 1.8ms |

普通菜单和generic picker的亚毫秒差异不作为收益；250ms迟到菜单的document查询计数由16次降到2次。滑块原生/ARIA路径不再固定等待80ms，仍保留下一帧接受状态复查。

本轮没有在用户登录态GPT、真实物理Fn键、不同账号模型、Windows/Linux或Chrome118本体上重新验收。End/Home通过真实Chromium可信键事件测试；物理Fn是否映射正确还需用户环境确认。成功表示原生UI已确认接受，不能承诺服务端未来不会再次回滚。真实体感可能还受站点动画、React渲染和账号界面影响。

原扩展目录`dist/`直接更新至0.2.5，无安装包、不覆盖提示词数据。重载扩展后仅刷新独立测试页，再进行实际手感验收。
