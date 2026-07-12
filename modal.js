// Shared bottom-sheet detail modal used by both index.html (収入/支出/資産額/負債額)
// and trend.html (資産額/負債額). Expects the page to already contain #detail-modal /
// #modal-title / #modal-close / #modal-body (see either page's <body> markup).
const DetailModal = (() => {
  const modal = document.getElementById("detail-modal");
  const titleEl = document.getElementById("modal-title");
  const bodyEl = document.getElementById("modal-body");

  function yen(n) {
    const sign = n < 0 ? "-" : "";
    return `${sign}¥${Math.round(Math.abs(n)).toLocaleString()}`;
  }

  function sumAmounts(rows) {
    return rows.reduce((t, r) => t + r.amount, 0);
  }

  function renderTable(rows, total) {
    if (!rows.length) {
      return `<table class="detail-table"><tbody><tr><td colspan="2">データがありません</td></tr></tbody></table>`;
    }
    const body = rows.map((r) => `<tr><td>${r.name}</td><td>${yen(r.amount)}</td></tr>`).join("");
    const totalRow = total != null ? `<tr class="total"><td>合計</td><td>${yen(total)}</td></tr>` : "";
    return `<table class="detail-table"><tbody>${body}${totalRow}</tbody></table>`;
  }

  function renderSection(heading, rows, total) {
    return `<div class="modal-section">${heading ? `<h3>${heading}</h3>` : ""}${renderTable(rows, total)}</div>`;
  }

  function renderGrandTotal(amount, label = "合計") {
    return `<div class="modal-section"><table class="detail-table"><tbody><tr class="total"><td>${label}</td><td>${yen(amount)}</td></tr></tbody></table></div>`;
  }

  // items with an arbitrary set of extra columns beyond 項目/名前, e.g. ローンの
  // 引き落とし・残高・残回数/分割回数. columns: [{ header, cell(item), total(items)? }].
  // Wrapped in a horizontally scrollable container with the item-name column pinned,
  // since a loan row with every column can run wider than the modal.
  function renderMultiColumnTable(heading, items, columns) {
    const heading_ = heading ? `<h3>${heading}</h3>` : "";
    if (!items.length) {
      return `<div class="modal-section">${heading_}<table class="detail-table"><tbody><tr><td colspan="${columns.length + 1}">データがありません</td></tr></tbody></table></div>`;
    }
    const headRow = `<tr><th>項目</th>${columns.map((c) => `<th>${c.header}</th>`).join("")}</tr>`;
    const bodyRows = items
      .map((item) => `<tr><td>${item.name}</td>${columns.map((c) => `<td>${c.cell(item)}</td>`).join("")}</tr>`)
      .join("");
    const totalRow = `<tr class="total"><td>合計</td>${columns.map((c) => `<td>${c.total ? c.total(items) : ""}</td>`).join("")}</tr>`;
    return `<div class="modal-section">${heading_}<div class="table-scroll"><table class="detail-table"><thead>${headRow}</thead><tbody>${bodyRows}${totalRow}</tbody></table></div></div>`;
  }

  // ローン/借金 内訳: ローンは残回数/分割回数の列を追加、借金はamount 2列のみ。
  function renderLiabilitySections(loanItems, debtItems) {
    const loanColumns = [
      { header: "引き落とし", cell: (i) => yen(i.payment), total: (items) => yen(items.reduce((t, i) => t + i.payment, 0)) },
      { header: "残高", cell: (i) => yen(i.balance), total: (items) => yen(items.reduce((t, i) => t + i.balance, 0)) },
      { header: "残回数/分割回数", cell: (i) => `${i.installmentRemaining}/${i.installmentTotal}` },
    ];
    const debtColumns = [
      { header: "返済額", cell: (i) => yen(i.payment), total: (items) => yen(items.reduce((t, i) => t + i.payment, 0)) },
      { header: "残債務", cell: (i) => yen(i.balance), total: (items) => yen(items.reduce((t, i) => t + i.balance, 0)) },
    ];
    const paymentTotal = [...loanItems, ...debtItems].reduce((t, i) => t + i.payment, 0);
    const balanceTotal = [...loanItems, ...debtItems].reduce((t, i) => t + i.balance, 0);
    return (
      renderMultiColumnTable("ローン", loanItems, loanColumns) +
      renderMultiColumnTable("借金", debtItems, debtColumns) +
      `<div class="modal-section"><table class="detail-table"><thead><tr><th>合計</th><th>引き落とし・返済額</th><th>残高</th></tr></thead><tbody><tr class="total"><td></td><td>${yen(paymentTotal)}</td><td>${yen(balanceTotal)}</td></tr></tbody></table></div>`
    );
  }

  // Month/value/MoM-diff table for the trend page's tap-to-see-monthly-detail modal
  // (replaces Chart.js hover tooltips on the area charts). rows come from
  // Aggregate.seriesWithDiff. increaseIsGood mirrors the compare-table convention:
  // whether a bigger number than last month is good news (green) or bad (red).
  function renderMonthlySeriesTable(rows, increaseIsGood) {
    const body = rows
      .map(({ month, value, diff }) => {
        const shortMonth = month.replace(/^\d+年/, "");
        const valueText = value == null ? "—" : yen(value);
        const diffText = diff == null ? "—" : `${diff >= 0 ? "+" : ""}${yen(diff)}`;
        const diffClass = diff == null || diff === 0 ? "" : (increaseIsGood ? diff >= 0 : diff <= 0) ? "positive" : "negative";
        return `<tr><td>${shortMonth}</td><td>${valueText}</td><td class="${diffClass}">${diffText}</td></tr>`;
      })
      .join("");
    return `<table class="compare"><thead><tr><th>月</th><th>金額</th><th>前月比</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function open(title, bodyHtml) {
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    modal.classList.add("active");
  }

  function close() {
    modal.classList.remove("active");
  }

  // Wires every .stat-card[data-detail] on the page to call openFn(card.dataset.detail)
  // on click or Enter/Space.
  function wireCards(openFn) {
    document.querySelectorAll(".stat-card[data-detail], .hero-card[data-detail]").forEach((card) => {
      card.addEventListener("click", () => openFn(card.dataset.detail));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openFn(card.dataset.detail);
        }
      });
    });
  }

  document.getElementById("modal-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return {
    yen,
    sumAmounts,
    renderSection,
    renderGrandTotal,
    renderLiabilitySections,
    renderMonthlySeriesTable,
    open,
    close,
    wireCards,
  };
})();
