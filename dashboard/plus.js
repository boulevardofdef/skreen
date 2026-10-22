// Skreen Plus: who has the paid features.
//   • The Android app asks Google Play (Play Billing) through the SkreenNative bridge.
//   • A personal unlock code (checked against a hash, never stored in the clear) covers
//     sideloaded builds, the owner's own devices and testers.
// This is a convenience lock: everything runs on the device, so it keeps honest users
// honest. Features that live on Skreen's own servers (cloud calendar and list) will be
// enforced server-side when they exist.
const Plus = (() => {
  const NATIVE = window.SkreenNative || null;
  const CODE_HASH = '9c8503fa60692d99230756661cf7165eb930ee6e16156077d1a592b37de4ec97';
  const KEY = 'skreen-plus-code';
  const state = { play: false, price: '', canBuy: false, code: false };
  let onChange = () => {};

  // However it was typed (lower case, no hyphens, with or without SKR), reduce it to SKR-XXXX-XXXX-XXXX-XXXX.
  const canonical = (code) => {
    let s = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (s.length > 16 && s.startsWith('SKR')) s = s.slice(3);
    return 'SKR-' + (s.match(/.{1,4}/g) || []).join('-');
  };
  const hash = async (code) => {
    const bytes = new TextEncoder().encode('skreen-plus:' + canonical(code));
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  async function checkCode(code) {
    try { return !!code && (await hash(code)) === CODE_HASH; } catch (_) { return false; }   // no crypto on plain http
  }

  function readNative() {
    if (!NATIVE || !NATIVE.getPlus) return;
    try { Object.assign(state, JSON.parse(NATIVE.getPlus())); } catch (_) {}
  }

  async function init(cb) {
    onChange = cb || onChange;
    readNative();
    // Play answers a moment after launch; the app calls skreenPlus() when it does.
    window.skreenPlus = (json) => {
      try { Object.assign(state, typeof json === 'string' ? JSON.parse(json) : json); } catch (_) {}
      onChange();
    };
    let saved = '';
    try { saved = localStorage.getItem(KEY) || ''; } catch (_) {}
    state.code = await checkCode(saved);
    onChange();
  }

  async function redeem(code) {
    if (!(await checkCode(code))) return false;
    try { localStorage.setItem(KEY, canonical(code)); } catch (_) {}
    state.code = true;
    onChange();
    return true;
  }

  function forgetCode() {
    try { localStorage.removeItem(KEY); } catch (_) {}
    state.code = false;
    onChange();
  }

  const buy = () => { if (NATIVE && NATIVE.buyPlus) NATIVE.buyPlus(); };

  return { init, redeem, forgetCode, buy, active: () => state.play || state.code, state };
})();
