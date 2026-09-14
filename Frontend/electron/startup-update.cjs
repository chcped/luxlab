const fs = require('node:fs');
const path = require('node:path');

function updateMarker(app) {
  const file = path.join(app.getPath('userData'), 'updated-startup.json');
  return {
    consume() {
      try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.unlinkSync(file);
        return saved.version === app.getVersion() && Date.now() - saved.at < 24 * 60 * 60 * 1000;
      } catch { return false; }
    },
    write(version) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ version, at: Date.now() })); },
    clear() { try { fs.unlinkSync(file); } catch {} },
  };
}

function checkStartup({ updater, marker, render, timeoutMs = 20000, downloadTimeoutMs = 180000 }) {
  return new Promise(resolve => {
    let finished = false, timer;
    const listeners = [];
    const on = (name, fn) => { updater.on(name, fn); listeners.push([name, fn]); };
    const finish = result => {
      if (finished) return;
      finished = true; clearTimeout(timer);
      for (const [name, fn] of listeners) updater.removeListener(name, fn);
      resolve(result);
    };
    const expire = ms => { clearTimeout(timer); timer = setTimeout(() => finish('open'), ms); };
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    // Keep an error listener until the normal updater takes over after timeout.
    on('error', () => { marker.clear(); finish('open'); });
    on('update-not-available', () => finish('open'));
    on('update-available', info => {
      render({ status: 'downloading', version: info.version }); expire(downloadTimeoutMs);
    });
    on('download-progress', progress => render({ status: 'downloading', percent: progress.percent }));
    on('update-downloaded', info => {
      render({ status: 'installing', version: info.version });
      expire(15000);
      // Let the applying screen paint before quitting the process.
      setTimeout(() => {
        if (finished) return;
        try { marker.write(info.version); updater.quitAndInstall(true, true); }
        catch { marker.clear(); finish('open'); }
      }, 350);
    });
    render({ status: 'checking' }); expire(timeoutMs);
    Promise.resolve().then(() => updater.checkForUpdates()).catch(() => finish('open'));
  });
}
module.exports = { updateMarker, checkStartup };
