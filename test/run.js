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
assertEqual(
  loans[0],
  {
    month: "2026年7月",
    name: "iPhone15 36回分割 (28回目)",
    balance: 37144,
    payment: 4128,
    installmentTotal: 36,
    installmentRemaining: 9,
  },
  "parseLoan first entry"
);
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
    負債返済額: 38949,
  },
  "monthlyExpenseBreakdown adds 固定費 and 負債返済額 to the 6 categories (same label as monthlyCategoryTotals)"
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

// --- aggregate: expenseSummary ---
assertEqual(
  Aggregate.expenseSummary(dataset, "2026年7月"),
  { fixedCost: 100632, debtPayment: 38949, variableExpense: 31170 },
  "expenseSummary splits the 8-row breakdown into 固定費/負債返済額/変動支出"
);

// --- aggregate: monthlyVariableCategoryTotals ---
assertEqual(
  Aggregate.monthlyVariableCategoryTotals(kakeibo, "2026年7月"),
  [
    { label: "食費", amount: 5620 },
    { label: "雑費", amount: 2320 },
    { label: "生活費", amount: 5710 },
    { label: "娯楽費", amount: 12600 },
    { label: "自己投資", amount: 0 },
    { label: "医療費", amount: 4920 },
  ],
  "monthlyVariableCategoryTotals returns the 6 家計簿 categories only, excluding 固定費/負債返済額"
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

// --- aggregate: fixedCostItems ---
assertEqual(
  Aggregate.fixedCostItems(fixedCosts, "2026年7月"),
  [
    { name: "家賃+管理費 (27日 口座引落)", amount: 44000 },
    { name: "交通費(菊名↔明治神宮前)", amount: 17720 },
    { name: "光熱費+水道", amount: 12000 },
    { name: "積立投資(オルカン)", amount: 10000 },
    { name: "Claude", amount: 3500 },
    { name: "通信費 (Rakuten Mobile)", amount: 3200 },
    { name: "Adobe (年契約 要見直し)", amount: 3140 },
    { name: "Oops (一括:¥35,349)", amount: 3000 },
    { name: "APPLE ONE", amount: 1980 },
    { name: "Chat GPT", amount: 1200 },
    { name: "Amazon Prime (年間:¥5,900)", amount: 492 },
    { name: "UVERworld (年間:¥5,500)", amount: 400 },
  ],
  "fixedCostItems lists 固定費 entries for the month, amount descending"
);
assertEqual(Aggregate.fixedCostItems(fixedCosts, "2026年8月"), [], "fixedCostItems is empty for a month with no rows");

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
        { name: "Mac Book Pro M2PRO 32GB 1TB", payment: 12321, balance: 160181, installmentTotal: 18, installmentRemaining: 13 },
        { name: "LUMIX-S5IIX 契約日2024/3/25日", payment: 5500, balance: 187000, installmentTotal: 60, installmentRemaining: 34 },
        { name: "iPhone15 36回分割 (28回目)", payment: 4128, balance: 37144, installmentTotal: 36, installmentRemaining: 9 },
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

// --- aggregate: kakeiboItemsByDay ---
const byDay = Aggregate.kakeiboItemsByDay(kakeibo, "2026年7月");
assertEqual(byDay.length, 16, "kakeiboItemsByDay covers all July entries");
assertEqual(
  byDay[0],
  { day: "1日", category: "医療費", item: "歯医者", amount: 4320 },
  "kakeiboItemsByDay first entry shape"
);
assertEqual(
  byDay.map((e) => e.day),
  ["1日", "1日", "1日", "1日", "1日", "2日", "2日", "3日", "3日", "3日", "4日", "4日", "4日", "6日", "6日", "8日"],
  "kakeiboItemsByDay is sorted ascending by day"
);
assertEqual(Aggregate.kakeiboItemsByDay(kakeibo, "2026年8月"), [], "kakeiboItemsByDay is empty for a month with no entries");

const shuffledByDay = [
  { month: "2099年1月", day: "5日", category: "食費", item: "B", amount: 200 },
  { month: "2099年1月", day: "2日", category: "食費", item: "A", amount: 100 },
  { month: "2099年1月", day: "5日", category: "食費", item: "A2", amount: 50 },
];
assertEqual(
  Aggregate.kakeiboItemsByDay(shuffledByDay, "2099年1月"),
  [
    { day: "2日", category: "食費", item: "A", amount: 100 },
    { day: "5日", category: "食費", item: "B", amount: 200 },
    { day: "5日", category: "食費", item: "A2", amount: 50 },
  ],
  "kakeiboItemsByDay sorts by day but keeps original relative order for same-day entries"
);

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

// --- aggregate: hasMonthData ---
assertEqual(
  Aggregate.hasMonthData(dataset, "2026年6月"),
  true,
  "hasMonthData: true when 収入 alone has an entry for the month"
);
assertEqual(
  Aggregate.hasMonthData(dataset, "2026年7月"),
  true,
  "hasMonthData: true when 家計簿/固定費/ローン/借金 have entries"
);
assertEqual(
  Aggregate.hasMonthData(dataset, "2026年8月"),
  false,
  "hasMonthData: false when no flow-type sheet has any entry for the month"
);

// --- aggregate: yearlySeries ---
const series2026 = Aggregate.yearlySeries(dataset, 2026);
assertEqual(series2026.length, 12, "yearlySeries covers all 12 months");
assertEqual(
  series2026.find((s) => s.month === "2026年1月"),
  {
    month: "2026年1月",
    income: null, expense: null, savings: null,
    netWorth: null, netWorthAsOfMonth: null,
    liabilities: null, liabilitiesAsOfMonth: null,
    assets: null, assetsAsOfMonth: null,
    cash: null, stock: null,
  },
  "yearlySeries: a month before any data exists anywhere is null across the board (flow AND snapshot fields), not a confident ¥0"
);
assertEqual(
  series2026.find((s) => s.month === "2026年6月"),
  {
    month: "2026年6月",
    income: 425433, expense: 0, savings: 425433,
    netWorth: null, netWorthAsOfMonth: null,
    liabilities: null, liabilitiesAsOfMonth: null,
    assets: null, assetsAsOfMonth: null,
    cash: null, stock: null,
  },
  "yearlySeries: June has a 収入 entry so income/expense/savings are real, but 資産/負債 fixtures only start in July so those stay null (nothing to carry forward from yet)"
);
assertEqual(
  series2026.find((s) => s.month === "2026年7月"),
  {
    month: "2026年7月",
    income: 0, expense: 170751, savings: -170751,
    netWorth: -370203, netWorthAsOfMonth: "2026年7月",
    liabilities: 931442, liabilitiesAsOfMonth: "2026年7月",
    assets: 561239, assetsAsOfMonth: "2026年7月",
    cash: 391802, stock: 169437,
  },
  "yearlySeries: July is recorded this exact month, so every snapshot field's asOfMonth equals July itself (confirmed, not carried forward)"
);
assertEqual(
  series2026.find((s) => s.month === "2026年8月"),
  {
    month: "2026年8月",
    income: null, expense: null, savings: null,
    netWorth: -370203, netWorthAsOfMonth: "2026年7月",
    liabilities: 931442, liabilitiesAsOfMonth: "2026年7月",
    assets: 561239, assetsAsOfMonth: "2026年7月",
    cash: 391802, stock: 169437,
  },
  "yearlySeries: August has no entry anywhere, so flow fields are null, but snapshot fields carry July's values forward with asOfMonth still pointing at July (extrapolated, not confirmed)"
);
assertEqual(
  series2026.find((s) => s.month === "2026年12月").income,
  null,
  "yearlySeries: December (also unrecorded) is null too, not just the month right after July"
);

// --- aggregate: seriesWithDiff ---
const incomeDiff = Aggregate.seriesWithDiff(series2026, "income");
assertEqual(incomeDiff[0], { month: "2026年1月", value: null, diff: null }, "seriesWithDiff: no data and no previous month -> null value, null diff");
assertEqual(incomeDiff[5], { month: "2026年6月", value: 425433, diff: null }, "seriesWithDiff: real value but previous month (May) has none -> diff null");
assertEqual(incomeDiff[6], { month: "2026年7月", value: 0, diff: -425433 }, "seriesWithDiff: both months real -> diff is the actual difference");
assertEqual(incomeDiff[7], { month: "2026年8月", value: null, diff: null }, "seriesWithDiff: no data this month -> null value, null diff even though previous month was real");

const assetsDiff = Aggregate.seriesWithDiff(series2026, "assets");
assertEqual(assetsDiff[6], { month: "2026年7月", value: 561239, diff: null }, "seriesWithDiff on a snapshot field: July is the first real value (June was null, nothing to diff against yet)");
assertEqual(assetsDiff[7], { month: "2026年8月", value: 561239, diff: 0 }, "seriesWithDiff on a snapshot field: August carries forward unchanged, diff 0 (not null, since both months resolve to real snapshot values)");

// --- aggregate: categoryStandout ---
assertEqual(
  Aggregate.categoryStandout(dataset, "2026年7月", null),
  null,
  "categoryStandout is null with no previous month"
);
assertEqual(
  Aggregate.categoryStandout(dataset, "2026年7月", "2026年6月"),
  { label: "固定費", diff: 100632 },
  "categoryStandout picks the category with the largest swing vs last month (固定費 has no June data, so it's the whole ¥100,632)"
);
assertEqual(
  Aggregate.categoryStandout({ kakeibo, fixedCosts: [], loans: [], debts: [] }, "2026年7月", "2026年7月"),
  null,
  "categoryStandout returns null when the biggest swing is under the ¥1,000 threshold (identical month vs itself)"
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
