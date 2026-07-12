// Chart.js plugin: draws labels *inside* each donut slice instead of alongside it, so the
// donut itself can be drawn as large as the container allows. Each slice tries horizontal
// (unrotated) text first; if the slice is too narrow at every readable font size, the label
// rotates to run along the radius instead, which uses the ring's band width (roughly
// constant regardless of how thin the slice is) rather than the slice's own angular width.
// Slices with no room even for that are simply left unlabeled rather than rendering
// illegibly small text.
const SliceLabels = {
  id: "sliceLabels",

  afterDraw(chart, _args, opts) {
    const meta = chart.getDatasetMeta(0);
    const dataset = chart.data.datasets[0];
    if (!meta || !dataset) return;

    const total = dataset.data.reduce((sum, v) => sum + (v || 0), 0);
    if (!total) return;

    const { ctx, chartArea } = chart;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    const maxFontSize = opts.maxFontSize || 13;
    const minFontSize = opts.minFontSize || 8;
    const fontFamily = opts.fontFamily || "-apple-system, sans-serif";

    ctx.save();
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";

    meta.data.forEach((arc, index) => {
      const value = dataset.data[index] || 0;
      if (!value) return;

      const midAngle = (arc.startAngle + arc.endAngle) / 2;
      const midRadius = (arc.innerRadius + arc.outerRadius) / 2;
      const bandWidth = arc.outerRadius - arc.innerRadius;
      const tangentialWidth = (arc.endAngle - arc.startAngle) * midRadius;

      const lines = opts.formatter(value, { dataIndex: index, chart }, total);
      const bgColor = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[index] : dataset.backgroundColor;
      const textColor = opts.textColor || contrastColor(bgColor);

      let fontSize = fitFontSize(ctx, lines, fontFamily, tangentialWidth * 0.88, maxFontSize, minFontSize);
      let rotated = false;
      if (!fontSize) {
        const radialCeiling = Math.min(maxFontSize, Math.floor((tangentialWidth * 0.85) / lines.length));
        // Leaves generous slack (0.65 of the band, not 0.85) between the text and the outer
        // edge: rotated text is centered on midRadius, so half its length reaches toward
        // outerRadius, and the arc itself often sits within a couple pixels of the canvas
        // edge — a tight fit here clips the last character or two off the canvas.
        fontSize = fitFontSize(ctx, lines, fontFamily, bandWidth * 0.65, radialCeiling, minFontSize);
        rotated = !!fontSize;
      }
      if (!fontSize) return; // no room at any readable size: skip rather than render garbage

      const x = cx + Math.cos(midAngle) * midRadius;
      const y = cy + Math.sin(midAngle) * midRadius;

      ctx.save();
      ctx.translate(x, y);
      if (rotated) {
        // Flip 180° on the left half so the text isn't upside-down.
        ctx.rotate(midAngle + (Math.cos(midAngle) < 0 ? Math.PI : 0));
      }
      ctx.fillStyle = textColor;
      const lineGap = fontSize + 2;
      const blockTop = -((lines.length - 1) * lineGap) / 2;
      lines.forEach((line, li) => {
        ctx.font = `${li === 0 ? opts.fontWeight || 700 : 500} ${fontSize}px ${fontFamily}`;
        ctx.fillText(line, 0, blockTop + li * lineGap);
      });
      ctx.restore();
    });

    if (opts.centerValue) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (opts.centerLabel) {
        ctx.fillStyle = opts.centerLabelColor || "#999";
        ctx.font = `500 ${opts.centerLabelFontSize || 12}px ${fontFamily}`;
        ctx.fillText(opts.centerLabel, cx, cy - 12);
      }
      ctx.fillStyle = opts.centerValueColor || opts.textColor || "#000";
      ctx.font = `700 ${opts.centerValueFontSize || 18}px ${fontFamily}`;
      ctx.fillText(opts.centerValue, cx, opts.centerLabel ? cy + 10 : cy);
    }

    ctx.restore();
  },
};

// Largest font size (down to minSize) at which every line's measured width fits within
// maxWidth, given the layout needs room for `lineCount` stacked lines. Returns null if even
// the smallest size doesn't fit.
function fitFontSize(ctx, lines, fontFamily, maxWidth, maxSize, minSize) {
  for (let size = maxSize; size >= minSize; size -= 1) {
    let widest = 0;
    lines.forEach((line) => {
      ctx.font = `700 ${size}px ${fontFamily}`;
      widest = Math.max(widest, ctx.measureText(line).width);
    });
    if (widest <= maxWidth) return size;
  }
  return null;
}

// Picks black or white text for readability against a given slice background color.
function contrastColor(hex) {
  if (!hex || hex[0] !== "#") return "#fff";
  const n = hex.length === 4
    ? hex.slice(1).split("").map((c) => parseInt(c + c, 16))
    : [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((c) => parseInt(c, 16));
  const luminance = (0.299 * n[0] + 0.587 * n[1] + 0.114 * n[2]) / 255;
  return luminance > 0.6 ? "#1c1c1e" : "#fff";
}
