// User-specific settings. Fill in GOOGLE_CLIENT_ID after completing the Google Cloud setup steps in README.md.
const CONFIG = {
  // OAuth 2.0 Client ID (Web application) from Google Cloud Console. This is a public identifier, not a secret.
  GOOGLE_CLIENT_ID: "538236216067-sl2rqn3l2dv5anbeuuel75b112sittaf.apps.googleusercontent.com",

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
