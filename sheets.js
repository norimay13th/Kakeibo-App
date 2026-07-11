// Read-only Sheets API access via a restricted API key. No sign-in: the spreadsheet is
// already shared as "anyone with the link can view", so this reads the same data a
// visitor could see by opening the sheet directly — no OAuth consent flow needed.
const SheetsClient = (() => {
  async function batchGetValues(sheetNames) {
    const params = sheetNames.map((name) => `ranges=${encodeURIComponent(name)}`).join("&");
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values:batchGet?${params}&key=${CONFIG.GOOGLE_API_KEY}`;

    const res = await fetch(url);
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

  return { batchGetValues };
})();
