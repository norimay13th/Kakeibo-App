// Screen state, form logic, and wiring between OCR / Sheets / UI.
(() => {
  const CATEGORIES = {
    支出: ["マスト食費", "無駄金", "生活消耗品", "必須金", "娯楽費", "固定費", "借金返済"],
    収入: ["収入"],
  };
  const RECENT_KEY = "kakeibo_recent";
  const LAST_CATEGORY_KEY = "kakeibo_last_category";
  const MAX_RECENT = 5;

  const el = (id) => document.getElementById(id);
  const screens = {
    home: el("screen-home"),
    form: el("screen-form"),
  };

  const signinBtn = el("signin-btn");
  const btnCamera = el("btn-camera");
  const btnManual = el("btn-manual");
  const cameraInput = el("camera-input");
  const ocrIndicator = el("ocr-indicator");
  const entryForm = el("entry-form");
  const typeToggle = el("type-toggle");
  const categorySelect = el("field-category");
  const nameField = el("field-name");
  const amountField = el("field-amount");
  const dateField = el("field-date");
  const memoField = el("field-memo");
  const btnCancel = el("btn-cancel");
  const btnSave = el("btn-save");
  const recentList = el("recent-list");
  const toast = el("toast");

  let currentType = "支出";
  let sourceMethod = "手動";

  function showScreen(name) {
    Object.entries(screens).forEach(([key, node]) => {
      node.classList.toggle("active", key === name);
    });
  }

  function showToast(message, isError) {
    toast.textContent = message;
    toast.classList.toggle("error", !!isError);
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function nowDateTimeStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderCategoryOptions(preferred) {
    const options = CATEGORIES[currentType];
    categorySelect.innerHTML = "";
    options.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      categorySelect.appendChild(opt);
    });
    if (preferred && options.includes(preferred)) {
      categorySelect.value = preferred;
    }
  }

  function setType(type) {
    currentType = type;
    [...typeToggle.querySelectorAll("button")].forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.type === type);
    });
    const lastCategory = localStorage.getItem(LAST_CATEGORY_KEY);
    renderCategoryOptions(lastCategory);
  }

  function resetForm() {
    setType("支出");
    nameField.value = "";
    amountField.value = "";
    memoField.value = "";
    dateField.value = todayStr();
  }

  function openForm(method) {
    sourceMethod = method;
    resetForm();
    showScreen("form");
  }

  function loadRecent() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveRecent(entry) {
    const list = loadRecent();
    list.unshift(entry);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
    renderRecent();
  }

  function renderRecent() {
    const list = loadRecent();
    if (!list.length) {
      recentList.innerHTML = '<div class="recent-empty">まだ記録がありません</div>';
      return;
    }
    recentList.innerHTML = list
      .map(
        (item) => `
        <div class="recent-item">
          <span>${item.date} ${item.category} ${item.name || ""}</span>
          <span class="amount">${item.type === "収入" ? "+" : "-"}¥${Number(item.amount).toLocaleString()}</span>
        </div>`
      )
      .join("");
  }

  // --- Google sign-in wiring ---
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

  function onAuthChange(signedIn, error) {
    if (signedIn) {
      signinBtn.textContent = "サインイン済み";
    } else {
      signinBtn.textContent = "サインイン";
      if (error) showToast(`サインインエラー: ${error}`, true);
    }
  }

  async function initAuth() {
    try {
      await waitForGoogleIdentity();
      SheetsClient.init(onAuthChange);
    } catch (e) {
      showToast(e.message, true);
    }
  }

  signinBtn.addEventListener("click", () => {
    SheetsClient.signIn(true).catch((e) => showToast(e.message, true));
  });

  // --- Screen navigation ---
  btnManual.addEventListener("click", () => openForm("手動"));
  btnCancel.addEventListener("click", () => showScreen("home"));

  btnCamera.addEventListener("click", () => {
    cameraInput.value = "";
    cameraInput.click();
  });

  cameraInput.addEventListener("change", async () => {
    const file = cameraInput.files && cameraInput.files[0];
    if (!file) return;

    openForm("カメラ");

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      ocrIndicator.classList.add("active");
      try {
        const result = await ReceiptOCR.recognizeReceipt(dataUrl);
        if (result.storeGuess) nameField.value = result.storeGuess;
        if (result.amountGuess) amountField.value = result.amountGuess;
      } catch (e) {
        showToast("レシートの解析に失敗しました。手入力してください", true);
      } finally {
        ocrIndicator.classList.remove("active");
      }
    };
    reader.readAsDataURL(file);
    // Drop the reference to the file input's blob once read; nothing is written to disk.
    cameraInput.value = "";
  });

  typeToggle.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-type]");
    if (!btn) return;
    setType(btn.dataset.type);
  });

  entryForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const amount = Number(amountField.value);
    const category = categorySelect.value;
    const date = dateField.value || todayStr();
    const name = nameField.value.trim();
    const memo = memoField.value.trim();

    if (!amount || amount <= 0) {
      showToast("金額を入力してください", true);
      return;
    }
    if (!category) {
      showToast("カテゴリを選択してください", true);
      return;
    }

    btnSave.disabled = true;
    btnSave.textContent = "保存中…";

    const row = [nowDateTimeStr(), date, currentType, category, name, amount, sourceMethod, memo];

    try {
      await SheetsClient.appendRow(row);
      localStorage.setItem(LAST_CATEGORY_KEY, category);
      saveRecent({ date, type: currentType, category, name, amount });
      showToast("保存しました");
      showScreen("home");
    } catch (e) {
      showToast(e.message || "保存に失敗しました", true);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = "保存";
    }
  });

  // --- Service worker registration ---
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // --- Init ---
  dateField.value = todayStr();
  setType("支出");
  renderRecent();
  initAuth();
})();
