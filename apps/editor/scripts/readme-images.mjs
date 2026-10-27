/*
 * Refait la bannière et les captures du README (docs/images) avec l'appli actuelle.
 * À lancer à chaque version : node apps/editor/scripts/readme-images.mjs <version>
 * (Chromium : variable CHROMIUM, sinon celui de Playwright.)
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../../docs/images');
const version = process.argv[2] ?? JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')).version;
const appVersion = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')).version;
const port = 4391;
const url = `http://localhost:${port}`;

const vite = spawn('pnpm', ['exec', 'vite', '--port', String(port), '--strictPort'], {
  cwd: resolve(here, '..'),
  stdio: 'ignore',
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1.6,
  locale: 'fr-FR',
});
await ctx.addInitScript(
  (v) => localStorage.setItem('poulpe.settings', JSON.stringify({ showWelcome: false, lastSeenVersion: v })),
  appVersion,
);
const page = await ctx.newPage();
const shot = (name, opts = {}) => page.screenshot({ path: `${out}/${name}.png`, ...opts });

await page.goto(url);
await page.getByTestId('canvas').waitFor();
// Un modèle ouvert, comme sur la bannière.
await page.getByTestId('template-summerSale').click();
await page.waitForTimeout(800);
await shot('dessin-modele');

await page.keyboard.press('Control+k');
await page.keyboard.type('flou');
await page.waitForTimeout(500);
await shot('recherche-commandes');
await page.keyboard.press('Escape');

await page.keyboard.press('Control+/');
await page.waitForTimeout(500);
await shot('raccourcis');
await page.keyboard.press('Escape');

await page.getByRole('button', { name: 'Aide' }).click();
await page.getByRole('menuitem', { name: /Nouveautés/ }).click();
await page.waitForTimeout(500);
await shot('nouveautes');
await page.keyboard.press('Escape');

// Bannière : le logo, le titre et une capture inclinée de l'appli.
const app = readFileSync(`${out}/dessin-modele.png`).toString('base64');
const logo = readFileSync('/mnt/project-files/logo/nouveau-logo-2026-10/poulpe-icone-512.png').toString(
  'base64',
);
const b = await (await browser.newContext({ deviceScaleFactor: 2 })).newPage();
await b.setViewportSize({ width: 1280, height: 400 });
await b.setContent(`<style>
body{margin:0;width:1280px;height:400px;overflow:hidden;font-family:Inter,system-ui,sans-serif;color:#fff;
background:linear-gradient(120deg,#1b1233,#2a1536 60%,#4a1b45)}
.l{position:absolute;left:50px;top:48px}.l img{width:66px;height:66px;border-radius:16px;vertical-align:middle}
h1{display:inline;font-size:52px;margin-left:16px;vertical-align:middle}h1 b{color:#ff4f87}
p{font-size:22px;margin:0;color:#ff6b97}p+p{color:#ddd;margin-top:4px}
.t{position:absolute;left:50px;top:190px}
.c{position:absolute;left:50px;top:290px;display:flex;gap:14px}.c i{font-style:normal;border:1px solid #555;border-radius:30px;padding:10px 26px;font-size:20px;background:#ffffff14}
.s{position:absolute;left:650px;top:40px;width:760px;transform:perspective(1400px) rotateY(-9deg) rotateZ(1.5deg);border-radius:10px;box-shadow:0 20px 60px #0008}
</style>
<div class=l><img src="data:image/png;base64,${logo}"><h1>Poulpe <b>Design</b></h1></div>
<div class=t><p>Création graphique libre et gratuite</p><p>Vectoriel, photo, mise en page. Version ${version}.</p></div>
<div class=c><i>Windows</i><i>macOS</i><i>Linux</i><i>Navigateur</i></div>
<img class=s src="data:image/png;base64,${app}">`);
await b.screenshot({ path: `${out}/banniere.png` });
await b.close();
await browser.close();
vite.kill();
