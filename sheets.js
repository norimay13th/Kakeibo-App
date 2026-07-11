// Google sign-in (GIS token client) + Sheets API append, all client-side, no server involved.
const SheetsClient = (() => {
  const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let onAuthChange = () => {};

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
        onAuthChange(true);
      },
    });
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

  async function appendRow(row) {
    const token = await ensureSignedIn();
    const range = encodeURIComponent(`${CONFIG.SHEET_NAME}!A:H`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    let res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [row] }),
    });

    if (res.status === 401) {
      // Token expired between check and request; force a fresh one and retry once.
      accessToken = null;
      const freshToken = await ensureSignedIn();
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${freshToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [row] }),
      });
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`スプレッドシートへの保存に失敗しました (${res.status}): ${body}`);
    }
    return res.json();
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

  return { init, signIn, ensureSignedIn, appendRow, batchGetValues, isSignedIn };
})();
