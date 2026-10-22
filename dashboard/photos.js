// Photos (Skreen+): a slideshow from a Google Drive folder that is shared "Anyone with the link".
// Skreen reads the folder's list of pictures with a Drive API key (no sign-in and no access to the
// rest of your Drive), and shows each picture from Drive's thumbnail address.
// Google Photos albums can't be read by apps, so pictures need to be in a Drive folder.
const Photos = (() => {
  // A Google Cloud API key, restricted to the Drive API and to the https://app.skreen.fyi/ website.
  // Such a key is meant to sit in public code; the restrictions are what protect it.
  const API_KEY = '';

  const folderId = (text) => {
    const s = String(text || '').trim();
    const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
    if (m) return m[1];
    return /^[\w-]{10,}$/.test(s) ? s : '';
  };

  async function list(folder) {
    if (!API_KEY) throw new Error('not configured');
    const out = [];
    let page = '';
    for (let n = 0; n < 4; n++) {
      const q = new URLSearchParams({
        q: `'${folder}' in parents and mimeType contains 'image/' and trashed = false`,
        fields: 'nextPageToken,files(id,name)', pageSize: '200', key: API_KEY,
        supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      });
      if (page) q.set('pageToken', page);
      const res = await fetch('https://www.googleapis.com/drive/v3/files?' + q);
      if (res.status === 404 || res.status === 403) throw new Error('folder not shared');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      out.push(...(j.files || []).map((f) => f.id));
      page = j.nextPageToken || '';
      if (!page) break;
    }
    return out;
  }

  const url = (id, width = 1920) => `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${width}`;

  // A shuffled order that shows every picture before repeating any.
  function shuffled(ids) {
    const a = ids.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  return { configured: !!API_KEY, folderId, list, url, shuffled };
})();
