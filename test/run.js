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

// --- parseNameAmount (資産 / 固定費) ---
const assets = Parser.parseNameAmount(fixtures.assetRows);
assertEqual(assets, [{ month: "2026年7月", name: "楽天証券", amount: 169437 }], "parseNameAmount (資産)");

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

// --- aggregate: netWorthByMonth ---
const netWorth = Aggregate.netWorthByMonth({ assets, loans, debts });
assertEqual(netWorth, [
  { month: "2026年7月", assetsTotal: 169437, liabilitiesTotal: 931442, netWorth: -762005 },
], "netWorthByMonth");

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
