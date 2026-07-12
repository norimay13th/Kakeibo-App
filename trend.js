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

  function setStat(id, value) {
    el(id).textContent = yen(value);
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

    setStat("stat-assets", netWorth.assetsTotal);
    setStat("stat-liabilities", netWorth.liabilitiesTotal);

    renderAreaChart("assets", series, "assets", "資産額");
    renderAreaChart("stock", series, "stock", "株式");
    renderAreaChart("cash", series, "cash", "現金");
    renderAreaChart("liabilities", series, "liabilities", "負債額");
    renderAreaChart("income", series, "income", "収入金額");
    renderAreaChart("expense", series, "expense", "支出金額");
    renderAreaChart("savings", series, "savings", "貯金額");
    renderAllocationChart(year);
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  // Walks the series backward to find the most recent non-null point. income/expense/
  // savings are null for future months (see yearlySeries), so this surfaces the latest
  // real figure instead of always reading December (which may not have happened yet).
  function latestNonNull(series, field) {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i][field] != null) return series[i][field];
    }
    return null;
  }

  function renderAreaChart(key, series, field, label) {
    destroyChart(key);
    const latest = latestNonNull(series, field);
    el(`title-${key}`).textContent = latest == null ? `${label}：—` : `${label}：${yen(latest)}`;
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

  const ASSET_COLOR_MAP = { 現金: "#007AFF", 株式: "#FF3B30" };

  function renderAllocationChart(year) {
    const allocation = Aggregate.assetAllocationAsOf(dataset.assets, `${year}年12月`);
    const entries = Object.entries({ 現金: allocation.cash, 株式: allocation.stock })
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([label]) => label);
    const values = entries.map(([, value]) => value);
    const colors = labels.map((label) => ASSET_COLOR_MAP[label] || "#8E8E93");
    const total = values.reduce((t, v) => t + v, 0);

    destroyChart("allocation");
    charts.allocation = new Chart(el("chart-allocation"), {
      type: "pie",
      data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
      plugins: [SliceLabels],
      options: {
        maintainAspectRatio: false,
        layout: { padding: 16 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const pct = total ? Math.round((ctx.parsed / total) * 100) : 0;
                return ` ${ctx.label}: ${yen(ctx.parsed)} (${pct}%)`;
              },
            },
          },
          sliceLabels: {
            formatter: (value, ctx, grandTotal) => {
              const label = labels[ctx.dataIndex];
              const pct = grandTotal ? Math.round((value / grandTotal) * 100) : 0;
              return [label, `¥${Math.round(value).toLocaleString()} (${pct}%)`];
            },
          },
        },
      },
    });

    renderAllocationLegend(labels, values, colors, total);
  }

  function renderAllocationLegend(labels, values, colors, total) {
    const legend = el("allocation-legend");
    const rows = labels
      .map((label, i) => {
        const pct = total ? Math.round((values[i] / total) * 100) : 0;
        return `<li><span class="dot" style="background:${colors[i]}"></span><span class="name">${label}</span><span class="amount">${yen(values[i])}</span><span class="pct">${pct}%</span></li>`;
      })
      .join("");
    legend.innerHTML = `${rows}<li class="total"><span class="dot"></span><span class="name">合計</span><span class="amount">${yen(total)}</span><span class="pct"></span></li>`;
  }

  function openDetailModal(kind) {
    const year = Number(yearSelect.value);
    if (!year || !dataset) return;
    const month = `${year}年12月`;

    if (kind === "assets") {
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
