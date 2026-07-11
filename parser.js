// Pure parsing functions for the free-text, month-blocked sheet layout the user
// maintains by hand. No DOM dependency, so this file also runs under Node for tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Parser = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const MONTH_RE = /^\d{4}年\d{1,2}月$/;
  const DAY_RE = /^\d{1,2}日$/;

  function cellText(cell) {
    return (cell === undefined || cell === null ? "" : String(cell)).trim();
  }

  function toNumber(cell) {
    if (typeof cell === "number") return cell;
    const text = cellText(cell);
    if (!text) return null;
    const n = Number(text.replace(/[¥,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function isMonthHeader(cell) {
    return MONTH_RE.test(cellText(cell));
  }

  function isDayHeader(cell) {
    return DAY_RE.test(cellText(cell));
  }

  // Splits rows into blocks starting at each month-header row (e.g. "2026年7月").
  // Rows before the first month header are dropped.
  function splitMonthBlocks(rows) {
    const blocks = [];
    let current = null;
    for (const row of rows || []) {
      const col0 = cellText(row[0]);
      if (isMonthHeader(col0)) {
        current = { month: col0, rows: [] };
        blocks.push(current);
        continue;
      }
      if (current) current.rows.push(row);
    }
    return blocks;
  }

  // Pulls the fixed category list out of the free-text "ルール" sheet: lines
  // starting with "・" are category names, "→" lines are descriptions (ignored).
  function extractCategories(ruleRows) {
    const categories = [];
    for (const row of ruleRows || []) {
      const text = cellText(row[0]);
      if (text.startsWith("・")) {
        categories.push(text.slice(1).trim());
      }
    }
    return categories;
  }

  // 家計簿(A案): month -> day ("1日") -> category/item/amount rows.
  function parseKakeibo(rows, categories) {
    const categorySet = new Set(categories || []);
    const entries = [];
    for (const block of splitMonthBlocks(rows)) {
      let currentDay = null;
      for (const row of block.rows) {
        const col0 = cellText(row[0]);
        if (isDayHeader(col0)) {
          currentDay = col0;
          continue;
        }
        const amount = toNumber(row[2]);
        if (col0 && amount != null) {
          entries.push({
            month: block.month,
            day: currentDay,
            category: col0,
            item: cellText(row[1]),
            amount,
            unknown: !categorySet.has(col0),
          });
        }
      }
    }
    return entries;
  }

  // 資産 / 固定費: month -> header row ("名称"/"金額") -> name/amount rows.
  function parseNameAmount(rows) {
    const entries = [];
    for (const block of splitMonthBlocks(rows)) {
      for (const row of block.rows) {
        const col0 = cellText(row[0]);
        if (!col0 || col0 === "名称") continue;
        const amount = toNumber(row[1]);
        if (amount != null) {
          entries.push({ month: block.month, name: col0, amount });
        }
      }
    }
    return entries;
  }

  // 収入: month -> header row ("給与形態"/"名称"/"金額") -> type/name/amount rows.
  function parseIncome(rows) {
    const entries = [];
    for (const block of splitMonthBlocks(rows)) {
      for (const row of block.rows) {
        const col0 = cellText(row[0]);
        if (!col0 || col0 === "給与形態") continue;
        const amount = toNumber(row[2]);
        if (amount != null) {
          entries.push({
            month: block.month,
            type: col0,
            name: cellText(row[1]),
            amount,
          });
        }
      }
    }
    return entries;
  }

  // ローン: month -> header row -> 項目名/開始日/総額/分割回数/済回数/残回数/残高/引き落とし.
  function parseLoan(rows) {
    const entries = [];
    for (const block of splitMonthBlocks(rows)) {
      for (const row of block.rows) {
        const col0 = cellText(row[0]);
        if (!col0 || col0 === "項目名") continue;
        const balance = toNumber(row[6]);
        const payment = toNumber(row[7]);
        if (balance != null || payment != null) {
          entries.push({
            month: block.month,
            name: col0,
            balance: balance || 0,
            payment: payment || 0,
          });
        }
      }
    }
    return entries;
  }

  // 借金: month -> header row -> 項目名/残債務/返済額/返済日.
  function parseDebt(rows) {
    const entries = [];
    for (const block of splitMonthBlocks(rows)) {
      for (const row of block.rows) {
        const col0 = cellText(row[0]);
        if (!col0 || col0 === "項目名") continue;
        const balance = toNumber(row[1]);
        const payment = toNumber(row[2]);
        if (balance != null || payment != null) {
          entries.push({
            month: block.month,
            name: col0,
            balance: balance || 0,
            payment: payment || 0,
          });
        }
      }
    }
    return entries;
  }

  return {
    toNumber,
    splitMonthBlocks,
    extractCategories,
    parseKakeibo,
    parseNameAmount,
    parseIncome,
    parseLoan,
    parseDebt,
  };
});
