import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

// Exercise the production stitcher and PNG decoder, including every output row.
const source = await build({ entryPoints: ['src/stitcher.ts'], bundle: true, write: false, format: 'iife', globalName: 'LongshotStitcher' });
const browser = await chromium.launch({ headless: true });
try {
  for (const [width, height, expectedParts] of [[2153, 58393, 1], [128, 65536, 2]]) {
    const page = await browser.newPage();
    await page.addScriptTag({ content: source.outputFiles[0].text });
    const result = await page.evaluate(async ({ width, height }) => {
      const stitcher = new LongshotStitcher.Stitcher(width, height);
      const tile = document.createElement('canvas'); tile.width = width; tile.height = 512;
      const ctx = tile.getContext('2d');
      const create=document.createElement.bind(document),read=FileReader.prototype.readAsDataURL,outputs=[];
      document.createElement=(...args)=>{const el=create(...args);if(args[0]==='canvas')outputs.push(el);return el;};
      FileReader.prototype.readAsDataURL=function(blob){if(outputs.some(c=>c.width&&c.height))throw new Error('Raw output canvas retained during base64 conversion');return read.call(this,blob);};
      try {
        for (let top = 0; top < height; top += tile.height) {
          const rows = Math.min(tile.height, height - top);
          for (let y = 0; y < rows; y++) {
            ctx.fillStyle = `rgb(${(top + y) & 255},${(top + y) >>> 8},73)`;
            ctx.fillRect(0, y, width, 1);
            ctx.fillStyle = `rgb(${(top + y) & 255},${(top + y) >>> 8},181)`;
            ctx.fillRect(width - 1, y, 1, 1);
          }
          const image = await createImageBitmap(tile);
          try { await stitcher.append(image, 0, 0, rows); } finally { image.close(); }
        }
        const parts = stitcher.finish();
        const sample = document.createElement('canvas'); sample.width = 1;
        let top = 0;
        for (const part of parts) {
          const image = await LongshotStitcher.bitmap(part.data.split(',')[1]);
          try {
            if (image.width !== width || image.height !== part.height) throw new Error('Decoded dimensions differ');
            sample.height = image.height;
            const out = sample.getContext('2d');
            for (const x of [0, width - 1]) {
              out.drawImage(image, x, 0, 1, image.height, 0, 0, 1, image.height);
              const pixels = out.getImageData(0, 0, 1, image.height).data;
              for (let y = 0; y < image.height; y++) {
                const absolute = top + y, i = y * 4;
                if (pixels[i] !== (absolute & 255) || pixels[i + 1] !== (absolute >>> 8)
                  || pixels[i + 2] !== (x === 0 ? 73 : 181) || pixels[i + 3] !== 255)
                  throw new Error(`Pixel mismatch at ${x},${absolute}`);
              }
            }
            top += image.height;
          } finally { image.close(); }
        }
        return { width, height: top, parts: parts.map(p => ({ width: p.width, height: p.height })) };
      } finally { stitcher.dispose(); tile.width = 0; tile.height = 0;document.createElement=create;FileReader.prototype.readAsDataURL=read; }
    }, { width, height });
    assert.equal(result.height, height); assert.equal(result.parts.length, expectedParts);
    console.log('PASS PNG roundtrip, every row at both edges:', JSON.stringify(result));
    await page.close();
  }
} finally { await browser.close(); }
