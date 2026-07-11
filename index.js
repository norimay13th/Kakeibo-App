// 支出ダッシュボード（月次）。7シートを読み取り→パース→集計し、統計カード・
// カテゴリー別内訳・先月比較を描画する。読み取り専用、書き込みは一切行わない。
(() => {
  const params = new URLSearchParams(location.search);
  const isMock = params.get("mock") === "1";

  const el = (id) => document.getElementById(id);
  const monthSelect = el("month-select");
  const warningBanner = el("warning-banner");

  // The datalabels plugin auto-registers itself globally when loaded via the CDN script,
  // which would otherwise silently attach to every chart. Unregister it globally and opt
  // individual charts in via their own `plugins: [ChartDataLabels]` instead.
  if (window.ChartDataLabels) Chart.unregister(window.ChartDataLabels);

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

    const savings = Aggregate.monthlySavings(dataset, month);
    const netWorth = Aggregate.netWorthAsOf(dataset, month);

    setStat("stat-income", savings.incomeTotal);
    setStat("stat-expense", savings.totalOutflow);
    setStat("stat-savings", savings.savings, true);
    setStat("stat-networth", netWorth.netWorth, true);
    setStat("stat-assets", netWorth.assetsTotal);
    setStat("stat-liabilities", netWorth.liabilitiesTotal);

    renderWarnings(month);
    renderCategoryChart(month);
    renderCompareTable(month, savings, netWorth);
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

  function textColor() {
    return getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#000";
  }

  function renderCategoryChart(month) {
    const breakdown = Aggregate.monthlyExpenseBreakdown(dataset, month);
    const entries = Object.entries(breakdown).filter(([, value]) => value > 0);
    destroyChart("category");
    charts.category = new Chart(el("chart-category"), {
      type: "doughnut",
      data: {
        labels: entries.map(([label]) => label),
        datasets: [{ data: entries.map(([, value]) => value) }],
      },
      plugins: [ChartDataLabels],
      options: {
        maintainAspectRatio: false,
        layout: { padding: 24 },
        plugins: {
          legend: { display: false },
          datalabels: {
            color: textColor(),
            font: { size: 11, weight: "500" },
            textAlign: "center",
            formatter: (value, ctx) => {
              const label = ctx.chart.data.labels[ctx.dataIndex];
              const total = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
              const pct = Math.round((value / total) * 100);
              return [label, `¥${Math.round(value).toLocaleString()} (${pct}%)`];
            },
            anchor: "end",
            align: "end",
            clip: false,
            display: (ctx) => {
              const value = ctx.dataset.data[ctx.dataIndex];
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              return value / total > 0.02;
            },
          },
        },
      },
    });
  }

  function renderCompareTable(month, savings, netWorth) {
    const months = Aggregate.distinctMonths(dataset.kakeibo);
    const prevMonth = Aggregate.previousMonth(months, month);
    const prevSavings = prevMonth ? Aggregate.monthlySavings(dataset, prevMonth) : null;
    const prevNetWorth = prevMonth ? Aggregate.netWorthAsOf(dataset, prevMonth) : null;

    // increaseIsGood: whether a bigger number than last month is good news (green) or bad (red).
    const rows = [
      ["収入", savings.incomeTotal, prevSavings && prevSavings.incomeTotal, true],
      ["支出", savings.totalOutflow, prevSavings && prevSavings.totalOutflow, false],
      ["貯金額", savings.savings, prevSavings && prevSavings.savings, true],
      ["純資産額", netWorth.netWorth, prevNetWorth && prevNetWorth.netWorth, true],
      ["資産額", netWorth.assetsTotal, prevNetWorth && prevNetWorth.assetsTotal, true],
      ["借金+ローン額", netWorth.liabilitiesTotal, prevNetWorth && prevNetWorth.liabilitiesTotal, false],
    ];

    const tbody = document.querySelector("#compare-table tbody");
    tbody.innerHTML = rows
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

  monthSelect.addEventListener("change", renderAll);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  loadData().catch((e) => showError(e.message));
})();
