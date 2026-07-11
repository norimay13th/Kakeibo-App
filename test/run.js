const isNode = typeof require === "function" && typeof module === "object";
const Parser = isNode ? require("../parser.js") : window.Parser;
const Aggregate = isNode ? require("../aggregate.js") : window.Aggregate;
const fixtures = isNode ? require("./fixtures.js") : window.Fixtures;

let failures = 0;

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

// --- extractCategories ---
const categories = Parser.extractCategories(fixtures.ruleRows);
assertEqual(
  categories,
  ["食費", "生活費", "娯楽費", "自己投資", "雑費", "医療費"],
  "extractCategories pulls the 6 category names from ルール"
);

// --- parseKakeibo ---
const kakeibo = Parser.parseKakeibo(fixtures.kakeiboRows, categories);
assertEqual(kakeibo.length, 16, "parseKakeibo entry count");
assertEqual(
  kakeibo.every((e) => e.unknown === false),
  true,
  "parseKakeibo: all sample categories are known"
);
assertEqual(kakeibo[0], {
  month: "2026年7月",
  day: "1日",
  category: "医療費",
  item: "歯医者",
  amount: 4320,
  unknown: false,
}, "parseKakeibo first entry shape");
assertEqual(
  kakeibo.filter((e) => e.day === "2日").map((e) => e.amount),
  [1000, 2789],
  "parseKakeibo groups rows under the correct day header"
);

// unknown-category detection
const withBadCategory = Parser.parseKakeibo(
  [["2026年7月", "", ""], ["1日", "", ""], ["謎の出費", "何か", "¥500"]],
  categories
);
assertEqual(withBadCategory[0].unknown, true, "parseKakeibo flags categories not in the rule list");

// --- parseAssets (資産: カテゴリー/名称/金額) ---
const assets = Parser.parseAssets(fixtures.assetRows);
assertEqual(assets.length, 6, "parseAssets entry count");
assertEqual(assets[0], { month: "2026年7月", type: "現金", name: "楽天銀行", amount: 135354 }, "parseAssets first entry shape");
assertEqual(
  assets.filter((e) => e.type === "現金").reduce((t, e) => t + e.amount, 0),
  391802,
  "parseAssets 現金 total"
);
assertEqual(
  assets.filter((e) => e.type === "株式").reduce((t, e) => t + e.amount, 0),
  169437,
  "parseAssets 株式 total"
);

// --- parseNameAmount (固定費) ---
const fixedCosts = Parser.parseNameAmount(fixtures.fixedCostRows);
assertEqual(fixedCosts.length, 12, "parseNameAmount (固定費) entry count");
const fixedCostTotal = fixedCosts.reduce((t, e) => t + e.amount, 0);
assertEqual(fixedCostTotal, 100632, "固定費 July total");

// --- parseIncome ---
const income = Parser.parseIncome(fixtures.incomeRows);
assertEqual(income, [
  { month: "2026年6月", type: "正社員", name: "ANREALAGE 給与手取り", amount: 225433 },
  { month: "2026年6月", type: "個人事業", name: "動画編集 ユウキ", amount: 200000 },
], "parseIncome");

// --- parseLoan ---
const loans = Parser.parseLoan(fixtures.loanRows);
assertEqual(loans.length, 3, "parseLoan entry count");
assertEqual(loans[0], { month: "2026年7月", name: "iPhone15 36回分割 (28回目)", balance: 37144, payment: 4128 }, "parseLoan first entry");
assertEqual(loans.reduce((t, e) => t + e.payment, 0), 21949, "loan payment total");

// --- parseDebt ---
const debts = Parser.parseDebt(fixtures.debtRows);
assertEqual(debts, [
  { month: "2026年7月", name: "アコム", balance: 452629, payment: 14000 },
  { month: "2026年7月", name: "レイク", balance: 94488, payment: 3000 },
], "parseDebt");

// --- aggregate: monthlyExpenseByCategory ---
const byCategory = Aggregate.monthlyExpenseByCategory(kakeibo, "2026年7月");
assertEqual(byCategory, {
  医療費: 4920,
  娯楽費: 12600,
  雑費: 2320,
  食費: 5620,
  生活費: 5710,
}, "monthlyExpenseByCategory totals");

