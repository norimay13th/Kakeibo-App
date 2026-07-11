// User-specific settings. Fill in GOOGLE_CLIENT_ID after completing the Google Cloud setup steps in README.md.
const CONFIG = {
  // OAuth 2.0 Client ID (Web application) from Google Cloud Console. This is a public identifier, not a secret.
  GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",

  // The "¥¥¥" spreadsheet.
  SPREADSHEET_ID: "1UsPdLJs_s1miIROKsYfRf20GTI-xCV_WLRYHMLYq8rc",

  // Name of the tab entries get appended to by the (currently paused) camera-capture feature.
  SHEET_NAME: "ログ",

  // Tab names the dashboard reads from. Update these if you rename a tab in the spreadsheet
  // (e.g. once you settle on 家計簿(A案) as the final format, you may want to rename it to just 家計簿).
  DASHBOARD_SHEETS: {
    KAKEIBO: "家計簿(A案)",
    ASSETS: "資産",
    INCOME: "収入",
    LOANS: "ローン",
    DEBTS: "借金",
    FIXED_COSTS: "固定費",
    RULES: "ルール",
  },
};
