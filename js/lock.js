// Face ID（パスキー / WebAuthn）による画面ロック
// - STRIDE（index.html）とタスク画面（tasks/index.html）の両方で、<head> の中で読み込む（ES Modules ではない通常のスクリプト）
// - 起動時と、一定時間アプリから離れて戻ったときに、Face ID（失敗時は端末のパスコード）での解除を求める
// - 目的は「ロック解除済みの端末をのぞかれない」ための画面ロック。保存データの暗号化は行わない
// - 設定は端末（ブラウザ）ごとに localStorage に保存する。記録データとは別のキー
(function () {
  'use strict';

  const CONFIG_KEY = 'stride.lock'; // { enabled, credId, relockMin }
  const UNLOCKED_AT = 'stride.lock.unlockedAt'; // sessionStorage：解除した時刻
  const HIDDEN_AT = 'stride.lock.hiddenAt'; // sessionStorage：アプリから離れた時刻
  const DEFAULT_RELOCK_MIN = 5;

  /* ---------- 設定の読み書き ---------- */

  function readConfig() {
    try {
      const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
      return c && c.enabled && c.credId ? c : { enabled: false, credId: null, relockMin: DEFAULT_RELOCK_MIN };
    } catch (_) {
      return { enabled: false, credId: null, relockMin: DEFAULT_RELOCK_MIN };
    }
  }

  function writeConfig(c) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  }

  function sessionGet(key) {
    try { return Number(sessionStorage.getItem(key)) || 0; } catch (_) { return 0; }
  }
  function sessionSet(key, value) {
    try { sessionStorage.setItem(key, String(value)); } catch (_) { /* 何もしない */ }
  }

  /** 今ロックすべきか（このタブで解除済みで、離れていた時間が設定以内なら不要） */
  function shouldLock(config) {
    if (!config.enabled) return false;
    const unlockedAt = sessionGet(UNLOCKED_AT);
    if (!unlockedAt) return true;
    const hiddenAt = sessionGet(HIDDEN_AT);
    if (!hiddenAt) return false;
    // STRIDE とタスク画面の行き来（ページの切り替え）でも一瞬 hidden になるため、10 秒以内は離れたとみなさない
    const limit = Math.max(config.relockMin * 60 * 1000, 10 * 1000);
    return Date.now() - hiddenAt > limit;
  }

  /* ---------- WebAuthn（パスキー） ---------- */

  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fromB64 = (s) => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
  };
  const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

  /** この端末で Face ID / Touch ID / Windows Hello などが使えるか */
  async function isSupported() {
    try {
      return Boolean(window.PublicKeyCredential && window.isSecureContext
        && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch (_) {
      return false;
    }
  }

  /** 認証器のデータで「本人確認（Face ID など）が行われた」印（UV フラグ）を確認する */
  function userVerified(authenticatorData) {
    const bytes = new Uint8Array(authenticatorData);
    return bytes.length > 32 && (bytes[32] & 0x04) !== 0;
  }

  /** パスキーを作る（作成時にも Face ID などの本人確認が行われる） */
  async function createPasskey() {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'STRIDE' },
        user: { id: randomBytes(16), name: 'STRIDE', displayName: 'STRIDE（画面ロック）' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
        attestation: 'none',
      },
    });
    if (!cred) throw new Error('パスキーを作成できませんでした');
    return toB64(cred.rawId);
  }

  /** 登録済みのパスキーで本人確認する */
  async function verify(config) {
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: fromB64(config.credId), transports: ['internal', 'hybrid'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    if (!cred || !userVerified(cred.response.authenticatorData)) throw new Error('本人確認を完了できませんでした');
    return true;
  }

  /* ---------- ロック画面 ---------- */

  const STYLE = `
    html.is-locked body > *:not(.s-lock) { visibility: hidden !important; }
    html.is-locked body { overflow: hidden !important; }
    .s-lock {
      position: fixed; inset: 0; z-index: 2147483000;
      display: grid; place-items: center; padding: 24px;
      background: linear-gradient(160deg, #0c2040 0%, #164a8c 60%, #2a78d6 100%);
      color: #fff; font-family: system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif;
      text-align: center;
    }
    .s-lock-box { width: min(360px, 100%); }
    .s-lock-brand { font: italic 800 13px/1 "SF Pro Display", "Segoe UI", system-ui, sans-serif; letter-spacing: .24em; opacity: .8; }
    .s-lock-brand b { color: #8fc0ff; font-style: normal; margin-left: 2px; }
    .s-lock-icon { margin: 28px auto 12px; width: 72px; height: 72px; border-radius: 22px; display: grid; place-items: center;
      background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.25); }
    .s-lock-icon svg { width: 40px; height: 40px; fill: none; stroke: #fff; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .s-lock h1 { margin: 0 0 6px; font-size: 22px; font-weight: 800; }
    .s-lock p { margin: 0; font-size: 14px; opacity: .85; line-height: 1.6; }
    .s-lock-btn { display: block; width: 100%; min-height: 54px; margin-top: 26px; border: 0; border-radius: 16px;
      background: #fff; color: #0c2040; font: 800 17px system-ui, -apple-system, "Hiragino Sans", sans-serif; cursor: pointer;
      box-shadow: 0 8px 24px rgba(0,0,0,.25); }
    .s-lock-btn:disabled { opacity: .6; }
    .s-lock-msg { min-height: 1.6em; margin-top: 14px !important; color: #ffd9d4; opacity: 1 !important; }
    .s-lock-help { margin-top: 18px; background: none; border: 0; color: #fff; opacity: .75; font-size: 13px; text-decoration: underline; cursor: pointer; }
  `;

  let overlay = null;

  function ensureStyle() {
    if (document.getElementById('s-lock-style')) return;
    const st = document.createElement('style');
    st.id = 's-lock-style';
    st.textContent = STYLE;
    (document.head || document.documentElement).append(st);
  }

  function lockNow() {
    // 解除済みの記録を消す（ロック中に再読み込みしても、解除されたままにならないように）
    sessionSet(UNLOCKED_AT, 0);
    ensureStyle();
    document.documentElement.classList.add('is-locked');
    if (document.body) showOverlay();
    else document.addEventListener('DOMContentLoaded', showOverlay, { once: true });
  }

  function unlockNow() {
    sessionSet(UNLOCKED_AT, Date.now());
    sessionSet(HIDDEN_AT, 0);
    document.documentElement.classList.remove('is-locked');
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function showOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 's-lock';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'STRIDE はロックされています');
    overlay.innerHTML = `
      <div class="s-lock-box">
        <div class="s-lock-brand">STRIDE<b>›</b></div>
        <div class="s-lock-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>
        <h1>ロックされています</h1>
        <p>Face ID で解除してください。<br>うまくいかないときは iPhone のパスコードでも解除できます。</p>
        <button type="button" class="s-lock-btn">Face ID で解除</button>
        <p class="s-lock-msg" role="status"></p>
        <button type="button" class="s-lock-help">解除できないとき（パスキーを作り直す）</button>
      </div>`;
    document.body.append(overlay);
    const btn = overlay.querySelector('.s-lock-btn');
    const msg = overlay.querySelector('.s-lock-msg');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = '';
      try {
        await verify(readConfig());
        unlockNow();
      } catch (e) {
        msg.textContent = e && e.name === 'NotAllowedError'
          ? '解除できませんでした（キャンセル、または時間切れ）。もう一度お試しください。'
          : '解除できませんでした。パスキーが見つからない場合は、下の「解除できないとき」を使ってください。';
      } finally {
        btn.disabled = false;
      }
    });
    overlay.querySelector('.s-lock-help').addEventListener('click', async () => {
      // パスキーを消してしまった場合の救済。作り直すときにも Face ID / パスコードの本人確認が行われる
      msg.textContent = '';
      try {
        const credId = await createPasskey();
        const c = readConfig();
        writeConfig({ ...c, enabled: true, credId });
        unlockNow();
      } catch (e) {
        msg.textContent = 'パスキーを作り直せませんでした。もう一度お試しください。';
      }
    });
    btn.focus();
  }

  /* ---------- 起動時・アプリに戻ったとき ---------- */

  if (shouldLock(readConfig())) lockNow();

  document.addEventListener('visibilitychange', () => {
    const config = readConfig();
    if (!config.enabled) return;
    if (document.visibilityState === 'hidden') {
      if (!document.documentElement.classList.contains('is-locked')) sessionSet(HIDDEN_AT, Date.now());
    } else if (shouldLock(config)) {
      lockNow();
    }
  });
  // iOS のホーム画面アプリは、画面を戻したときに pageshow だけが来ることがある
  window.addEventListener('pageshow', () => {
    if (shouldLock(readConfig())) lockNow();
  });

  /* ---------- 設定画面から使う関数 ---------- */

  window.StrideLock = {
    isSupported,
    getConfig: readConfig,
    /** ロックを有効にする（パスキーを作る） */
    async enable(relockMin = DEFAULT_RELOCK_MIN) {
      const credId = await createPasskey();
      writeConfig({ enabled: true, credId, relockMin });
      sessionSet(UNLOCKED_AT, Date.now());
    },
    /** ロックを無効にする（解除前に本人確認する） */
    async disable() {
      const c = readConfig();
      if (c.enabled) await verify(c);
      localStorage.removeItem(CONFIG_KEY);
    },
    setRelockMinutes(min) {
      const c = readConfig();
      if (c.enabled) writeConfig({ ...c, relockMin: min });
    },
    lockNow,
  };
})();
