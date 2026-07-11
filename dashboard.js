// Reads the 7 hand-maintained sheets, parses them (parser.js), aggregates them
// (aggregate.js), and renders summary tiles + charts. Read-only, no writes.
(() => {
  const params = new URLSearchParams(location.search);
  const isMock = params.get("mock") === "1";

  const el = (id) => document.getElementById(id);
  const monthSelect = el("month-select");
  const warningBanner = el("warning-banner");
  const signinBtn = el("signin-btn");

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
      `${sheets.ASSETS}!B:C`,
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
      assets: Parser.parseNameAmount(raw.assets),
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
    return `¥${Math.round(n).toLocaleString()}`;
  }

  function renderAll() {
    const month = monthSelect.value;
    if (!month) return;

    const savings = Aggregate.monthlySavings(dataset, month);
    el("stat-income").textContent = yen(savings.incomeTotal);
    el("stat-expense").textContent = yen(savings.totalOutflow);
    const savingsEl = el("stat-savings");
    savingsEl.textContent = yen(savings.savings);
    savingsEl.classList.toggle("negative", savings.savings < 0);

    const netWorthSeries = Aggregate.netWorthByMonth(dataset);
    const latest = netWorthSeries[netWorthSeries.length - 1];
    const netWorthEl = el("stat-networth");
    netWorthEl.textContent = latest ? yen(latest.netWorth) : "—";
    netWorthEl.classList.toggle("negative", !!latest && latest.netWorth < 0);

    renderWarnings(month);
    renderCategoryChart(month);
    renderSavingsTrendChart();
    renderNetWorthChart(netWorthSeries);
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

  function renderCategoryChart(month) {
    const byCategory = Aggregate.monthlyExpenseByCategory(dataset.kakeibo, month);
    destroyChart("category");
    charts.category = new Chart(el("chart-category"), {
      type: "doughnut",
      data: {
        labels: Object.keys(byCategory),
        datasets: [{ data: Object.values(byCategory) }],
      },
      options: { plugins: { legend: { position: "bottom" } } },
    });
  }

  function renderSavingsTrendChart() {
    const months = Aggregate.distinctMonths(dataset.kakeibo);
    const values = months.map((m) => Aggregate.monthlySavings(dataset, m).savings);
    destroyChart("savings");
    charts.savings = new Chart(el("chart-savings"), {
      type: "bar",
      data: { labels: months, datasets: [{ label: "貯金額", data: values }] },
      options: { plugins: { legend: { display: false } } },
    });
  }

  function renderNetWorthChart(series) {
    destroyChart("networth");
    charts.networth = new Chart(el("chart-networth"), {
      type: "line",
      data: {
        labels: series.map((s) => s.month),
        datasets: [{ label: "純資産", data: series.map((s) => s.netWorth) }],
      },
      options: { plugins: { legend: { display: false } } },
    });
  }

  monthSelect.addEventListener("change", renderAll);

  function waitForGoogleIdentity(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function poll() {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          reject(new Error("Googleサインイン機能の読み込みに失敗しました"));
        } else {
          setTimeout(poll, 100);
        }
      })();
    });
  }

  async function init() {
    if (isMock) {
      signinBtn.style.display = "none";
      try {
        await loadData();
      } catch (e) {
        showError(e.message);
      }
      return;
    }

    try {
      await waitForGoogleIdentity();
      SheetsClient.init((signedIn, error) => {
        signinBtn.textContent = signedIn ? "サインイン済み" : "サインイン";
        if (signedIn) {
          loadData().catch((e) => showError(e.message));
        } else if (error) {
          showError(`サインインエラー: ${error}`);
        }
      });
      signinBtn.addEventListener("click", () => {
        SheetsClient.signIn(true).catch((e) => showError(e.message));
      });
    } catch (e) {
      showError(e.message);
    }
  }

  init();
})();
