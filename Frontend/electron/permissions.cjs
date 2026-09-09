function allowPermission({ contents, permission, window, selectedSource, selectionExpires, trusted }) {
  if (!contents || contents !== window?.webContents || !trusted(contents.mainFrame)) return false;
  if (permission === 'fullscreen') return true;
  return (permission === 'display-capture' || permission === 'media') &&
    !!selectedSource && Date.now() < selectionExpires;
}

module.exports = { allowPermission };
