// Turns parsed sheet entries into the monthly figures the dashboard displays.
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

  function sumBy(entries, month, field) {
    return entries
      .filter((e) => e.month === month)
      .reduce((total, e) => total + (e[field] || 0), 0);
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

  // One point per month that has an 資産 snapshot; liabilities are looked up for
  // that same month (0 if the loan/debt sheet has no block for it that month).
  function netWorthByMonth({ assets, loans, debts }) {
    const months = sortMonths(assets.map((e) => e.month));
    return months.map((month) => {
      const assetsTotal = sumBy(assets, month, "amount");
      const liabilitiesTotal = sumBy(loans, month, "balance") + sumBy(debts, month, "balance");
      return {
        month,
        assetsTotal,
        liabilitiesTotal,
        netWorth: assetsTotal - liabilitiesTotal,
      };
    });
  }

  function distinctMonths(entries) {
    return sortMonths(entries.map((e) => e.month));
  }

  return {
    monthKey,
    sortMonths,
    distinctMonths,
    monthlyExpenseByCategory,
    monthlySavings,
    netWorthByMonth,
  };
});
