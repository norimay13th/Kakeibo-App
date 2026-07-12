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
  let currentSeries = [];
  let currentYear = null;

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
    currentYear = year;

    const series = Aggregate.yearlySeries(dataset, year);
    currentSeries = series;
    const netWorth = Aggregate.netWorthAsOf(dataset, `${year}年12月`);

    const heroEl = el("hero-networth");
    heroEl.textContent = yen(netWorth.netWorth);
    heroEl.classList.toggle("positive", netWorth.netWorth > 0);
    heroEl.classList.toggle("negative", netWorth.netWorth < 0);

    setStat("stat-assets", netWorth.assetsTotal);
    setStat("stat-liabilities", netWorth.liabilitiesTotal);

    // asOfField-bearing rows already carry their own "as of" resolution (see
    // yearlySeries), so renderAreaChart can read title figures straight off the
    // series instead of the caller re-deriving them via carryForwardSum.
    renderAreaChart("networth", series, "netWorth", "純資産額", "netWorthAsOfMonth");
    renderAreaChart("assets", series, "assets", "資産額", "assetsAsOfMonth");
    renderAreaChart("stock", series, "stock", "株式", "assetsAsOfMonth");
    renderAreaChart("cash", series, "cash", "現金", "assetsAsOfMonth");
    renderAreaChart("liabilities", series, "liabilities", "負債額", "liabilitiesAsOfMonth");
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

  // Walks the series backward to find the most recent non-null point (収入/支出/貯金額
  // are null for months with no recorded entry — see yearlySeries).
  function findLatest(series, field) {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i][field] != null) return { month: series[i].month, value: series[i][field] };
    }
    return null;
  }

  // Small repeating diagonal-stripe tile used as the area fill for "carried forward,
  // not reconfirmed this month" segments (see renderAreaChart). Reads --text-tertiary
  // so it automatically matches light/dark mode without a separate dark-mode branch.
  function createHatchPattern(ctx) {
    const size = 8;
    const tile = document.createElement("canvas");
    tile.width = size;
    tile.height = size;
    const tctx = tile.getContext("2d");
    const stroke = getComputedStyle(document.body).getPropertyValue("--text-tertiary").trim() || "rgba(120,120,120,0.4)";
    tctx.strokeStyle = stroke;
    tctx.lineWidth = 2;
    tctx.beginPath();
    tctx.moveTo(0, size);
    tctx.lineTo(size, 0);
    tctx.moveTo(-size / 2, size / 2);
    tctx.lineTo(size / 2, -size / 2);
    tctx.moveTo(size / 2, size * 1.5);
    tctx.lineTo(size * 1.5, size / 2);
    tctx.stroke();
    return ctx.createPattern(tile, "repeat");
  }

  // snapshot charts (資産額/株式/現金/負債額/純資産額) show the latest recorded figure
  // with its "as of" month, read straight off the series' asOfField (see yearlySeries).
  // Segments spanning a month that's only carried forward (not reconfirmed that month)
  // are drawn dashed with a hatched fill, so "confirmed" and "assumed" are visually
  // distinct instead of one confident solid line all the way across. flow charts
  // (収入/支出/貯金額, no asOfField) show the year-to-date total instead, since summing
  // a snapshot across months wouldn't mean anything, and have no carried-forward concept.
  function renderAreaChart(key, series, field, label, asOfField) {
    destroyChart(key);
    let titleText;
    if (asOfField) {
      const last = series[series.length - 1];
      const asOfMonth = last[asOfField];
      titleText = asOfMonth == null ? `${label}：—` : `${label}：${yen(last[field])} (${asOfMonth}時点)`;
    } else {
      const latest = findLatest(series, field);
      const annualSum = series.reduce((t, s) => t + (s[field] || 0), 0);
      titleText = latest == null ? `${label}：—` : `${label}：${yen(annualSum)} (${latest.month}時点の合計)`;
    }
    el(`title-${key}`).textContent = titleText;

    const isExtrapolated = (idx) => {
      if (!asOfField) return false;
      const row = series[idx];
      return row[field] != null && row[asOfField] != null && row[asOfField] !== row.month;
    };

    const canvas = el(`chart-${key}`);
    const hatchPattern = asOfField ? createHatchPattern(canvas.getContext("2d")) : null;

    charts[key] = new Chart(canvas, {
      type: "line",
      data: {
        labels: series.map((s) => shortMonth(s.month)),
        datasets: [
          {
            data: series.map((s) => s[field]),
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            segment: asOfField
              ? {
                  borderDash: (ctx) => (isExtrapolated(ctx.p0DataIndex) || isExtrapolated(ctx.p1DataIndex) ? [6, 4] : undefined),
                  backgroundColor: (ctx) => (isExtrapolated(ctx.p0DataIndex) || isExtrapolated(ctx.p1DataIndex) ? hatchPattern : undefined),
                }
              : undefined,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
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
          tooltip: { enabled: false },
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

  // Shared by every tappable surface on this page (hero-card, stat-grid tiles, and
  // every area-chart card): all of them open the same month-by-month + MoM-diff table
  // for their metric, replacing the old itemized holdings/loan modals and the area
  // charts' hover tooltips.
  const CHART_DETAIL_CONFIG = {
    networth: { label: "純資産額", field: "netWorth", increaseIsGood: true },
    assets: { label: "資産額", field: "assets", increaseIsGood: true },
    stock: { label: "株式", field: "stock", increaseIsGood: true },
    cash: { label: "現金", field: "cash", increaseIsGood: true },
    liabilities: { label: "負債額", field: "liabilities", increaseIsGood: false },
    income: { label: "収入金額", field: "income", increaseIsGood: true },
    expense: { label: "支出金額", field: "expense", increaseIsGood: false },
    savings: { label: "貯金額", field: "savings", increaseIsGood: true },
  };

  function openDetailModal(kind) {
    const config = CHART_DETAIL_CONFIG[kind];
    if (!config || !currentYear || !currentSeries.length) return;
    const rows = Aggregate.seriesWithDiff(currentSeries, config.field);
    DetailModal.open(`${currentYear}年 ${config.label}`, DetailModal.renderMonthlySeriesTable(rows, config.increaseIsGood));
  }

  DetailModal.wireCards(openDetailModal);

  document.querySelectorAll(".chart-card[data-chart-detail]").forEach((card) => {
    card.addEventListener("click", () => openDetailModal(card.dataset.chartDetail));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetailModal(card.dataset.chartDetail);
      }
    });
  });

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