// --- aggregate: monthlySavings ---
const savings = Aggregate.monthlySavings(
  { income, kakeibo, fixedCosts, loans, debts },
  "2026年7月"
);
assertEqual(savings.expenseTotal, 31170, "monthlySavings expenseTotal (家計簿 July subset)");
assertEqual(savings.fixedCostTotal, 100632, "monthlySavings fixedCostTotal");
assertEqual(savings.loanPaymentTotal, 21949, "monthlySavings loanPaymentTotal");
assertEqual(savings.debtPaymentTotal, 17000, "monthlySavings debtPaymentTotal");
assertEqual(savings.incomeTotal, 0, "monthlySavings incomeTotal (収入 fixture is for June, not July)");
assertEqual(savings.savings, -170751, "monthlySavings final savings figure");

const dataset = { income, kakeibo, fixedCosts, loans, debts, assets };

// --- aggregate: netWorthAsOf ---
assertEqual(
  Aggregate.netWorthAsOf(dataset, "2026年7月"),
  { month: "2026年7月", assetsTotal: 561239, liabilitiesTotal: 931442, netWorth: -370203 },
  "netWorthAsOf on the exact recorded month"
);

// --- aggregate: carryForwardSum ---
assertEqual(
  Aggregate.carryForwardSum(assets, "2026年8月", "amount"),
  { month: "2026年7月", total: 561239 },
  "carryForwardSum rolls a later month forward to the last recorded snapshot"
);
assertEqual(
  Aggregate.carryForwardSum(assets, "2026年1月", "amount"),
  { month: null, total: 0 },
  "carryForwardSum returns 0 for a month before any data exists"
);

// --- aggregate: assetAllocationAsOf ---
assertEqual(
  Aggregate.assetAllocationAsOf(assets, "2026年7月"),
  { cash: 391802, stock: 169437 },
  "assetAllocationAsOf splits 現金/株式"
);

// --- aggregate: monthlyExpenseBreakdown (8-slice pie) ---
assertEqual(
  Aggregate.monthlyExpenseBreakdown(dataset, "2026年7月"),
  {
    医療費: 4920,
    娯楽費: 12600,
    雑費: 2320,
    食費: 5620,
    生活費: 5710,
    固定費: 100632,
    "借金・ローン返済": 38949,
  },
  "monthlyExpenseBreakdown adds 固定費 and 借金・ローン返済 to the 6 categories"
);

// --- aggregate: monthlyCategoryTotals (8-row category comparison table) ---
assertEqual(
  Aggregate.monthlyCategoryTotals(dataset, "2026年7月"),
  [
    { label: "固定費", amount: 100632 },
    { label: "負債返済額", amount: 38949 },
    { label: "食費", amount: 5620 },
    { label: "雑費", amount: 2320 },
    { label: "生活費", amount: 5710 },
    { label: "娯楽費", amount: 12600 },
    { label: "自己投資", amount: 0 },
    { label: "医療費", amount: 4920 },
  ],
  "monthlyCategoryTotals returns the fixed 8-row breakdown, ローン+借金 merged into 負債返済額"
);

// --- aggregate: incomeItems ---
assertEqual(
  Aggregate.incomeItems(income, "2026年6月"),
  [
    { name: "ANREALAGE 給与手取り", amount: 225433 },
    { name: "動画編集 ユウキ", amount: 200000 },
  ],
  "incomeItems lists 収入 entries for the exact month, amount descending"
);
assertEqual(Aggregate.incomeItems(income, "2026年7月"), [], "incomeItems is empty for a month with no income rows");

// --- aggregate: assetItemsAsOf ---
assertEqual(
  Aggregate.assetItemsAsOf(assets, "2026年7月"),
  {
    month: "2026年7月",
    cash: [
      { name: "きらぼし銀行", amount: 230106 },
      { name: "楽天銀行", amount: 135354 },
      { name: "楽天Pay", amount: 19636 },
      { name: "財布", amount: 6000 },
      { name: "PayPay", amount: 706 },
    ],
    stock: [{ name: "楽天証券", amount: 169437 }],
  },
  "assetItemsAsOf splits itemized 資産 entries into 現金/株式, amount descending"
);
assertEqual(
  Aggregate.assetItemsAsOf(assets, "2026年8月").month,
  "2026年7月",
  "assetItemsAsOf carries forward to the last recorded month"
);

