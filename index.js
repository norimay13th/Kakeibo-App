// 支出ダッシュボード（月次）。7シートを読み取り→パース→集計し、統計カード・
// カテゴリー別内訳・先月比較を描画する。読み取り専用、書き込みは一切行わない。
(() => {
  const params = new URLSearchParams(location.search);
  const isMock = params.get("mock") === "1";

  const el = (id) => document.getElementById(id);
  const monthSelect = el("month-select");
  const warningBanner = el("warning-banner");

  const charts = {};
  let dataset = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  async function fetchRawSheets() {
    if (isMock) {
      await loadScript("test/fixtures.js");
      const f = window.Fixtures;
      return {
        kakeibo: f.kakeiboRows,
        assets: f.assetRows,
        income: f.incomeRows,
        loans: f.loanRows,
        debts: f.debtRows,
        fixedCosts: f.fixedCostRows,
        rules: f.ruleRows,
      };
    }

    const sheets = CONFIG.DASHBOARD_SHEETS;
    const ranges = [
      `${sheets.KAKEIBO}!B:D`,
      `${sheets.ASSETS}!B:D`,
      `${sheets.INCOME}!B:D`,
      `${sheets.LOANS}!B:I`,
      `${sheets.DEBTS}!B:E`,
      `${sheets.FIXED_COSTS}!B:C`,
      `${sheets.RULES}!B:B`,
    ];
    const data = await SheetsClient.batchGetValues(ranges);
    return {
      kakeibo: data[ranges[0]],
      assets: data[ranges[1]],
      income: data[ranges[2]],
      loans: data[ranges[3]],
      debts: data[ranges[4]],
      fixedCosts: data[ranges[5]],
      rules: data[ranges[6]],
    };
  }

  async function loadData() {
    const raw = await fetchRawSheets();
    const categories = Parser.extractCategories(raw.rules);
    dataset = {
      categories,
      kakeibo: Parser.parseKakeibo(raw.kakeibo, categories),
      assets: Parser.parseAssets(raw.assets),
      income: Parser.parseIncome(raw.income),
      loans: Parser.parseLoan(raw.loans),
      debts: Parser.parseDebt(raw.debts),
      fixedCosts: Parser.parseNameAmount(raw.fixedCosts),
    };
    renderMonthOptions();
    renderAll();
  }

  function renderMonthOptions() {
    const months = Aggregate.distinctMonths(dataset.kakeibo);
    monthSelect.innerHTML = "";
    months.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      monthSelect.appendChild(opt);
    });
    if (months.length) monthSelect.value = months[months.length - 1];
  }

  function yen(n) {
    const sign = n < 0 ? "-" : "";
    return `${sign}¥${Math.round(Math.abs(n)).toLocaleString()}`;
  }

  // Only 貯金額/純資産額 are genuinely "good when positive, bad when negative";
  // the rest are plain magnitudes and stay in the default text color.
  function setStat(id, value, signed) {
    const node = el(id);
    node.textContent = yen(value);
    node.classList.toggle("positive", !!signed && value > 0);
    node.classList.toggle("negative", !!signed && value < 0);
  }

  function renderAll() {
    const month = monthSelect.value;
    if (!month) return;

    const months = Aggregate.distinctMonths(dataset.kakeibo);
    const prevMonth = Aggregate.previousMonth(months, month);

    const savings = Aggregate.monthlySavings(dataset, month);
    const netWorth = Aggregate.netWorthAsOf(dataset, month);

    setStat("stat-income", savings.incomeTotal);
    setStat("stat-expense", savings.totalOutflow);
    setStat("stat-savings", savings.savings, true);
    setStat("stat-networth", netWorth.netWorth, true);
    setStat("stat-assets", netWorth.assetsTotal);
    setStat("stat-liabilities", netWorth.liabilitiesTotal);

    renderWarnings(month);
    renderPaceInsight(month, prevMonth);
    renderCategoryChart(month);

    const comparisonRows = variableCategoryComparisonRows(month, prevMonth);
    renderVariableTotalCompareChart(month, prevMonth);
    renderCategoryCompareChart(comparisonRows);
    renderCategoryCompareTable(comparisonRows);

    renderCompareTable(month, prevMonth, savings, netWorth);
    renderFixedCostTable(month);
    renderKakeiboTable(month);
  }

  function renderPaceInsight(month, prevMonth) {
    const banner = el("pace-insight");
    const insight = Aggregate.spendingPaceInsight(dataset.kakeibo, month, prevMonth);
    if (!insight) {
      banner.classList.remove("active");
      banner.textContent = "";
      return;
    }

    const { diff, asOfDay } = insight;
    const prevShort = insight.prevMonth.replace(/^\d+年/, "");
    const dayLabel = asOfDay != null ? `${prevShort}${asOfDay}日` : prevShort;
    let sentence;
    if (diff === 0) {
      sentence = `${dayLabel}時点と比べて支出は横ばいです。`;
    } else if (diff < 0) {
      sentence = `${dayLabel}時点と比べて支出が${yen(Math.abs(diff))}少なく、順調なペースです。`;
    } else {
      sentence = `${dayLabel}時点と比べて支出が${yen(diff)}多く、ペースが早めです。`;
    }

    const standout = Aggregate.categoryStandout(dataset, month, prevMonth);
    if (standout) {
      const verb = standout.diff > 0 ? "多い" : "少ない";
      sentence += ` 先月より${standout.label}が${yen(Math.abs(standout.diff))}${verb}ですね。`;
    }

    banner.textContent = sentence;
    banner.classList.add("active");
  }

  function renderWarnings(month) {
    const unknowns = dataset.kakeibo.filter((e) => e.month === month && e.unknown);
    warningBanner.classList.remove("error");
    if (!unknowns.length) {
      warningBanner.classList.remove("active");
      warningBanner.textContent = "";
      return;
    }
    warningBanner.classList.add("active");
    warningBanner.textContent = `ルールにないカテゴリの記録があります: ${unknowns
      .map((e) => `「${e.category}」(${e.day || ""} ${e.item})`)
      .join(" / ")}`;
  }

  function showError(message) {
    warningBanner.classList.add("active", "error");
    warningBanner.textContent = message;
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  // Fixed name -> color mapping so a category keeps the same color everywhere (pie slice,
  // legend dot, bar chart) regardless of sort order, which changes month to month.
  const CATEGORY_COLOR_MAP = {
    固定費: "#5856D6",
    負債返済額: "#AF52DE",
    食費: "#FFCC00",
    雑費: "#FF9500",
    生活費: "#34C759",
    娯楽費: "#FF3B30",
    自己投資: "#5AC8FA",
    医療費: "#007AFF",
  };
  function categoryColor(label) {
    return CATEGORY_COLOR_MAP[label] || "#8E8E93";
  }
  // Freed up from 固定費 above; used for the 変動支出総額 bar (the "black/gray" tone
  // requested to visually separate the total from the 6 individual categories).
  const VARIABLE_TOTAL_COLOR = "#8E8E93";

  function renderCategoryChart(month) {
    const breakdown = Aggregate.monthlyExpenseBreakdown(dataset, month);
    const entries = Object.entries(breakdown)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([label]) => label);
    const values = entries.map(([, value]) => value);
    const colors = labels.map(categoryColor);
    const total = values.reduce((t, v) => t + v, 0);

    destroyChart("category");
    charts.category = new Chart(el("chart-category"), {
      type: "pie",
      data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
      plugins: [SliceLabels],
      options: {
        maintainAspectRatio: false,
        layout: { padding: 16 },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          sliceLabels: {
            formatter: (_value, ctx) => [ctx.chart.data.labels[ctx.dataIndex]],
          },
        },
      },
    });

    renderCategoryLegend(labels, values, colors, total);
  }

  function renderCategoryLegend(labels, values, colors, total) {
    const legend = el("category-legend");
    const rows = labels
      .map((label, i) => {
        const pct = Math.round((values[i] / total) * 100);
        return `<li><span class="dot" style="background:${colors[i]}"></span><span class="name">${label}</span><span class="amount">${yen(values[i])}</span><span class="pct">${pct}%</span></li>`;
      })
      .join("");
    legend.innerHTML = `${rows}<li class="total"><span class="dot"></span><span class="name">合計</span><span class="amount">${yen(total)}</span><span class="pct"></span></li>`;
  }

  // Rows for both the 変動支出 先月比較 table and its bar chart (6 家計簿 categories
  // only, 固定費/負債返済額 moved to #compare-table), sorted by this month's amount
  // descending (largest category first).
  function variableCategoryComparisonRows(month, prevMonth) {
    const current = Aggregate.monthlyVariableCategoryTotals(dataset.kakeibo, month);
    const previous = prevMonth ? Aggregate.monthlyVariableCategoryTotals(dataset.kakeibo, prevMonth) : null;
    const prevByLabel = new Map((previous || []).map((r) => [r.label, r.amount]));

    return current
      .map(({ label, amount }) => ({
        label,
        amount,
        prevAmount: previous ? prevByLabel.get(label) ?? 0 : null,
      }))
      .sort((a, b) => b.amount - a.amount);
  }

  function renderCategoryCompareTable(rows) {
    const rowHtml = ({ label, amount, prevAmount }, isTotal) => {
      const prevText = prevAmount == null ? "—" : yen(prevAmount);
      const diff = prevAmount == null ? null : amount - prevAmount;
      const diffText = diff == null ? "—" : `${diff >= 0 ? "+" : ""}${yen(diff)}`;
      // Category spending: an increase is always bad news (red), a decrease is good (green).
      const diffClass = diff == null || diff === 0 ? "" : diff <= 0 ? "positive" : "negative";
      const rowClass = isTotal ? ' class="total"' : "";
      return `<tr${rowClass}><td>${label}</td><td>${yen(amount)}</td><td>${prevText}</td><td class="${diffClass}">${diffText}</td></tr>`;
    };

    const total = {
      label: "変動支出",
      amount: rows.reduce((t, r) => t + r.amount, 0),
      prevAmount: rows.some((r) => r.prevAmount == null) ? null : rows.reduce((t, r) => t + r.prevAmount, 0),
    };

    const tbody = document.querySelector("#category-compare-table tbody");
    tbody.innerHTML = rows.map((r) => rowHtml(r, false)).join("") + rowHtml(total, true);
  }

  function withAlpha(hex, alpha) {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Single-bar comparison of the combined 6-category 変動支出 total, shown to the left
  // of the per-category breakdown so the overall trend is visible at a glance.
  function renderVariableTotalCompareChart(month, prevMonth) {
    const current = Aggregate.expenseSummary(dataset, month).variableExpense;
    const previous = prevMonth ? Aggregate.expenseSummary(dataset, prevMonth).variableExpense : null;
    destroyChart("variableTotalCompare");
    charts.variableTotalCompare = new Chart(el("chart-variable-total-compare"), {
      type: "bar",
      data: {
        labels: ["変動支出"],
        datasets: [
          { label: "今月", data: [current], backgroundColor: VARIABLE_TOTAL_COLOR },
          { label: "先月", data: [previous], backgroundColor: withAlpha(VARIABLE_TOTAL_COLOR, 0.35) },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 12 } } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${yen(ctx.parsed.y)}` } },
        },
      },
    });
  }

  function renderCategoryCompareChart(rows) {
    const colors = rows.map((r) => categoryColor(r.label));
    destroyChart("categoryCompare");
    charts.categoryCompare = new Chart(el("chart-category-compare"), {
      type: "bar",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          { label: "今月", data: rows.map((r) => r.amount), backgroundColor: colors },
          { label: "先月", data: rows.map((r) => r.prevAmount), backgroundColor: colors.map((c) => withAlpha(c, 0.35)) },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 12 } } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${yen(ctx.parsed.y)}` } },
        },
      },
    });
  }

  function compareRowsHtml(rows) {
    return rows
      .map(([label, cur, prev, increaseIsGood]) => {
        const prevText = prev == null ? "—" : yen(prev);
        const diff = prev == null ? null : cur - prev;
        const diffText = diff == null ? "—" : `${diff >= 0 ? "+" : ""}${yen(diff)}`;
        const isGood = diff == null ? null : increaseIsGood ? diff >= 0 : diff <= 0;
        const diffClass = diff == null || diff === 0 ? "" : isGood ? "positive" : "negative";
        return `<tr><td>${label}</td><td>${yen(cur)}</td><td>${prevText}</td><td class="${diffClass}">${diffText}</td></tr>`;
      })
      .join("");
  }

  // 先月比較: 収入/支出/貯金額/純資産額 is the headline group (also graphed as a bar
  // chart); 固定費/負債返済額/変動支出/資産額/負債額 is the remaining group, table-only.
  function renderCompareTable(month, prevMonth, savings, netWorth) {
    const prevSavings = prevMonth ? Aggregate.monthlySavings(dataset, prevMonth) : null;
    const prevNetWorth = prevMonth ? Aggregate.netWorthAsOf(dataset, prevMonth) : null;
    const expenseSummary = Aggregate.expenseSummary(dataset, month);
    const prevExpenseSummary = prevMonth ? Aggregate.expenseSummary(dataset, prevMonth) : null;

    // increaseIsGood: whether a bigger number than last month is good news (green) or bad (red).
    const headlineRows = [
      ["収入", savings.incomeTotal, prevSavings && prevSavings.incomeTotal, true],
      ["支出", savings.totalOutflow, prevSavings && prevSavings.totalOutflow, false],
      ["貯金額", savings.savings, prevSavings && prevSavings.savings, true],
      ["純資産額", netWorth.netWorth, prevNetWorth && prevNetWorth.netWorth, true],
    ];
    const otherRows = [
      ["固定費", expenseSummary.fixedCost, prevExpenseSummary && prevExpenseSummary.fixedCost, false],
      ["負債返済額", expenseSummary.debtPayment, prevExpenseSummary && prevExpenseSummary.debtPayment, false],
      ["変動支出", expenseSummary.variableExpense, prevExpenseSummary && prevExpenseSummary.variableExpense, false],
      ["資産額", netWorth.assetsTotal, prevNetWorth && prevNetWorth.assetsTotal, true],
      ["負債額", netWorth.liabilitiesTotal, prevNetWorth && prevNetWorth.liabilitiesTotal, false],
    ];

    document.querySelector("#headline-compare-table tbody").innerHTML = compareRowsHtml(headlineRows);
    document.querySelector("#other-compare-table tbody").innerHTML = compareRowsHtml(otherRows);

    const headlineKeys = ["headline-income", "headline-expense", "headline-savings", "headline-networth"];
    headlineRows.forEach(([label, cur, prev], i) => {
      renderSingleCompareChart(headlineKeys[i], label, cur, prev, "#007AFF");
    });
  }

  // A single-metric 今月/先月 bar chart with its own auto-scaled axis (used for each
  // of the 4 independent 先月比較 mini charts, mirroring renderVariableTotalCompareChart's
  // one-label pattern).
  function renderSingleCompareChart(key, label, current, previous, color) {
    destroyChart(key);
    charts[key] = new Chart(el(`chart-${key}`), {
      type: "bar",
      data: {
        labels: [label],
        datasets: [
          { label: "今月", data: [current], backgroundColor: color },
          { label: "先月", data: [previous], backgroundColor: withAlpha(color, 0.35) },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 12 } } },
          tooltip: { enabled: false },
        },
      },
    });
  }

  function renderFixedCostTable(month) {
    const rows = Aggregate.fixedCostItems(dataset.fixedCosts, month);
    const total = DetailModal.sumAmounts(rows);
    el("title-fixed-costs").textContent = `固定費：${yen(total)}`;
    el("fixed-cost-table").innerHTML = DetailModal.renderSection(null, rows, total);
  }

  function renderKakeiboTable(month) {
    const items = Aggregate.kakeiboItemsByDay(dataset.kakeibo, month);
    el("title-kakeibo-detail").textContent = `${month} 変動支出 明細`;

    const tbody = document.querySelector("#kakeibo-detail-table tbody");
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="3">データがありません</td></tr>`;
      return;
    }
    let currentDay = null;
    const rows = items
      .map((item) => {
        let dayRow = "";
        if (item.day !== currentDay) {
          currentDay = item.day;
          dayRow = `<tr class="day-heading"><td colspan="3">${item.day || "(日付不明)"}</td></tr>`;
        }
        return `${dayRow}<tr><td>${item.category}</td><td>${item.item}</td><td>${yen(item.amount)}</td></tr>`;
      })
      .join("");
    const total = items.reduce((t, i) => t + i.amount, 0);
    tbody.innerHTML = `${rows}<tr class="total"><td colspan="2">合計</td><td>${yen(total)}</td></tr>`;
  }

  function openDetailModal(kind) {
    const month = monthSelect.value;
    if (!month || !dataset) return;

    if (kind === "income") {
      const rows = Aggregate.incomeItems(dataset.income, month);
      DetailModal.open("収入の内訳", DetailModal.renderSection(null, rows, DetailModal.sumAmounts(rows)));
    } else if (kind === "expense") {
      const summary = Aggregate.expenseSummary(dataset, month);
      const rows = [
        { name: "固定費", amount: summary.fixedCost },
        { name: "負債返済額", amount: summary.debtPayment },
        { name: "変動支出", amount: summary.variableExpense },
      ];
      DetailModal.open("支出の内訳", DetailModal.renderSection(null, rows, DetailModal.sumAmounts(rows)));
    } else if (kind === "assets") {
      const { cash, stock } = Aggregate.assetItemsAsOf(dataset.assets, month);
      DetailModal.open(
        "資産額の内訳",
        DetailModal.renderSection("現金", cash, DetailModal.sumAmounts(cash)) +
          DetailModal.renderSection("株式", stock, DetailModal.sumAmounts(stock)) +
          DetailModal.renderGrandTotal(DetailModal.sumAmounts(cash) + DetailModal.sumAmounts(stock))
      );
    } else if (kind === "liabilities") {
      const { loans, debts } = Aggregate.liabilityItemsAsOf(dataset.loans, dataset.debts, month);
      DetailModal.open("負債額の内訳", DetailModal.renderLiabilitySections(loans.items, debts.items));
    }
  }

  DetailModal.wireCards(openDetailModal);

  monthSelect.addEventListener("change", renderAll);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  loadData().catch((e) => showError(e.message));
})();
