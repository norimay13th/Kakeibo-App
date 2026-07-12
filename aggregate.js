// Turns parsed sheet entries into the monthly/yearly figures the dashboard displays.
// Pure functions, no DOM dependency (Node-testable alongside parser.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Aggregate = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  // "2026年7月" -> 202607, for chronological sorting/comparison.
  function monthKey(label) {
    const m = /^(\d{4})年(\d{1,2})月$/.exec(label || "");
    if (!m) return null;
    return Number(m[1]) * 100 + Number(m[2]);
  }

  function sortMonths(months) {
    return [...new Set(months)].sort((a, b) => monthKey(a) - monthKey(b));
  }

  function distinctMonths(entries) {
    return sortMonths(entries.map((e) => e.month));
  }

  function distinctYears(entries) {
    const years = entries
      .map((e) => {
        const m = /^(\d{4})年/.exec(e.month || "");
        return m ? Number(m[1]) : null;
      })
      .filter((y) => y != null);
    return [...new Set(years)].sort((a, b) => a - b);
  }

  function previousMonth(months, targetMonth) {
    const sorted = sortMonths(months);
    const idx = sorted.indexOf(targetMonth);
    return idx > 0 ? sorted[idx - 1] : null;
  }

  function sumBy(entries, month, field) {
    return entries
      .filter((e) => e.month === month)
      .reduce((total, e) => total + (e[field] || 0), 0);
  }

  // Balance-type sheets (資産/ローン/借金) are snapshots, not monthly flows: if the
  // user hasn't re-recorded a given month yet, the true value is whatever was last
  // entered, not zero. Finds the latest month <= target with any entry and sums it.
  function carryForwardSum(entries, targetMonth, field) {
    const targetKey = monthKey(targetMonth);
    const asOf = sortMonths(entries.map((e) => e.month)).filter((m) => monthKey(m) <= targetKey);
    const month = asOf.length ? asOf[asOf.length - 1] : null;
    return { month, total: month ? sumBy(entries, month, field) : 0 };
  }

  function monthlyExpenseByCategory(kakeiboEntries, month) {
    const byCategory = {};
    kakeiboEntries
      .filter((e) => e.month === month)
      .forEach((e) => {
        byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      });
    return byCategory;
  }

  // 8-slice breakdown for the monthly pie chart: 6 fixed categories + 固定費 + 負債返済額.
  // Uses the same 負債返済額 label as monthlyCategoryTotals so a category keeps one
  // identity (and one color) across every chart/table that shows it.
  function monthlyExpenseBreakdown({ kakeibo, fixedCosts, loans, debts }, month) {
    const breakdown = monthlyExpenseByCategory(kakeibo, month);
    breakdown["固定費"] = sumBy(fixedCosts, month, "amount");
    breakdown["負債返済額"] = sumBy(loans, month, "payment") + sumBy(debts, month, "payment");
    return breakdown;
  }

  const EXPENSE_CATEGORY_ORDER = [
    "固定費",
    "負債返済額",
    "食費",
    "雑費",
    "生活費",
    "娯楽費",
    "自己投資",
    "医療費",
  ];

  // Fixed 8-row breakdown (固定費/負債返済額(ローン+借金合算) + the 6 家計簿 categories)
  // for the category comparison table and its matching drill-down modal.
  function monthlyCategoryTotals({ kakeibo, fixedCosts, loans, debts }, month) {
    const byCategory = monthlyExpenseByCategory(kakeibo, month);
    const values = {
      固定費: sumBy(fixedCosts, month, "amount"),
      負債返済額: sumBy(loans, month, "payment") + sumBy(debts, month, "payment"),
      ...byCategory,
    };
    return EXPENSE_CATEGORY_ORDER.map((label) => ({ label, amount: values[label] || 0 }));
  }

  // Itemized 収入 entries for the exact month (income is a flow, not a snapshot to carry forward).
  function incomeItems(income, month) {
    return income
      .filter((e) => e.month === month)
      .map((e) => ({ name: e.name, amount: e.amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  // Itemized 資産 entries as of `month`, carried forward to the latest recorded month and
  // split into 現金/株式 the same way assetAllocationAsOf totals them.
  function assetItemsAsOf(assets, month) {
    const carried = carryForwardSum(assets, month, "amount");
    const atMonth = carried.month ? assets.filter((e) => e.month === carried.month) : [];
    const byType = (type) =>
      atMonth
        .filter((e) => e.type === type)
        .map((e) => ({ name: e.name, amount: e.amount }))
        .sort((a, b) => b.amount - a.amount);
    return { month: carried.month, cash: byType("現金"), stock: byType("株式") };
  }

  // Itemized ローン/借金 entries as of `month`, including outstanding balance
  // alongside the payment amount. Each sheet's carry-forward month is resolved
  // independently, matching how netWorthAsOf totals them. ローン entries additionally
  // carry installmentRemaining/installmentTotal (借金 has no installment concept).
  function liabilityItemsAsOf(loans, debts, month) {
    const carryAndSort = (entries, extra) => {
      const carried = carryForwardSum(entries, month, "payment");
      const items = (carried.month ? entries.filter((e) => e.month === carried.month) : [])
        .map((e) => ({ name: e.name, payment: e.payment, balance: e.balance, ...extra(e) }))
        .sort((a, b) => b.payment - a.payment);
      return { month: carried.month, items };
    };
    return {
      loans: carryAndSort(loans, (e) => ({
        installmentTotal: e.installmentTotal,
        installmentRemaining: e.installmentRemaining,
      })),
      debts: carryAndSort(debts, () => ({})),
    };
  }

  // "3日" -> 3.
  function dayNumber(dayLabel) {
    const m = /^(\d{1,2})日$/.exec(dayLabel || "");
    return m ? Number(m[1]) : null;
  }

  // Variable (家計簿) spending total for `month`, optionally limited to entries
  // recorded on or before `maxDay` (day-of-month). maxDay=null means the whole month.
  function kakeiboTotalAsOfDay(kakeiboEntries, month, maxDay) {
    return kakeiboEntries
      .filter((e) => e.month === month && (maxDay == null || dayNumber(e.day) <= maxDay))
      .reduce((total, e) => total + e.amount, 0);
  }

  // Compares this month's variable spending against the same point last month, for the
  // "カテゴリー別支出" pace comment. Only 家計簿 entries carry a day, so the comparison
  // is scoped to that (固定費/ローン/借金/収入 are monthly lump sums with no day to limit by).
  // When `month` is the real current calendar month, both totals are capped at today's
  // day-of-month for a fair apples-to-apples comparison; a fully past month compares in full.
  function spendingPaceInsight(kakeiboEntries, month, prevMonth, today) {
    if (!prevMonth) return null;
    const now = today || new Date();
    const isCurrentRealMonth = monthKey(month) === now.getFullYear() * 100 + (now.getMonth() + 1);
    const asOfDay = isCurrentRealMonth ? now.getDate() : null;
    const current = kakeiboTotalAsOfDay(kakeiboEntries, month, asOfDay);
    const previous = kakeiboTotalAsOfDay(kakeiboEntries, prevMonth, asOfDay);
    return { month, prevMonth, asOfDay, current, previous, diff: current - previous };
  }

  // Finds the single category (of the 8-row monthlyCategoryTotals breakdown) with the
  // largest swing vs last month, for a "先月より食費が多いですね" style callout. Returns
  // null when there's no previous month, or the biggest swing is too small to be worth
  // mentioning (under ¥1,000).
  function categoryStandout(dataset, month, prevMonth) {
    if (!prevMonth) return null;
    const current = monthlyCategoryTotals(dataset, month);
    const previous = monthlyCategoryTotals(dataset, prevMonth);
    let best = null;
    current.forEach(({ label, amount }, i) => {
      const diff = amount - previous[i].amount;
      if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { label, diff };
    });
    return best && Math.abs(best.diff) >= 1000 ? best : null;
  }

  function monthlySavings({ income, kakeibo, fixedCosts, loans, debts }, month) {
    const incomeTotal = sumBy(income, month, "amount");
    const expenseTotal = sumBy(kakeibo, month, "amount");
    const fixedCostTotal = sumBy(fixedCosts, month, "amount");
    const loanPaymentTotal = sumBy(loans, month, "payment");
    const debtPaymentTotal = sumBy(debts, month, "payment");
    const totalOutflow = expenseTotal + fixedCostTotal + loanPaymentTotal + debtPaymentTotal;
    return {
      month,
      incomeTotal,
      expenseTotal,
      fixedCostTotal,
      loanPaymentTotal,
      debtPaymentTotal,
      totalOutflow,
      savings: incomeTotal - totalOutflow,
    };
  }

  // Point-in-time net worth as of `month`, carrying forward assets/loans/debts
  // independently so a sheet the user hasn't updated yet doesn't zero everything out.
  function netWorthAsOf({ assets, loans, debts }, month) {
    const assetsCarry = carryForwardSum(assets, month, "amount");
    const loansCarry = carryForwardSum(loans, month, "balance");
    const debtsCarry = carryForwardSum(debts, month, "balance");
    const assetsTotal = assetsCarry.total;
    const liabilitiesTotal = loansCarry.total + debtsCarry.total;
    return { month, assetsTotal, liabilitiesTotal, netWorth: assetsTotal - liabilitiesTotal };
  }

  // 現金 vs 株式 split as of `month`, from the 資産 sheet's type column.
  function assetAllocationAsOf(assets, month) {
    const assetsCarry = carryForwardSum(assets, month, "amount");
    if (!assetsCarry.month) return { cash: 0, stock: 0 };
    const atMonth = assets.filter((e) => e.month === assetsCarry.month);
    const cash = atMonth.filter((e) => e.type === "現金").reduce((t, e) => t + e.amount, 0);
    const stock = atMonth.filter((e) => e.type === "株式").reduce((t, e) => t + e.amount, 0);
    return { cash, stock };
  }

  function yearlyMonths(year) {
    return Array.from({ length: 12 }, (_, i) => `${year}年${i + 1}月`);
  }

  // One row per calendar month (Jan-Dec) of `year`, for the area-chart trend page.
  function yearlySeries(dataset, year) {
    return yearlyMonths(year).map((month) => {
      const savings = monthlySavings(dataset, month);
      const netWorth = netWorthAsOf(dataset, month);
      const allocation = assetAllocationAsOf(dataset.assets, month);
      return {
        month,
        income: savings.incomeTotal,
        expense: savings.totalOutflow,
        savings: savings.savings,
        liabilities: netWorth.liabilitiesTotal,
        assets: netWorth.assetsTotal,
        cash: allocation.cash,
        stock: allocation.stock,
      };
    });
  }

  return {
    monthKey,
    sortMonths,
    distinctMonths,
    distinctYears,
    previousMonth,
    carryForwardSum,
    monthlyExpenseByCategory,
    monthlyExpenseBreakdown,
    EXPENSE_CATEGORY_ORDER,
    monthlyCategoryTotals,
    incomeItems,
    assetItemsAsOf,
    liabilityItemsAsOf,
    dayNumber,
    kakeiboTotalAsOfDay,
    spendingPaceInsight,
    categoryStandout,
    monthlySavings,
    netWorthAsOf,
    assetAllocationAsOf,
    yearlyMonths,
    yearlySeries,
  };
});
