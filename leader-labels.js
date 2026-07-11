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
          setFont(ctx, opts, li === 0);
          ctx.fillText(line, labelX, blockTop + li * lineGap);
        });
      });
    });

    if (opts.centerValue) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (opts.centerLabel) {
        ctx.fillStyle = opts.centerLabelColor || opts.lineColor || "#999";
        ctx.font = `500 ${opts.centerLabelFontSize || 12}px ${opts.fontFamily || "-apple-system, sans-serif"}`;
        ctx.fillText(opts.centerLabel, cx, cy - 12);
      }
      ctx.fillStyle = opts.centerValueColor || opts.textColor || "#000";
      ctx.font = `700 ${opts.centerValueFontSize || 18}px ${opts.fontFamily || "-apple-system, sans-serif"}`;
      ctx.fillText(opts.centerValue, cx, opts.centerLabel ? cy + 10 : cy);
    }

    ctx.restore();
  },
};

function setFont(ctx, opts, isFirstLine) {
  const weight = isFirstLine ? opts.fontWeight || 600 : 400;
  ctx.font = `${weight} ${opts.fontSize || 12}px ${opts.fontFamily || "-apple-system, sans-serif"}`;
}

// Computes the largest donut radius (as a Chart.js `radius` percentage string) that still
// leaves room for every label at its actual measured width — call this with the chart's
// container element *before* constructing the Chart, and pass the result as `options.radius`.
// (Setting `chart.options.radius` reactively from inside a plugin hook doesn't reliably
// feed back into the doughnut controller's own geometry calculation, so this has to run
// up front instead.)
function computeDonutRadius(container, values, formatter, opts = {}) {
  const rect = container.getBoundingClientRect();
  const width = rect.width || container.clientWidth;
  const height = rect.height || container.clientHeight;
  const half = Math.min(width, height) / 2;
  if (!half) return "50%";

  const total = values.reduce((sum, v) => sum + (v || 0), 0);
  const minShare = opts.minShare ?? 0.02;
  const ctx = document.createElement("canvas").getContext("2d");
  let maxTextWidth = 0;
  values.forEach((value, index) => {
    if (!total || !value || value / total < minShare) return;
    const lines = formatter(value, { dataIndex: index }, total);
    lines.forEach((line, li) => {
      setFont(ctx, opts, li === 0);
      maxTextWidth = Math.max(maxTextWidth, ctx.measureText(line).width);
    });
  });

  const labelMargin = opts.labelMargin ?? 6;
  const elbowInset = opts.elbowInset ?? 26;
  const reserved = maxTextWidth + elbowInset + labelMargin + 8;
  const minRadiusPx = opts.minRadius ?? 32;
  const radiusPx = Math.max(minRadiusPx, half - reserved);
  return `${((radiusPx / half) * 100).toFixed(1)}%`;
}
