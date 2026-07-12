// 資産推移（年次）。7シートを読み取り→パース→年間12ヶ月分の系列を組み立て、
// 純資産額・5つの面グラフ・保有資産割合を描画する。読み取り専用。
(() => {
  const params = new URLSearchParams(location.search);
  const isMock = params.get("mock") === "1";

  const el = (id) => document.getElementById(id);
  const yearSelect = el("year-select");
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
    renderYearOptions();
    renderAll();
  }

  function renderYearOptions() {
    const combined = [
      ...dataset.kakeibo,
      ...dataset.income,
      ...dataset.assets,
      ...dataset.loans,
      ...dataset.debts,
      ...dataset.fixedCosts,
    ];
    const years = Aggregate.distinctYears(combined);
    yearSelect.innerHTML = "";
    years.forEach((y) => {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = `${y}年`;
      yearSelect.appendChild(opt);
    });
    if (years.length) yearSelect.value = years[years.length - 1];
  }

  function yen(n) {
    const sign = n < 0 ? "-" : "";
    return `${sign}¥${Math.round(Math.abs(n)).toLocaleString()}`;
  }

  function shortMonth(label) {
    return label.replace(/^\d+年/, "");
  }

  function renderAll() {
    const year = Number(yearSelect.value);
    if (!year) return;

    const series = Aggregate.yearlySeries(dataset, year);
    const netWorth = Aggregate.netWorthAsOf(dataset, `${year}年12月`);

    const heroEl = el("hero-networth");
    heroEl.textContent = yen(netWorth.netWorth);
    heroEl.classList.toggle("positive", netWorth.netWorth > 0);
    heroEl.classList.toggle("negative", netWorth.netWorth < 0);

    renderAreaChart("income", series, "income");
    renderAreaChart("expense", series, "expense");
    renderAreaChart("savings", series, "savings");
    renderAreaChart("liabilities", series, "liabilities");
    renderAreaChart("assets", series, "assets");
    renderAllocationChart(year);
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function renderAreaChart(key, series, field) {
    destroyChart(key);
    charts[key] = new Chart(el(`chart-${key}`), {
      type: "line",
      data: {
        labels: series.map((s) => shortMonth(s.month)),
        datasets: [
          {
            data: series.map((s) => s[field]),
            fill: true,
            tension: 0.3,
            pointRadius: 2,
          },
        ],
      },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
  }

  function textColor() {
    return getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#000";
  }

  function renderAllocationChart(year) {
    const allocation = Aggregate.assetAllocationAsOf(dataset.assets, `${year}年12月`);
    const labels = ["現金", "株式"];
    const values = [allocation.cash, allocation.stock];
    const colors = ["#007AFF", "#FF3B30"];
    const total = values.reduce((t, v) => t + v, 0);

    destroyChart("allocation");
    charts.allocation = new Chart(el("chart-allocation"), {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
      plugins: [SliceLabels],
      options: {
        maintainAspectRatio: false,
        cutout: "65%",
        layout: { padding: 16 },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          sliceLabels: {
            centerValueColor: textColor(),
            centerLabel: "総資産",
            centerValue: yen(total),
            formatter: (value, ctx, grandTotal) => {
              const label = labels[ctx.dataIndex];
              const pct = grandTotal ? Math.round((value / grandTotal) * 100) : 0;
              return [label, `¥${Math.round(value).toLocaleString()} (${pct}%)`];
            },
          },
        },
      },
    });
  }

  yearSelect.addEventListener("change", renderAll);

  function showError(message) {
    warningBanner.classList.add("active", "error");
    warningBanner.textContent = message;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  loadData().catch((e) => showError(e.message));
})();
