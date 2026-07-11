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
    renderCategoryCompareTable(month);
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

  function separatorColor() {
    return getComputedStyle(document.documentElement).getPropertyValue("--text-tertiary").trim() || "#999";
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
      plugins: [LeaderLabels],
      options: {
        maintainAspectRatio: false,
        radius: "26%",
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
          leaderLabels: {
            textColor: textColor(),
            lineColor: separatorColor(),
            formatter: (value, ctx, total) => {
              const label = ctx.chart.data.labels[ctx.dataIndex];
              const pct = Math.round((value / total) * 100);
              return [label, `¥${Math.round(value).toLocaleString()} (${pct}%)`];
            },
          },
        },
      },
    });
  }

  function renderCategoryCompareTable(month) {
    const months = Aggregate.distinctMonths(dataset.kakeibo);
    const prevMonth = Aggregate.previousMonth(months, month);
    const current = Aggregate.monthlyCategoryTotals(dataset, month);
    const previous = prevMonth ? Aggregate.monthlyCategoryTotals(dataset, prevMonth) : null;

    const tbody = document.querySelector("#category-compare-table tbody");
    tbody.innerHTML = current
      .map(({ label, amount }, i) => {
        const prevAmount = previous ? previous[i].amount : null;
        const prevText = prevAmount == null ? "—" : yen(prevAmount);
        const diff = prevAmount == null ? null : amount - prevAmount;
        const diffText = diff == null ? "—" : `${diff >= 0 ? "+" : ""}${yen(diff)}`;
        // Category spending: an increase is always bad news (red), a decrease is good (green).
        const diffClass = diff == null || diff === 0 ? "" : diff <= 0 ? "positive" : "negative";
        return `<tr><td>${label}</td><td>${yen(amount)}</td><td>${prevText}</td><td class="${diffClass}">${diffText}</td></tr>`;
      })
      .join("");
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
      ["負債額", netWorth.liabilitiesTotal, prevNetWorth && prevNetWorth.liabilitiesTotal, false],
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

  const detailModal = el("detail-modal");
  const modalTitle = el("modal-title");
  const modalBody = el("modal-body");

  function renderDetailTable(rows, total) {
    if (!rows.length) {
      return `<table class="detail-table"><tbody><tr><td colspan="2">データがありません</td></tr></tbody></table>`;
    }
    const body = rows.map((r) => `<tr><td>${r.name}</td><td>${yen(r.amount)}</td></tr>`).join("");
    const totalRow = total != null ? `<tr class="total"><td>合計</td><td>${yen(total)}</td></tr>` : "";
    return `<table class="detail-table"><tbody>${body}${totalRow}</tbody></table>`;
  }

  function renderSection(heading, rows, total) {
    return `<div class="modal-section">${heading ? `<h3>${heading}</h3>` : ""}${renderDetailTable(rows, total)}</div>`;
  }

  function renderGrandTotal(amount, label = "合計") {
    return `<div class="modal-section"><table class="detail-table"><tbody><tr class="total"><td>${label}</td><td>${yen(amount)}</td></tr></tbody></table></div>`;
  }

  function sumAmounts(rows) {
    return rows.reduce((t, r) => t + r.amount, 0);
  }

  function openDetailModal(kind) {
    const month = monthSelect.value;
    if (!month || !dataset) return;

    let title = "";
    let bodyHtml = "";

    if (kind === "income") {
      title = "収入の内訳";
      const rows = Aggregate.incomeItems(dataset.income, month);
      bodyHtml = renderSection(null, rows, sumAmounts(rows));
    } else if (kind === "expense") {
      title = "支出の内訳";
      const rows = Aggregate.monthlyCategoryTotals(dataset, month).map((r) => ({ name: r.label, amount: r.amount }));
      bodyHtml = renderSection(null, rows, sumAmounts(rows));
    } else if (kind === "assets") {
      title = "資産額の内訳";
      const { cash, stock } = Aggregate.assetItemsAsOf(dataset.assets, month);
      bodyHtml =
        renderSection("現金", cash, sumAmounts(cash)) +
        renderSection("株式", stock, sumAmounts(stock)) +
        renderGrandTotal(sumAmounts(cash) + sumAmounts(stock));
    } else if (kind === "liabilities") {
      title = "負債額の内訳";
      const { loans, debts } = Aggregate.liabilityItemsAsOf(dataset.loans, dataset.debts, month);
      const loanRows = loans.items.map((i) => ({ name: i.name, amount: i.payment }));
      const debtRows = debts.items.map((i) => ({ name: i.name, amount: i.payment }));
      // Note: this totals monthly payments (引き落とし/返済額), not the outstanding
      // balance the 負債額 stat card shows — the two figures intentionally differ.
      bodyHtml =
        renderSection("ローン（引き落とし）", loanRows, sumAmounts(loanRows)) +
        renderSection("借金（返済額）", debtRows, sumAmounts(debtRows)) +
        renderGrandTotal(sumAmounts(loanRows) + sumAmounts(debtRows), "今月の引き落とし・返済額 合計");
    } else {
      return;
    }

    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    detailModal.classList.add("active");
  }

  function closeDetailModal() {
    detailModal.classList.remove("active");
  }

  document.querySelectorAll(".stat-card[data-detail]").forEach((card) => {
    card.addEventListener("click", () => openDetailModal(card.dataset.detail));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetailModal(card.dataset.detail);
      }
    });
  });

  el("modal-close").addEventListener("click", closeDetailModal);
  detailModal.addEventListener("click", (e) => {
    if (e.target === detailModal) closeDetailModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetailModal();
  });

  monthSelect.addEventListener("change", renderAll);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  loadData().catch((e) => showError(e.message));
})();
