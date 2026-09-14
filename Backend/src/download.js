const releases = 'https://github.com/chcped/luxlab/releases/latest';
let cached;
let pending;

async function installer() {
  if (cached && cached.expires > Date.now()) return cached.url;
  if (!pending) pending = (async () => {
    const response = await fetch('https://api.github.com/repos/chcped/luxlab/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Luxlab' },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error(`GitHub: ${response.status}`);
    const release = await response.json();
    const asset = release.assets?.find(item => /^P2P-Desktop-Setup-\d+\.\d+\.\d+\.exe$/.test(item.name));
    if (release.draft || release.prerelease || !asset) throw new Error('Instalador indisponível');
    const url = new URL(asset.browser_download_url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/chcped/luxlab/releases/download/')) {
      throw new Error('URL de download inválida');
    }
    cached = { url: url.href, expires: Date.now() + 5 * 60 * 1000 };
    return cached.url;
  })().finally(() => { pending = undefined; });
  return pending;
}

export async function downloadDesktop(_req, res) {
  res.set('Cache-Control', 'no-store');
  try { res.redirect(302, await installer()); }
  catch { res.redirect(302, releases); }
}
