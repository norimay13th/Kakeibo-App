// Receipt OCR using Tesseract.js, loaded lazily from CDN. Runs entirely in the browser, free, no server calls.
const ReceiptOCR = (() => {
  const CDN_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js";
  let loadPromise = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CDN_URL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Tesseract.jsの読み込みに失敗しました"));
      document.head.appendChild(script);
    });
    return loadPromise;
  }

  function parseReceiptText(text) {
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const storeGuess = lines[0] || "";

    const amountMatches = [...text.matchAll(/[¥￥]?\s?([0-9][0-9,]{1,})\s?円?/g)]
      .map((m) => parseInt(m[1].replace(/,/g, ""), 10))
      .filter((n) => Number.isFinite(n) && n >= 10 && n <= 1000000);

    const amountGuess = amountMatches.length ? Math.max(...amountMatches) : null;

    return { storeGuess, amountGuess, rawText: text };
  }

  async function recognizeReceipt(imageDataUrl, onProgress) {
    await loadTesseract();
    const worker = await Tesseract.createWorker("jpn+eng", 1, {
      logger: onProgress,
    });
    try {
      const { data } = await worker.recognize(imageDataUrl);
      return parseReceiptText(data.text || "");
    } finally {
      await worker.terminate();
    }
  }

  return { recognizeReceipt };
})();
