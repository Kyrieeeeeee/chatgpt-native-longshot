// Independent browser, no user profile and no server/8799 dependency.
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
const bundle = await build({ entryPoints:['src/thinking.ts'], bundle:true, write:false, format:'iife', globalName:'thinking' });
const fixture = await readFile('tests/thinking-fixture.js','utf8');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
try {
  async function ready(query = '', rich = false) {
    await page.goto('about:blank' + (query ? '?' + query : ''));
    await page.setContent(`<form id="composer-background">${rich
      ? '<div contenteditable="true" role="textbox" aria-label="Prompt"><p>Keep <strong>this</strong> draft</p></div>'
      : '<textarea aria-label="Prompt">Keep this draft</textarea>'}<button id="effort" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="effort-menu">Standard</button></form><div role="dialog" id="other"><input aria-label="Other"></div>`);
    await page.evaluate(() => {
      window.notices = []; window.captureBusy = false;
      window.chrome = {runtime:{id:'test',onMessage:{addListener(){}}}};
      // Real native menus steal focus; the old fixture did not model this.
      const append = Node.prototype.appendChild;
      Node.prototype.appendChild = function(node) { const result = append.call(this,node); if(node.id==='effort-menu'&&document.querySelector('#effort').getAttribute('aria-expanded')==='true')node.querySelector('button,[role=slider]')?.focus(); return result; };
      const nativeAppend = Element.prototype.append;
      Element.prototype.append = function(...nodes) { nativeAppend.apply(this,nodes); for(const node of nodes)if(node?.id==='effort-menu'&&document.querySelector('#effort').getAttribute('aria-expanded')==='true')node.querySelector('button,[role=slider]')?.focus(); };
    });
    await page.addScriptTag({content:fixture});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(() => { window.api = thinking.installThinkingShortcut(message => window.notices.push(message), () => window.captureBusy); });
    await page.getByRole('textbox',{name:'Prompt'}).focus();
  }
  const idle = () => expect.poll(() => page.evaluate(() => window.api.isBusy())).toBe(false);
  await ready();
  await page.getByRole('textbox',{name:'Prompt'}).evaluate(el => el.setSelectionRange(2,9,'backward'));
  await page.keyboard.press('End'); await idle();
  await expect(page.getByRole('textbox',{name:'Prompt'})).toBeFocused();
  expect(await page.getByRole('textbox',{name:'Prompt'}).evaluate(el => [el.selectionStart,el.selectionEnd,el.selectionDirection])).toEqual([2,9,'backward']);
  console.log('PASS textarea backward selection restored after native menu focus steal');

  await ready('',true);
  await page.getByRole('textbox',{name:'Prompt'}).evaluate(el => {
    const text=el.querySelector('strong').firstChild;
    getSelection().setBaseAndExtent(text,4,text,1);
  });
  await page.keyboard.press('End'); await idle();
  await expect(page.getByRole('textbox',{name:'Prompt'})).toBeFocused();
  expect(await page.evaluate(() => { const s=getSelection(); return [s.anchorNode.textContent,s.anchorOffset,s.focusOffset]; })).toEqual(['this',4,1]);
  console.log('PASS rich editor backward selection restored without rewriting content');

  await ready('delay=250',true);
  const pageErrors=[]; const collectError=error=>pageErrors.push(error.message);
  page.on('pageerror',collectError);
  await page.getByRole('textbox',{name:'Prompt'}).evaluate(el => { const text=el.querySelector('strong').firstChild; getSelection().setBaseAndExtent(text,4,text,1); });
  await page.keyboard.press('End');
  await page.getByRole('textbox',{name:'Prompt'}).evaluate(el => el.querySelector('strong').firstChild.splitText(2));
  await idle(); await page.waitForTimeout(50);
  expect(pageErrors).toEqual([]); page.off('pageerror',collectError);
  await expect(page.getByRole('textbox',{name:'Prompt'})).toHaveText('Keep this draft');
  console.log('PASS native rich editor text-node split does not throw during cleanup');

  await ready('delay=250');
  await page.keyboard.press('End'); await page.getByRole('textbox',{name:'Other'}).click();
  await idle(); await page.waitForTimeout(300);
  await expect(page.getByRole('textbox',{name:'Other'})).toBeFocused();
  expect(await page.evaluate(() => window.fixtureClicks())).toBe(0);
  console.log('PASS user click cancels queued switch without stealing focus');

  await ready('delay=250');
  await page.keyboard.press('End'); await page.keyboard.type('new');
  await idle(); await page.waitForTimeout(300);
  await expect(page.getByRole('textbox',{name:'Prompt'})).toHaveValue('newKeep this draft');
  expect(await page.evaluate(() => window.fixtureClicks())).toBe(0);
  console.log('PASS user typing cancels pending switch and keeps new draft');

  await ready('delay=250');
  await page.keyboard.press('End'); await page.evaluate(() => history.pushState({},'', '#changed'));
  await idle(); await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.fixtureClicks())).toBe(0);
  console.log('PASS SPA route change cancels pending menu action');

  await ready('no-confirm');
  await page.evaluate(() => document.querySelector('#effort').removeAttribute('aria-controls'));
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => window.fixtureClicks())).toBe(1);
  await page.evaluate(() => document.querySelector('#other input').focus());
  await idle();
  await expect(page.getByRole('textbox',{name:'Other'})).toBeFocused();
  console.log('PASS unrelated dialog focus is not considered extension-owned');

  await ready('delay=250');
  await page.keyboard.press('End'); await page.evaluate(() => { window.captureBusy=true; });
  await idle(); await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.fixtureClicks())).toBe(0);
  console.log('PASS capture beginning mid-wait cancels menu action');
} finally { await browser.close(); }
