// AI画图助手 - 图片分析页面脚本
// 同步自 aidrawer-app/src/pages/analyze.js，适配 Chrome 扩展

document.addEventListener("DOMContentLoaded", () => {
  init();
});

async function init() {
  // 获取元素引用
  const providerSelect = document.getElementById("providerSelect");
  const modelSelect = document.getElementById("modelSelect");
  const fetchModelsBtn = document.getElementById("fetchModelsBtn");
  const selectImageBtn = document.getElementById("selectImageBtn");
  const urlBtn = document.getElementById("urlBtn");
  const imageFileInput = document.getElementById("imageFileInput");
  const imagePreview = document.getElementById("imagePreview");
  const previewImg = document.getElementById("previewImg");
  const removeImageBtn = document.getElementById("removeImageBtn");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const reanalyzeBtn = document.getElementById("reanalyzeBtn");
  const progressSection = document.getElementById("progressSection");
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const resultSection = document.getElementById("resultSection");
  const resultPrompt = document.getElementById("resultPrompt");
  const copyPromptBtn = document.getElementById("copyPromptBtn");
  const usePromptBtn = document.getElementById("usePromptBtn");
  const errorSection = document.getElementById("errorSection");
  const errorText = document.getElementById("errorText");
  const debugBtn = document.getElementById("debugBtn");
  const resultDebugBtn = document.getElementById("resultDebugBtn");
  const retryBtn = document.getElementById("retryBtn");
  const configHint = document.getElementById("configHint");
  const goSettingsBtn = document.getElementById("goSettingsBtn");
  const debugModal = document.getElementById("debugModal");
  const debugCloseBtn = document.getElementById("debugCloseBtn");
  const copyDebugBtn = document.getElementById("copyDebugBtn");

  // 高级参数元素
  const advancedParamsToggle = document.getElementById("advancedParamsToggle");
  const advancedParamsContent = document.getElementById("advancedParamsContent");
  const analyzeTemperature = document.getElementById("analyzeTemperature");
  const analyzeMaxTokens = document.getElementById("analyzeMaxTokens");
  const analyzeTopP = document.getElementById("analyzeTopP");
  const analyzePresencePenalty = document.getElementById("analyzePresencePenalty");
  const analyzeFrequencyPenalty = document.getElementById("analyzeFrequencyPenalty");

  // 状态
  let currentImage = null;
  let analysisResult = null;
  let currentDebugData = null;
  let analyzeProviders = [];

  // 模型缓存键
  const MODEL_CACHE_KEY = "analyze_models_cache";

  // 加载设置
  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getSettings" });
      analyzeProviders = response.analyzeProviders || [];
      initProviderSelect();
    } catch (error) {
      console.error("加载设置失败:", error);
    }
  }

  // 获取缓存的模型列表
  function getCachedModels(providerId) {
    try {
      const cache = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || "{}");
      const providerCache = cache[providerId];
      // 缓存7天
      if (providerCache && Date.now() - providerCache.timestamp < 7 * 24 * 60 * 60 * 1000) {
        if (Array.isArray(providerCache.models)) {
          return providerCache.models;
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // 保存模型列表到缓存
  function saveCachedModels(providerId, models) {
    try {
      const cache = JSON.parse(localStorage.getItem(MODEL_CACHE_KEY) || "{}");
      cache[providerId] = { models, timestamp: Date.now() };
      localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn("保存模型缓存失败:", e);
    }
  }

  // 初始化服务商选择
  function initProviderSelect() {
    if (analyzeProviders.length === 0) {
      providerSelect.innerHTML = '<option value="">请先配置服务商</option>';
      modelSelect.innerHTML = '<option value="">请先配置服务商</option>';
      configHint.classList.remove("hidden");
      return;
    }

    providerSelect.innerHTML = analyzeProviders.map(p =>
      `<option value="${escapeHtml(p.id)}" ${p.isCurrent ? "selected" : ""}>${escapeHtml(p.name)}</option>`
    ).join("");

    initModelSelect();
    updateAdvancedParams();
  }

  // 初始化模型选择
  function initModelSelect() {
    const provider = getCurrentProvider();
    if (!provider) {
      modelSelect.innerHTML = '<option value="">请先选择服务商</option>';
      return;
    }

    const cachedModels = getCachedModels(provider.id);

    if (cachedModels && cachedModels.length > 0) {
      renderModelOptions(cachedModels, provider.model);
    } else if (provider.model) {
      modelSelect.innerHTML = `<option value="${escapeHtml(provider.model)}" selected>${escapeHtml(provider.model)}</option>`;
    } else {
      modelSelect.innerHTML = '<option value="">点击"获取"加载模型列表</option>';
    }
  }

  // 渲染模型选项
  function renderModelOptions(models, defaultModel) {
    const validModels = Array.isArray(models) ? models.filter(m => m && m.id) : [];

    if (validModels.length === 0) {
      modelSelect.innerHTML = '<option value="">无可用模型</option>';
      return;
    }

    modelSelect.innerHTML = validModels.map(m => {
      const selected = m.id === defaultModel ? "selected" : "";
      const label = m.supportsVision ? `${m.id} (支持视觉)` : m.id;
      return `<option value="${escapeHtml(m.id)}" ${selected}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  // 获取当前选中的服务商
  function getCurrentProvider() {
    const providerId = providerSelect.value;
    if (!providerId) return null;
    return analyzeProviders.find(p => p.id === providerId) || analyzeProviders[0];
  }

  // 服务商切换
  providerSelect.addEventListener("change", () => {
    initModelSelect();
    updateAdvancedParams();
  });

  // 高级参数折叠/展开
  advancedParamsToggle.addEventListener("click", () => {
    const isHidden = advancedParamsContent.classList.contains("hidden");
    advancedParamsContent.classList.toggle("hidden", !isHidden);
    advancedParamsToggle.querySelector(".toggle-icon").textContent = isHidden ? "▼" : "▶";
  });

  // 更新高级参数值（从服务商配置加载）
  function updateAdvancedParams() {
    const provider = getCurrentProvider();
    if (provider) {
      analyzeTemperature.value = provider.temperature ?? 0.7;
      analyzeMaxTokens.value = provider.maxTokens ?? 2000;
      analyzeTopP.value = provider.topP ?? "";
      analyzePresencePenalty.value = provider.presencePenalty ?? "";
      analyzeFrequencyPenalty.value = provider.frequencyPenalty ?? "";
    } else {
      analyzeTemperature.value = 0.7;
      analyzeMaxTokens.value = 2000;
      analyzeTopP.value = "";
      analyzePresencePenalty.value = "";
      analyzeFrequencyPenalty.value = "";
    }
  }

  // 获取当前高级参数值
  function getAdvancedParams() {
    const temperature = parseFloat(analyzeTemperature.value);
    const maxTokens = parseInt(analyzeMaxTokens.value);
    const topP = analyzeTopP.value ? parseFloat(analyzeTopP.value) : undefined;
    const presencePenalty = analyzePresencePenalty.value ? parseFloat(analyzePresencePenalty.value) : undefined;
    const frequencyPenalty = analyzeFrequencyPenalty.value ? parseFloat(analyzeFrequencyPenalty.value) : undefined;

    return {
      temperature: isNaN(temperature) ? 0.7 : temperature,
      maxTokens: isNaN(maxTokens) ? 2000 : maxTokens,
      topP,
      presencePenalty,
      frequencyPenalty
    };
  }

  // 获取模型列表
  fetchModelsBtn.addEventListener("click", async () => {
    const provider = getCurrentProvider();
    if (!provider) {
      showStatus("请先选择服务商", "error");
      return;
    }

    fetchModelsBtn.disabled = true;
    fetchModelsBtn.textContent = "⏳";

    try {
      const { fetchModels } = await import(chrome.runtime.getURL("lib/analyze.js"));
      const models = await fetchModels(provider.url, provider.apiKey);

      saveCachedModels(provider.id, models);
      renderModelOptions(models, provider.model);

      showStatus(`已获取 ${models.length} 个模型`, "success");
    } catch (error) {
      showStatus(`获取模型列表失败: ${error.message}`, "error");
    } finally {
      fetchModelsBtn.disabled = false;
      fetchModelsBtn.textContent = "🔄 获取";
    }
  });

  // 选择图片（文件）
  selectImageBtn.addEventListener("click", () => {
    imageFileInput.click();
  });

  // 文件选择处理
  imageFileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      showStatus("正在处理图片...", "info");
      const base64 = await fileToBase64(file);
      currentImage = base64;
      showImagePreview(currentImage);
      showStatus("图片已加载", "success");
    } catch (error) {
      showStatus("图片处理失败: " + error.message, "error");
    }
  });

  // 链接按钮
  urlBtn.addEventListener("click", async () => {
    const url = prompt("请输入图片的完整 HTTP/HTTPS 链接：");
    if (!url) return;

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      showStatus("请输入有效的 http 或 https 链接", "error");
      return;
    }

    try {
      showStatus("正在加载图片...", "info");
      const response = await fetch(url);
      if (!response.ok) throw new Error("加载失败");
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = (e) => {
        currentImage = e.target.result;
        showImagePreview(currentImage);
        showStatus("图片已加载", "success");
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      showStatus("加载图片失败: " + error.message, "error");
    }
  });

  // 拖拽上传
  document.querySelector(".container").addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.querySelector(".container").addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        try {
          showStatus("正在处理图片...", "info");
          const base64 = await fileToBase64(file);
          currentImage = base64;
          showImagePreview(currentImage);
          showStatus("图片已加载", "success");
        } catch (error) {
          showStatus("图片处理失败: " + error.message, "error");
        }
      } else {
        showStatus("请选择图片文件", "error");
      }
    }
  });

  // 移除图片
  removeImageBtn.addEventListener("click", clearImage);

  // 分析按钮
  analyzeBtn.addEventListener("click", startAnalysis);
  reanalyzeBtn.addEventListener("click", startAnalysis);

  // 复制提示词
  copyPromptBtn.addEventListener("click", () => {
    if (!analysisResult) return;
    copyToClipboard(analysisResult.prompt || "");
  });

  // 应用到画图（打开 popup 页面）
  usePromptBtn.addEventListener("click", () => {
    if (!analysisResult) return;
    const popupUrl = new URL(chrome.runtime.getURL("popup.html"));
    popupUrl.searchParams.set("prompt", analysisResult.prompt || "");
    if (analysisResult.negativePrompt) {
      popupUrl.searchParams.set("negativePrompt", analysisResult.negativePrompt);
    }
    window.open(popupUrl.toString(), "_blank");
    showStatus("已打开画图页面", "success");
  });

  // 重试按钮
  retryBtn.addEventListener("click", () => {
    errorSection.classList.add("hidden");
    startAnalysis();
  });

  // 调试按钮
  debugBtn.addEventListener("click", () => {
    if (currentDebugData) {
      showDebugModal(currentDebugData);
    }
  });

  // 结果区域的调试按钮
  resultDebugBtn.addEventListener("click", () => {
    if (currentDebugData) {
      showDebugModal(currentDebugData);
    }
  });

  // 关闭调试模态框
  debugCloseBtn.addEventListener("click", () => {
    debugModal.style.display = "none";
  });
  debugModal.addEventListener("click", (e) => {
    if (e.target === debugModal) {
      debugModal.style.display = "none";
    }
  });

  // 复制调试信息
  copyDebugBtn.addEventListener("click", async () => {
    try {
      const text = JSON.stringify(currentDebugData, null, 2);
      await navigator.clipboard.writeText(text);
      showStatus("调试信息已复制", "success");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = JSON.stringify(currentDebugData, null, 2);
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      showStatus("调试信息已复制", "success");
    }
  });

  /**
   * 显示调试信息模态框
   */
  function showDebugModal(debugData) {
    const safeJson = (data) => {
      try { return JSON.stringify(data, null, 2); }
      catch { return String(data); }
    };

    const modalBody = document.getElementById("debugModalBody");
    const sections = [
      {
        title: "📡 请求 URL",
        content: `${debugData.method || "POST"} ${debugData.url || "未知"}`
      },
      {
        title: "📤 HTTP 状态",
        content: String(debugData.status || "无响应")
      },
      {
        title: "📋 请求头",
        content: safeJson(debugData.headers || {})
      },
      {
        title: "📝 请求体 (Request Body)",
        content: safeJson(debugData.body || {})
      },
      {
        title: "📥 响应数据 (Response)",
        content: safeJson(debugData.response || "无")
      }
    ];

    modalBody.replaceChildren();
    sections.forEach(({ title, content }) => {
      const section = document.createElement("div");
      section.className = "debug-section";

      const sectionTitle = document.createElement("div");
      sectionTitle.className = "debug-section-title";
      sectionTitle.textContent = title;

      const code = document.createElement("pre");
      code.className = "debug-code";
      code.textContent = content;

      section.appendChild(sectionTitle);
      section.appendChild(code);
      modalBody.appendChild(section);
    });

    debugModal.style.display = "flex";
  }

  // 去设置按钮
  goSettingsBtn.addEventListener("click", () => {
    window.location.href = "options.html";
  });

  /**
   * 显示图片预览
   */
  function showImagePreview(imageData) {
    previewImg.src = imageData;
    imagePreview.classList.remove("hidden");
    analyzeBtn.disabled = false;
    analyzeBtn.classList.remove("hidden");
    resultSection.classList.add("hidden");
    reanalyzeBtn.classList.add("hidden");
    errorSection.classList.add("hidden");
    debugBtn.classList.add("hidden");
  }

  /**
   * 清除图片
   */
  function clearImage() {
    currentImage = null;
    analysisResult = null;
    currentDebugData = null;
    imageFileInput.value = "";
    previewImg.src = "";
    imagePreview.classList.add("hidden");
    analyzeBtn.disabled = true;
    analyzeBtn.classList.remove("hidden");
    resultSection.classList.add("hidden");
    reanalyzeBtn.classList.add("hidden");
    progressSection.classList.add("hidden");
    errorSection.classList.add("hidden");
    debugBtn.classList.add("hidden");
    resultDebugBtn.classList.add("hidden");
  }

  /**
   * 开始分析
   */
  async function startAnalysis() {
    if (!currentImage) {
      showStatus("请先选择图片", "error");
      return;
    }

    const provider = getCurrentProvider();
    if (!provider) {
      showStatus("请先配置图片分析服务商", "error");
      return;
    }

    const selectedModel = modelSelect.value;
    if (!selectedModel) {
      showStatus("请选择模型", "error");
      return;
    }

    // 获取系统提示词
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const systemPrompt = response.analyzeSystemPrompt || "";

    // 获取高级参数
    const advancedParams = getAdvancedParams();

    const providerWithModel = { ...provider, model: selectedModel, systemPrompt, ...advancedParams };

    // 显示加载状态
    setLoading(true);

    try {
      const { analyzeImage } = await import(chrome.runtime.getURL("lib/analyze.js"));
      const result = await analyzeImage(
        currentImage,
        providerWithModel,
        // 进度回调
        (progress, text) => {
          const percent = Math.round(30 + progress * 0.6);
          updateProgress(percent, text);
        }
      );

      setLoading(false);

      // 提取调试数据
      currentDebugData = result._debugData || null;
      delete result._debugData;

      analysisResult = result;

      // 显示结果
      displayResult(result);
      progressSection.classList.add("hidden");
      resultSection.classList.remove("hidden");
      reanalyzeBtn.classList.remove("hidden");

      if (currentDebugData) {
        resultDebugBtn.classList.remove("hidden");
      } else {
        resultDebugBtn.classList.add("hidden");
      }

      showStatus("图片分析成功！", "success");
    } catch (error) {
      setLoading(false);
      currentDebugData = error.debugData || null;

      errorText.textContent = error.message || "分析失败";
      if (currentDebugData) {
        debugBtn.classList.remove("hidden");
      }
      progressSection.classList.add("hidden");
      errorSection.classList.remove("hidden");

      showStatus("分析失败: " + error.message, "error");
    }
  }

  /**
   * 设置加载状态
   */
  function setLoading(loading) {
    analyzeBtn.disabled = loading;
    if (loading) {
      progressSection.classList.remove("hidden");
      analyzeBtn.classList.add("hidden");
      reanalyzeBtn.classList.add("hidden");
    } else {
      progressSection.classList.add("hidden");
      analyzeBtn.classList.remove("hidden");
      if (analysisResult) {
        reanalyzeBtn.classList.remove("hidden");
      }
    }
  }

  /**
   * 更新进度
   */
  function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
  }

  /**
   * 显示分析结果
   */
  function displayResult(result) {
    resultPrompt.textContent = result.prompt || "";
  }

  /**
   * 复制到剪贴板
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      showStatus("已复制到剪贴板", "success");
    } catch (err) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      showStatus("已复制到剪贴板", "success");
    }
  }

  /**
   * 文件转 base64
   */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * HTML 转义
   */
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 显示状态提示
   */
  function showStatus(msg, type = "info") {
    // 使用简短的 toast 提示
    const existing = document.querySelector(".notification");
    if (existing) existing.remove();

    const notification = document.createElement("div");
    notification.className = `notification ${type}`;
    notification.textContent = msg;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
  }

  // 初始化
  await loadSettings();
}
