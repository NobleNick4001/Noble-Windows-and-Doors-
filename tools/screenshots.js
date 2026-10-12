// Headless screenshot test. Usage: node tools/screenshots.js  (needs puppeteer-core + google-chrome; server on :8080)
const puppeteer = require(process.env.PUPPETEER_PATH || 'puppeteer-core');
const OUT = __dirname + '/../screenshots/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const errors = [];
  for (const [vw, vh, tag] of [[1024, 768, 'ipad-landscape'], [820, 1180, 'ipad-portrait'], [390, 844, 'iphone']]) {
    const ctx = await browser.createBrowserContext(); const page = await ctx.newPage();
    await page.setViewport({ width: vw, height: vh, deviceScaleFactor: 1, hasTouch: true });
    page.on('pageerror', (e) => errors.push(tag + ' pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(tag + ' console ' + m.text()); });
    const go = async (hash) => { await page.goto('http://localhost:8080/index.html' + hash); await sleep(500); };
    const shot = async (n) => { await sleep(250); await page.screenshot({ path: `${OUT}${tag}-${n}.png` }); };
    const type = async (sel, v) => { await page.$eval(sel, (el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }); await page.type(sel, v); };
    await go('#/calculator');
    await type('#in-w', '36'); await type('#in-h', '48'); await shot('01-calculator');
    await page.click('#btn-add'); await sleep(200);
    // second window: V300 black/black picture 72x60 qty 2
    await page.evaluate(() => { [...document.querySelectorAll('.chip')].find((c) => c.textContent === 'V300').click(); }); await sleep(200);
    await page.evaluate(() => { [...document.querySelectorAll('.tile')].find((c) => c.textContent.includes('Picture')).click(); }); await sleep(200);
    await page.evaluate(() => { [...document.querySelectorAll('.swatch')].find((c) => c.textContent.includes('Black / Black')).click(); }); await sleep(200);
    await type('#in-w', '72'); await type('#in-h', '60'); await type('#in-q', '2');
    await page.type('#in-label', 'Living room');
    if (tag === 'ipad-landscape') {
      const px = await page.evaluate(() => ({ w: document.querySelector('#price-window').textContent, i: document.querySelector('#price-install').textContent, e: document.querySelector('#price-each').textContent, t: document.querySelector('#price-total')?.textContent }));
      console.log('V300 bb picture 72x60 x2 ->', JSON.stringify(px));
    }
    await page.click('#btn-add'); await sleep(200);
    await go('#/estimate');
    await type('#c-name', 'Jane Homeowner'); await type('#c-address', '123 Main St, Phoenix, AZ 85016'); await type('#c-phone', '(602) 555-0100');
    await page.click('#btn-custom-extra'); await sleep(200);
    await page.evaluate(() => { const i = document.querySelectorAll('.extra input')[0]; i.value = 'Permit'; i.dispatchEvent(new Event('input')); const a = document.querySelectorAll('.extra input')[1]; a.value = '150'; a.dispatchEvent(new Event('input')); });
    await page.evaluate(() => document.querySelector('.lineitem .btn').click()); await sleep(200); // open edit on first line
    await shot('02-estimate-edit');
    await page.evaluate(() => { [...document.querySelectorAll('.btn')].find((b) => b.textContent === 'Save line').click(); }); await sleep(200);
    await shot('03-estimate');
    if (tag === 'ipad-landscape') console.log('totals', await page.evaluate(() => ['t-win', 't-inst', 't-sub', 't-total'].map((i) => document.getElementById(i).textContent).join(' | ')));
    await go('#/estimate/print'); await page.screenshot({ path: `${OUT}${tag}-04-print-view.png`, fullPage: true });
    if (tag === 'ipad-portrait') await page.pdf({ path: OUT + 'sample-estimate.pdf', format: 'Letter', printBackground: true });
    await go('#/saved'); await shot('05-saved');
    await go('#/options'); await shot('06-options-glass');
    await page.evaluate(() => [...document.querySelectorAll('.seg-btn')].find((b) => b.textContent === 'Frame series').click()); await shot('07-options-frames');
    await page.evaluate(() => [...document.querySelectorAll('.seg-btn')].find((b) => b.textContent.startsWith('Colors')).click()); await shot('08-options-colors');
    await go('#/gallery'); await shot('09-gallery');
    await page.click('#btn-slideshow'); await sleep(900); await shot('10-slideshow');
    await page.mouse.click(vw * 0.9, vh / 2); await sleep(700); await page.evaluate(() => document.querySelector('#ss-close').click());
    await go('#/preview'); await shot('11-preview-empty');
    await page.click('#ov-sample'); await sleep(900); await shot('12-preview-sample');
    // drag the overlay + choose black + add another
    const box = await (await page.$('#ov-canvas')).boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.47); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5, { steps: 5 }); await page.mouse.up();
    await page.evaluate(() => { [...document.querySelectorAll('#ov-controls .swatch')].find((b) => b.textContent.includes('Black')).click(); }); await sleep(300);
    await shot('13-preview-black');
    if (tag === 'ipad-landscape') { const [dl] = await Promise.all([new Promise((r) => { page.once('response', r); setTimeout(r, 1500); }), page.evaluate(() => document.querySelector('#ov-save').click())]); await sleep(800); }
    await go('#/settings'); await shot('14-settings');
    await go('#/calculator');
    await page.evaluate(() => [...document.querySelectorAll('.seg-btn')].find((b) => b.textContent.startsWith('Andersen')).click());
    await sleep(200);
    await page.evaluate(() => { [...document.querySelectorAll('.tile')].find((c) => c.textContent.trim() === 'Horizontal Slider').click(); });
    await sleep(150);
    await page.evaluate(() => { [...document.querySelectorAll('.swatch')].find((c) => c.textContent.trim() === 'White / White').click(); });
    await sleep(150);
    await type('#in-w', '70'); await type('#in-h', '60'); await type('#in-q', '1');
    await page.evaluate(() => { const b = [...document.querySelectorAll('.link')].find((el) => el.textContent === 'Show math'); if (b) b.click(); });
    await sleep(200);
    if (tag === 'ipad-landscape') {
      const px = await page.evaluate(() => ({ summary: document.querySelector('.eyebrow')?.textContent, w: document.querySelector('#price-window')?.textContent, i: document.querySelector('#price-install')?.textContent, math: document.querySelector('.math')?.textContent }));
      console.log('Andersen XO white 70x60 ->', JSON.stringify(px));
      if (px.w !== '$1,242.92') throw new Error('Andersen material spot-check failed: ' + px.w + ' (expected $1,242.92)');
      if (px.i !== '$360.00') throw new Error('Labor should stay separate at $360, got ' + px.i);
    }
    await shot('15-andersen-calc');
    await ctx.close();
  }
  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})();
