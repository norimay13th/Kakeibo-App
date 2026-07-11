// Google sign-in (GIS token client) + read-only Sheets API access, all client-side, no server involved.
const SheetsClient = (() => {
  const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
  // index.html and trend.html are separate page loads, so an in-memory-only token would
  // force a fresh sign-in every time you switch tabs. sessionStorage survives navigation
  // within the same browser tab (and is cleared when the tab closes), which is the right
  // lifetime for a short-lived OAuth access token.
  const STORAGE_KEY = "kakeibo_token";

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let onAuthChange = () => {};

  function loadStoredToken() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const { token, expiresAt } = JSON.parse(raw);
      if (token && expiresAt && Date.now() < expiresAt - 30000) {
        accessToken = token;
        tokenExpiresAt = expiresAt;
      }
    } catch (e) {
      // Ignore corrupt/inaccessible storage; just fall back to requiring sign-in.
    }
  }

  function storeToken() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: accessToken, expiresAt: tokenExpiresAt }));
    } catch (e) {
      // Ignore storage failures (e.g. private browsing); auth still works for this page load.
    }
  }

  function clearStoredToken() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // Ignore.
    }
  }

  loadStoredToken();

  function isTokenValid() {
    return accessToken && Date.now() < tokenExpiresAt - 30000;
  }

  function init(authChangeCallback) {
    onAuthChange = authChangeCallback || onAuthChange;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) {
          onAuthChange(false, response.error);
          return;
        }
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + response.expires_in * 1000;
        storeToken();
        onAuthChange(true);
      },
    });
    // A token restored from a previous page in this tab is already valid; let the caller know.
    if (isTokenValid()) onAuthChange(true);
  }

  const SIGN_IN_TIMEOUT_MS = 30000;

  function signIn(interactive) {
    const attempt = new Promise((resolve, reject) => {
      if (isTokenValid()) {
        resolve(accessToken);
        return;
      }
      const prevCallback = tokenClient.callback;
      tokenClient.callback = (response) => {
        tokenClient.callback = prevCallback;
        if (response.error) {
          onAuthChange(false, response.error);
          reject(new Error(response.error));
          return;
        }
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + response.expires_in * 1000;
        storeToken();
        onAuthChange(true);
        resolve(accessToken);
      };
      tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    });

    const timeout = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error("サインインがタイムアウトしました。ポップアップがブロックされていないか確認してください"));
      }, SIGN_IN_TIMEOUT_MS);
    });

    return Promise.race([attempt, timeout]);
  }

  async function ensureSignedIn() {
    if (isTokenValid()) return accessToken;
    return signIn(true);
  }

  async function batchGetValues(sheetNames) {
    const token = await ensureSignedIn();
    const params = sheetNames
      .map((name) => `ranges=${encodeURIComponent(name)}`)
      .join("&");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values:batchGet?${params}`;

    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      accessToken = null;
      clearStoredToken();
      const freshToken = await ensureSignedIn();
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${freshToken}` },
      });
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`スプレッドシートの読み取りに失敗しました (${res.status}): ${body}`);
    }

    const data = await res.json();
    // Map sheet name -> 2D values array (missing/empty ranges come back without `values`).
    const result = {};
    (data.valueRanges || []).forEach((vr, i) => {
      result[sheetNames[i]] = vr.values || [];
    });
    return result;
  }

  function isSignedIn() {
    return isTokenValid();
  }

  return { init, signIn, ensureSignedIn, batchGetValues, isSignedIn };
})();