// --- aggregate: liabilityItemsAsOf ---
assertEqual(
  Aggregate.liabilityItemsAsOf(loans, debts, "2026年7月"),
  {
    loans: {
      month: "2026年7月",
      items: [
        { name: "Mac Book Pro M2PRO 32GB 1TB", payment: 12321, balance: 160181 },
        { name: "LUMIX-S5IIX 契約日2024/3/25日", payment: 5500, balance: 187000 },
        { name: "iPhone15 36回分割 (28回目)", payment: 4128, balance: 37144 },
      ],
    },
    debts: {
      month: "2026年7月",
      items: [
        { name: "アコム", payment: 14000, balance: 452629 },
        { name: "レイク", payment: 3000, balance: 94488 },
      ],
    },
  },
  "liabilityItemsAsOf lists itemized ローン/借金 entries with balance, payment descending"
);

// --- aggregate: dayNumber / kakeiboTotalAsOfDay / spendingPaceInsight ---
assertEqual(Aggregate.dayNumber("3日"), 3, "dayNumber parses a day label");
assertEqual(Aggregate.dayNumber(""), null, "dayNumber returns null for an empty label");

assertEqual(
  Aggregate.kakeiboTotalAsOfDay(kakeibo, "2026年7月", 2),
  14009,
  "kakeiboTotalAsOfDay sums only entries on or before the given day"
);
assertEqual(
  Aggregate.kakeiboTotalAsOfDay(kakeibo, "2026年7月", null),
  31170,
  "kakeiboTotalAsOfDay with maxDay=null sums the whole month (matches monthlySavings.expenseTotal)"
);

assertEqual(Aggregate.spendingPaceInsight(kakeibo, "2026年7月", null), null, "spendingPaceInsight is null with no previous month");
assertEqual(
  Aggregate.spendingPaceInsight(kakeibo, "2026年7月", "2026年6月", new Date("2026-08-01")),
  { month: "2026年7月", prevMonth: "2026年6月", asOfDay: null, current: 31170, previous: 0, diff: 31170 },
  "spendingPaceInsight compares full months when the viewed month is already in the past"
);
assertEqual(
  Aggregate.spendingPaceInsight(kakeibo, "2026年7月", "2026年6月", new Date("2026-07-02")),
  {
    month: "2026年7月",
    prevMonth: "2026年6月",
    asOfDay: 2,
    current: 14009,
    previous: 0,
    diff: 14009,
  },
  "spendingPaceInsight caps both months at today's day-of-month when viewing the real current month"
);

// --- aggregate: previousMonth ---
assertEqual(
  Aggregate.previousMonth(["2026年6月", "2026年7月"], "2026年7月"),
  "2026年6月",
  "previousMonth finds the prior entry in a sorted month list"
);
assertEqual(Aggregate.previousMonth(["2026年7月"], "2026年7月"), null, "previousMonth is null with no earlier month");

// --- aggregate: distinctYears ---
assertEqual(Aggregate.distinctYears(assets), [2026], "distinctYears");

// --- aggregate: yearlySeries ---
const series2026 = Aggregate.yearlySeries(dataset, 2026);
assertEqual(series2026.length, 12, "yearlySeries covers all 12 months");
assertEqual(
  series2026.find((s) => s.month === "2026年6月"),
  { month: "2026年6月", income: 425433, expense: 0, savings: 425433, liabilities: 0, assets: 0 },
  "yearlySeries: June has income but no carried-forward balances yet (July is later)"
);
assertEqual(
  series2026.find((s) => s.month === "2026年7月"),
  { month: "2026年7月", income: 0, expense: 170751, savings: -170751, liabilities: 931442, assets: 561239 },
  "yearlySeries: July has expenses and its own balances"
);
assertEqual(
  series2026.find((s) => s.month === "2026年8月"),
  { month: "2026年8月", income: 0, expense: 0, savings: 0, liabilities: 931442, assets: 561239 },
  "yearlySeries: August carries July's balances forward with no new flow"
);

// --- aggregate: month sorting ---
assertEqual(
  Aggregate.sortMonths(["2026年3月", "2025年12月", "2026年1月"]),
  ["2025年12月", "2026年1月", "2026年3月"],
  "sortMonths handles year rollover correctly"
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
if (isNode) {
  process.exit(failures === 0 ? 0 : 1);
} else if (typeof document !== "undefined") {
  document.body.textContent =
    failures === 0 ? "All checks passed." : `${failures} check(s) failed. See console.`;
  document.body.style.color = failures === 0 ? "green" : "red";
}
