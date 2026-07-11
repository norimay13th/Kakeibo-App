// User-specific settings. Fill in GOOGLE_API_KEY after completing the Google Cloud setup steps in README.md.
const CONFIG = {
  // API key restricted to the Google Sheets API + this app's domain. The spreadsheet is
  // shared as "anyone with the link can view", so no user sign-in is needed to read it —
  // this key just lets the browser call the Sheets API directly.
  GOOGLE_API_KEY: "AIzaSyBCXOwehEeUICG16us8oor-B-K9gA_Ok9Q",

  // The "¥¥¥" spreadsheet.
  SPREADSHEET_ID: "1UsPdLJs_s1miIROKsYfRf20GTI-xCV_WLRYHMLYq8rc",

  // Tab names the dashboard reads from. Update these if you rename a tab in the spreadsheet.
  DASHBOARD_SHEETS: {
    KAKEIBO: "支出",
    ASSETS: "資産",
    INCOME: "収入",
    LOANS: "ローン",
    DEBTS: "借金",
    FIXED_COSTS: "固定費",
    RULES: "ルール",
  },
};
