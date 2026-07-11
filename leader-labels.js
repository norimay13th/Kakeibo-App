// Chart.js plugin: draws always-on donut slice labels with leader lines instead of
// relying on hover tooltips or chartjs-plugin-datalabels (which overlapped/clipped
// when slices were small or numerous). Labels are stacked evenly down the left/right
// margins so they never overlap, each connected to its slice by a bent line.
const LeaderLabels = {
  id: "leaderLabels",

  afterDraw(chart, _args, opts) {
    const meta = chart.getDatasetMeta(0);
    const dataset = chart.data.datasets[0];
    if (!meta || !dataset) return;

    const total = dataset.data.reduce((sum, v) => sum + (v || 0), 0);
    if (!total) return;

    const { ctx, chartArea } = chart;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    const lineHeight = opts.lineHeight || 34;
    const labelMargin = opts.labelMargin ?? 6;
    const elbowInset = opts.elbowInset ?? 26;

    const items = meta.data
      .map((arc, index) => {
        const value = dataset.data[index] || 0;
        if (!value || value / total < (opts.minShare ?? 0.02)) return null;
        const angle = (arc.startAngle + arc.endAngle) / 2;
        const outerRadius = arc.outerRadius;
        const arcPoint = {
          x: cx + Math.cos(angle) * outerRadius,
          y: cy + Math.sin(angle) * outerRadius,
        };
        return {
          index,
          value,
          arcPoint,
          side: Math.cos(angle) >= 0 ? "right" : "left",
        };
      })
      .filter(Boolean);

    ctx.save();
    ctx.font = `${opts.fontWeight || 600} ${opts.fontSize || 12}px ${opts.fontFamily || "-apple-system, sans-serif"}`;

    ["left", "right"].forEach((side) => {
      const sideItems = items.filter((it) => it.side === side).sort((a, b) => a.arcPoint.y - b.arcPoint.y);
      const n = sideItems.length;
      if (!n) return;

      const blockHeight = n * lineHeight;
      const minStart = chartArea.top + lineHeight / 2;
      const maxStart = Math.max(minStart, chartArea.bottom - blockHeight + lineHeight / 2);
      const startY = Math.min(maxStart, Math.max(minStart, cy - blockHeight / 2));

      const labelX = side === "right" ? chartArea.right - labelMargin : chartArea.left + labelMargin;
      const elbowX = side === "right" ? labelX - elbowInset : labelX + elbowInset;

      sideItems.forEach((it, i) => {
        const labelY = startY + i * lineHeight + lineHeight / 2;
        const bendX = side === "right" ? Math.max(it.arcPoint.x, cx + 4) : Math.min(it.arcPoint.x, cx - 4);

        ctx.strokeStyle = opts.lineColor || "#999";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(it.arcPoint.x, it.arcPoint.y);
        ctx.lineTo(bendX, labelY);
        ctx.lineTo(elbowX, labelY);
        ctx.stroke();

        ctx.fillStyle = opts.dotColor || opts.lineColor || "#999";
        ctx.beginPath();
        ctx.arc(it.arcPoint.x, it.arcPoint.y, 2, 0, Math.PI * 2);
        ctx.fill();

        const lines = opts.formatter(it.value, { dataIndex: it.index, chart }, total);
        ctx.fillStyle = opts.textColor || "#000";
        // labelX sits near the canvas edge; text must grow inward (toward the chart),
        // not outward past the canvas boundary where it would be clipped and invisible.
        ctx.textAlign = side === "right" ? "right" : "left";
        ctx.textBaseline = "middle";
        const lineGap = (opts.fontSize || 12) + 2;
        const blockTop = labelY - ((lines.length - 1) * lineGap) / 2;
        lines.forEach((line, li) => {
          ctx.font = `${li === 0 ? opts.fontWeight || 600 : 400} ${opts.fontSize || 12}px ${opts.fontFamily || "-apple-system, sans-serif"}`;
          ctx.fillText(line, labelX, blockTop + li * lineGap);
        });
      });
    });

    ctx.restore();
  },
};
