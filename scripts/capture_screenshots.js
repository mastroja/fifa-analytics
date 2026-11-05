// Opt-in screenshot mode for release/marketing images. Run with the normal app CLOSED (it opens the same database):
//   $env:FA_SCREENSHOTS = '1'; npm start        (PowerShell)
// Optional: FA_SCREENSHOTS_DIR to choose the output folder (default: <repo>/screenshots), FA_SCREENSHOTS_ZOOM (default 0.8).
// The app starts as usual, visits each screen, saves a PNG of the window with webContents.capturePage, then quits.
// It shows whatever is in your own save, so look through the images before sharing them. Screens with nothing to show
// (for example Progression before a second season of history exists) are skipped rather than saved empty.
const fs = require('fs');
const path = require('path');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(win, app) {
  const outDir = process.env.FA_SCREENSHOTS_DIR || path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const wc = win.webContents;
  const js = code => wc.executeJavaScript(code, true);

  win.setContentSize(1600, 1000);
  win.center();
  win.show();
  wc.setZoomFactor(Number(process.env.FA_SCREENSHOTS_ZOOM) || 0.8); // zoomed out a little so whole pages fit
  await sleep(6000); // first data load

  const toTop = () => js(`document.scrollingElement.scrollTo(0, 0)`);
  const shot = async (name, wait) => {
    await sleep(wait || 1500);
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    console.log('[screenshots] saved', name);
  };
  const step = async (name, fn, wait, skipIfText) => {
    try {
      await fn();
      await toTop();
      if (skipIfText) {
        await sleep(wait || 1500);
        const text = await js(`document.body.innerText`);
        if (text.includes(skipIfText)) { console.log('[screenshots] skipped', name, '-', skipIfText); return; }
      }
      await shot(name, wait);
    } catch (e) { console.error('[screenshots] failed', name, e && e.message); }
  };
  const closeDialogs = () => js(`document.querySelectorAll('dialog[open]').forEach(d => d.close())`);
  const topPlayerId = `(currentPlayers.filter(p => p.__clubStatus === 'normal').sort((a, b) => (b.overall || 0) - (a.overall || 0))[0] || {}).player_id`;

  await step('01-home', () => js(`switchTab('home')`), 2500);
  await step('02-squad-list', () => js(`switchTab('squad'); SquadViews.setView('list')`));
  await step('03-depth-chart', () => js(`SquadViews.setView('depth')`), 2500);
  await step('04-player-profile', () => js(`openPlayerProfile(${topPlayerId})`), 2500);
  await step('05-dynamic-look', async () => {
    await js(`switchTab('home')`);
    await sleep(500);
    await toTop();
    await js(`DynamicLookUI.open()`);
  }, 2500);
  await closeDialogs();
  await step('06-progression', () => js(`switchTab('insights'); Insights.setView('progress')`), 3000, 'Not enough history yet');
  await step('07-wages-contracts', () => js(`Insights.setView('wages')`), 3000);

  console.log('[screenshots] done:', outDir);
  app.quit();
}

module.exports = { run };
