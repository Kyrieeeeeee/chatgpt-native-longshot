import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
const testing = process.argv.includes('--test');
const outdir = testing ? 'dist-test' : 'dist';
await mkdir(outdir, { recursive: true });
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (testing) {
  manifest.content_scripts[0].matches = ['http://127.0.0.1:8799/*'];
  manifest.permissions.push('clipboardRead'); // Test only: verify actual PNG clipboard bytes.
}
await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
await cp('public', outdir, { recursive: true });
for (const [name, format] of [['background', 'esm'], ['content', 'iife'], ['preview', 'esm']]) {
  const options = { entryPoints: [`src/${name}.ts`], bundle: true, outfile: `${outdir}/${name}.js`, format,
    target: 'chrome118', sourcemap: false, minify: false, define: { __TEST__: String(testing) } };
  if (process.argv.includes('--watch')) { const ctx = await context(options); await ctx.watch(); }
  else await build(options);
}
console.log(`Built ${outdir}/`);
