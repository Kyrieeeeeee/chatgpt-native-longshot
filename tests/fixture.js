const q = new URLSearchParams(location.search);
const name = q.get('case') || 'rich';
if (q.get('dark') === '1') document.documentElement.classList.add('dark');
if (q.get('inner') === '1') document.documentElement.classList.add('inner');
if (q.get('nested') === '1') document.documentElement.classList.add('nested');
if (q.get('fixed') === '1') { document.querySelector('#header').hidden = false; document.querySelector('#footer').hidden = false; }
const para = i => `<p>第 ${i} 段：CPU 通过设备控制器访问 I/O。控制寄存器保存操作要求，状态寄存器反映设备状态。Native rendering keeps the original line breaks, 字体与间距。下标 x₁，Greek α β γ。</p>`;
const code = n => `<pre><code>${Array.from({length:n}, (_,i) => `<span class="key">const</span> value${i} = <span class="num">${i}</span>; // 原生代码缩进\n    console.log(value${i});`).join('\n')}</code></pre>`;
const table = n => `<table><thead><tr><th>状态标记</th><th>含义</th></tr></thead><tbody>${Array.from({length:n}, (_,i) => `<tr><td>READY ${i}</td><td>设备就绪 / 完成操作 ${i}</td></tr>`).join('')}</tbody></table>`;
const image = `<img width="600" height="180" src="/tests/picture.svg" alt="本地图表">`;
const formulas = `<p>中文与行内公式 <span data-math="e^{i\\pi}+1=0"></span> 的基线。</p>${[
  '\\begin{aligned}a+b&=c\\\\d+e&=f\\end{aligned}',
  '\\int_0^1 \\frac{x^2}{1+x}\\,dx = \\sum_{n=1}^{\\infty} \\frac{(-1)^n}{n}',
  '\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}\\quad f(x)=\\begin{cases}x^2 & x>0\\\\0 & x\\le0\\end{cases}'
].map(f => `<div data-math="${f}" data-display="1"></div>`).join('')}`;
const scenes = {
 short:'<p>这是第一行。</p><p>This is the second line.</p>',
 long:Array.from({length:30}, (_,i) => para(i)).join(''),
 headings:'<h1>一级标题</h1><h2>二级标题</h2><h3>三级标题</h3>'+para(1),
 lists:'<ul><li>设备控制器<ul><li>控制寄存器<ol><li>读取</li><li>写入</li></ol></li><li>状态寄存器</li></ul></li></ul>',
 quote:'<blockquote>来自原页面的引用。<br>Native quote.</blockquote><hr>'+para(1),
 code:code(10)+code(12), longcode:code(100),
 math:formulas, table:table(4), longtable:table(80), images:image+para(1)+image,
 lazy:para(0)+Array.from({length:15},(_,i)=>para(i)).join('')+image.replace('<img','<img loading="lazy"')+para(99),
 wide:'<div style="overflow-x:auto"><table style="width:1300px"><tr><td>横向隐藏内容边界</td><td>只捕获当前可见区域</td></tr></table></div>'+`<pre class="scroll-code">${'内部纵向滚动边界\n'.repeat(60)}</pre>`,
 split:Array.from({length:145},(_,i)=>para(i)).join(''),
 sticky:'<div style="border:1px solid #888"><div class="sticky">代码块标题（只应出现一次）</div>'+code(80)+'</div>',
 sticky_negative:'<div style="border:1px solid #888"><div class="sticky" style="top:-85px;transform:translateY(84px);margin-bottom:84px">负偏移吸顶标题（只应出现一次）</div>'+code(80)+'</div>',
 rich:'<h2>设备控制器与 CPU</h2>'+para(1)+'<div class="card">用户进程<br>↓<br>操作系统 / 设备驱动<br>↓<br><strong>设备控制器</strong><hr>控制寄存器 · 状态寄存器 · 数据寄存器</div>'+formulas+table(15)+code(25)+'<blockquote>保留浏览器真实渲染结果。</blockquote>'+Array.from({length:8},(_,i)=>para(i)).join('')+'<hr><p><strong>回答结束 · END</strong></p>'
};
document.querySelector('#answer').innerHTML = scenes[name] || scenes.rich;
if (name === 'shadow_overlay') {
  // External extensions can mount a static host with fixed UI inside an open
  // shadow root. Include a nested root and explicit visible descendant.
  const overlay = document.createElement('div'); overlay.id = 'shadow-overlay-fixture';
  const nested = document.createElement('div'); overlay.attachShadow({ mode: 'open' }).append(nested);
  nested.attachShadow({ mode: 'open' }).innerHTML = '<div style="position:fixed;right:20%;top:35%;z-index:999999;background:magenta;padding:30px"><span style="visibility:visible">外部浮层不应进入长图</span></div>';
  document.body.append(overlay);
  const genuine = document.createElement('div'); genuine.id = 'answer-shadow-component';
  genuine.attachShadow({ mode: 'open' }).innerHTML = '<p>正文 Shadow DOM 组件必须保留。</p>';
  document.querySelector('#answer').append(genuine);
}
if (name.startsWith('renderer_')) {
  const prior = document.querySelector('#turn');
  const turn = document.createElement('div');
  turn.id = 'turn'; turn.dataset.talvtTurnState = 'complete';
  turn.style.cssText = 'max-width:700px;margin:0 auto 45px';
  const blocks = document.createElement('div');
  const prompt = document.createElement('div'); prompt.textContent = '同一轮中的用户提问，不应被截图。';
  const userActions = document.createElement('div'); userActions.className = 'turn-action-controls';
  userActions.innerHTML = '<button aria-label="复制">复制用户提问</button>'; prompt.append(userActions);
  const reasoning = document.createElement('div'); reasoning.textContent = '思考了 52s，不应被截图。';
  const response = document.createElement('div');
  const heading = document.createElement('h4'); heading.textContent = 'ChatGPT 说：';
  heading.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)';
  if (name === 'renderer_role') heading.dataset.conversationRole = 'assistant';
  const body = document.querySelector('#answer'); body.removeAttribute('data-message-author-role');
  body.style.display = 'flow-root';
  response.append(heading,body); blocks.append(prompt,reasoning,response);
  const actions = document.createElement('div'); actions.className = 'turn-action-controls';
  actions.innerHTML = '<button aria-label="复制">复制</button>';
  turn.append(blocks,actions); prior.replaceWith(turn);
  const overlay = document.createElement('div'); overlay.id = 'composer-fixture';
  overlay.style.cssText = 'position:fixed;bottom:100px;left:20%;width:60%;visibility:hidden;z-index:999';
  overlay.innerHTML = '<div data-thread-scroll-footer="true" style="position:relative;visibility:visible;background:#000;padding:25px"><div data-composer-surface-variant="default" style="position:relative;visibility:visible;background:#f00;padding:30px">不应出现在图片中的输入栏</div><button aria-label="滚动到底部" style="visibility:visible">↓</button></div>';
  document.body.append(overlay);
  document.addEventListener('scroll',()=>{body.dataset.dilMessageId=String(window.scrollY);},{capture:true});
}
for (const el of document.querySelectorAll('[data-math]')) katex.render(el.dataset.math, el, { displayMode:el.dataset.display==='1', throwOnError:true });
if (name === 'streaming') document.querySelector('#answer').dataset.isStreaming = 'true';
window.fixtureReady = true;
