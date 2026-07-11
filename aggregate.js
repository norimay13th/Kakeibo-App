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

  // 8-slice breakdown for the monthly pie chart: 6 fixed categories + 固定費 + 借金・ローン返済.
  function monthlyExpenseBreakdown({ kakeibo, fixedCosts, loans, debts }, month) {
    const breakdown = monthlyExpenseByCategory(kakeibo, month);
    breakdown["固定費"] = sumBy(fixedCosts, month, "amount");
    breakdown["借金・ローン返済"] = sumBy(loans, month, "payment") + sumBy(debts, month, "payment");
    return breakdown;
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
      return {
        month,
        income: savings.incomeTotal,
        expense: savings.totalOutflow,
        savings: savings.savings,
        liabilities: netWorth.liabilitiesTotal,
        assets: netWorth.assetsTotal,
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
    monthlySavings,
    netWorthAsOf,
    assetAllocationAsOf,
    yearlyMonths,
    yearlySeries,
  };
});
