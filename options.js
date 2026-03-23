// AI画图助手 - 设置页面脚本

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  setupEventListeners();
  initMigrationManager();
});

// 默认配置
const defaultSettings = {
  providers: [],
  maxHistory: 100,
  useNotifications: true,
  imagesPerRow: 4,
  // 图片上传服务配置
  imageUploadServices: [], // 上传服务列表
  // 服务商模板配置
  providerTemplates: [], // 模板列表
  // 历史记录密码保护
  historyPasswordHash: "", // 密码的SHA-256哈希值，空字符串表示未设置
  // 配置版本号
  configVersion: 1, // 配置版本号，每次修改时自动递增
};

// 内置模板
const builtinTemplates = [
  {
    id: "newapi-generate",
    name: "NewAPI 生图",
    serviceType: "generate",
    endpoint: "https://api.newapi.pro/v1/images/generations",
    responsePath: "data[0].url",
    useMultipart: false,
    imageFieldName: "image",
    customParams: {
      model: { value: "dall-e-3", fieldType: "" },
      n: { value: 1, fieldType: "" },
      size: { value: "1024x1024", fieldType: "" },
      response_format: { value: "url", fieldType: "" }
    },
    customHeaders: {},
    builtin: true
  },
  {
    id: "newapi-edit",
    name: "NewAPI 改图",
    serviceType: "edit",
    endpoint: "https://api.newapi.pro/v1/images/edits",
    responsePath: "data[0].url",
    useMultipart: true,
    imageFieldName: "image",
    customParams: {
      n: { value: 1, fieldType: "" },
      size: { value: "1024x1024", fieldType: "" },
      response_format: { value: "url", fieldType: "" }
    },
    customHeaders: {},
    builtin: true
  }
];

let editingProviderId = null;
let currentProviderId = null;
let editingUploadServiceId = null;
let currentUploadServiceId = null;
let editingTemplateId = null;
let editingAnalyzeProviderId = null;
let currentAnalyzeProviderId = null;

// 待导入的配置数据（用于部分导入）
let pendingImportData = null;

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getSettings",
    });
    const settings = { ...defaultSettings, ...response };

    if (settings.providers && settings.providers.length > 0) {
      const active = settings.providers.find((p) => p.isCurrent);
      if (active) currentProviderId = active.id;
    }

    applySettingsToUI(settings);

    // 检查 WebDAV 版本更新
    if (settings.webdavUrl && settings.webdavUsername && settings.webdavPassword) {
      checkWebDAVVersion(settings);
    }
  } catch (error) {
    console.error("加载设置失败:", error);
    applySettingsToUI(defaultSettings);
  }
}

function applySettingsToUI(settings) {
  const maxHistoryInput = document.getElementById("maxHistory");
  if (maxHistoryInput) maxHistoryInput.value = settings.maxHistory || 100;

  const useNotificationsCheckbox = document.getElementById("useNotifications");
  if (useNotificationsCheckbox)
    useNotificationsCheckbox.checked = settings.useNotifications !== false;

  const imagesPerRowInput = document.getElementById("imagesPerRow");
  if (imagesPerRowInput) imagesPerRowInput.value = settings.imagesPerRow || 4;

  const allowNSFWCheckbox = document.getElementById("allowNSFW");
  if (allowNSFWCheckbox) allowNSFWCheckbox.checked = !!settings.allowNSFW;

  // WebDAV 配置回显
  const webdavUrlInput = document.getElementById("webdavUrl");
  if (webdavUrlInput) webdavUrlInput.value = settings.webdavUrl || "";
  const webdavUsernameInput = document.getElementById("webdavUsername");
  if (webdavUsernameInput) webdavUsernameInput.value = settings.webdavUsername || "";
  const webdavPasswordInput = document.getElementById("webdavPassword");
  if (webdavPasswordInput) webdavPasswordInput.value = settings.webdavPassword || "";
  const webdavFilenameInput = document.getElementById("webdavFilename");
  if (webdavFilenameInput) webdavFilenameInput.value = settings.webdavFilename || "ai-drawer-config.json";
  const webdavAutoSyncCheckbox = document.getElementById("webdavAutoSync");
  if (webdavAutoSyncCheckbox) webdavAutoSyncCheckbox.checked = !!settings.webdavAutoSync;

  // 安全密钥回显
  const securityKeyInput = document.getElementById("securityKey");
  if (securityKeyInput) {
    securityKeyInput.value = settings.securityKey || "";
  }

  // 历史记录密码状态回显
  updatePasswordStatusUI(settings.historyPasswordHash || "");

  // 图片上传服务配置回显
  const uploadServices = settings.imageUploadServices || [];
  if (uploadServices.length > 0) {
    const activeService = uploadServices.find((s) => s.isActive);
    if (activeService) currentUploadServiceId = activeService.id;
  }
  renderUploadServicesList(uploadServices);

  renderProvidersList(settings.providers || []);

  // 图片分析服务配置回显
  const analyzeProviders = settings.analyzeProviders || [];
  if (analyzeProviders.length > 0) {
    const activeAnalyzeProvider = analyzeProviders.find(p => p.isCurrent);
    if (activeAnalyzeProvider) currentAnalyzeProviderId = activeAnalyzeProvider.id;
  }
  renderAnalyzeProvidersList(analyzeProviders);

  // 分析系统提示词回显
  const analyzeSystemPromptEl = document.getElementById("analyzeSystemPrompt");
  if (analyzeSystemPromptEl) {
    analyzeSystemPromptEl.value = settings.analyzeSystemPrompt || "";
  }

  if (currentProviderId) {
    const active = settings.providers.find((p) => p.id === currentProviderId);
    // if (active) updateCurrentDisplay(active); // Removed
  }
}

function renderProvidersList(providers) {
  const container = document.getElementById("providersList");
  const noMessage = document.getElementById("noProvidersMessage");

  if (!providers || providers.length === 0) {
    if (container) container.style.display = "none";
    if (noMessage) noMessage.style.display = "block";
    // const currentSection = document.getElementById('currentConfigSection');
    // if (currentSection) currentSection.style.display = 'none';
    return;
  }

  if (container) container.style.display = "grid"; // Ensure grid
  if (noMessage) noMessage.style.display = "none";

  if (container) {
    container.innerHTML = "";
    providers.forEach((provider) => {
      const item = createProviderItem(provider);
      container.appendChild(item);
    });
  }
}

function createProviderItem(provider) {
  const template = document.getElementById("providerItemTemplate");
  const clone = template.content.cloneNode(true);

  const div = clone.querySelector(".provider-item");
  div.dataset.id = provider.id;

  if (provider.id === currentProviderId) {
    div.classList.add("active");
    const badge = div.querySelector(".provider-status-badge");
    if (badge) badge.style.display = "block";
  }

  div.querySelector(".provider-name").textContent = provider.name;
  div.querySelector(".provider-endpoint").textContent = provider.endpoint;
  div.querySelector(".provider-endpoint").title = provider.endpoint; // Add tooltip

  const btnCopy = div.querySelector(".btn-copy");
  if (btnCopy) {
    btnCopy.addEventListener("click", (e) => {
      e.stopPropagation();
      copyProvider(provider.id);
    });
  }

  div.querySelector(".btn-edit").addEventListener("click", (e) => {
    e.stopPropagation();
    editProvider(provider.id);
  });

  div.querySelector(".btn-delete").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteProvider(provider.id);
  });

  // Removed btn-use listener - clicking card activates provider

  const btnTest = div.querySelector(".btn-test");
  if (btnTest) {
    btnTest.addEventListener("click", (e) => {
      e.stopPropagation();
      testProviderConnection(provider);
    });
  }

  div.addEventListener("click", () => useProvider(provider.id));

  // Drag-and-drop event handlers
  div.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    div.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", provider.id);
  });

  div.addEventListener("dragend", (e) => {
    div.classList.remove("dragging");
    // Remove all drag-over classes
    document.querySelectorAll(".provider-item").forEach((item) => {
      item.classList.remove("drag-over");
    });
  });

  div.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const dragging = document.querySelector(".dragging");
    if (dragging && dragging !== div) {
      div.classList.add("drag-over");
    }
  });

  div.addEventListener("dragleave", (e) => {
    div.classList.remove("drag-over");
  });

  div.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    div.classList.remove("drag-over");

    const draggedId = e.dataTransfer.getData("text/plain");
    const targetId = provider.id;

    if (draggedId !== targetId) {
      await reorderProviders(draggedId, targetId);
    }
  });

  return clone;
}

function setupEventListeners() {
  // 侧边菜单导航
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabName = item.dataset.tab;
      switchTab(tabName);
    });
  });

  // 快捷键设置链接
  const shortcutLink = document.getElementById('shortcutSettingsLink');
  if (shortcutLink) {
    shortcutLink.addEventListener('click', (e) => {
      e.preventDefault();
      // 打开 Chrome 扩展快捷键设置页面
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  // 初始化快捷键显示
  updateShortcutDisplay();

  document
    .getElementById("addProviderBtn")
    .addEventListener("click", () => showProviderForm());
  document
    .getElementById("saveProviderBtn")
    .addEventListener("click", saveProvider);
  document
    .getElementById("cancelProviderBtn")
    .addEventListener("click", hideProviderForm);
  document
    .getElementById("saveAllBtn")
    .addEventListener("click", saveAllSettings);
  // document.getElementById('testBtn').addEventListener('click', testConnection); // Removed - now per-card
  document.getElementById("resetBtn").addEventListener("click", resetSettings);
  document
    .getElementById("addParamBtn")
    .addEventListener("click", () => addParameterRow());
  document
    .getElementById("addHeaderBtn")
    .addEventListener("click", () => addHeaderRow());

  // 模板相关事件
  document
    .getElementById("providerTemplate")
    .addEventListener("change", onTemplateChange);
  document
    .getElementById("manageTemplatesBtn")
    .addEventListener("click", showTemplateModal);
  document
    .getElementById("addTemplateBtn")
    .addEventListener("click", () => showTemplateForm());
  document
    .getElementById("saveTemplateBtn")
    .addEventListener("click", saveTemplate);
  document
    .getElementById("cancelTemplateBtn")
    .addEventListener("click", hideTemplateForm);
  document
    .getElementById("addTemplateParamBtn")
    .addEventListener("click", () => addTemplateParameterRow());
  document
    .getElementById("addTemplateHeaderBtn")
    .addEventListener("click", () => addTemplateHeaderRow());

  // 异步模式切换逻辑
  const asyncToggle = document.getElementById("providerAsyncMode");
  const asyncSection = document.getElementById("asyncConfigSection");
  if (asyncToggle && asyncSection) {
    asyncToggle.addEventListener("change", (e) => {
      asyncSection.style.display = e.target.checked ? "block" : "none";
      if (e.target.checked) {
        asyncSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }

  // multipart模式切换逻辑
  const multipartToggle = document.getElementById("providerUseMultipart");
  const multipartConfig = document.getElementById("multipartConfig");
  if (multipartToggle && multipartConfig) {
    multipartToggle.addEventListener("change", (e) => {
      multipartConfig.style.display = e.target.checked ? "block" : "none";
    });
  }

  // 服务类型切换逻辑
  const serviceTypeRadios = document.querySelectorAll('input[name="serviceType"]');
  const editModeConfig = document.getElementById("editModeConfig");
  if (serviceTypeRadios && editModeConfig) {
    serviceTypeRadios.forEach(radio => {
      radio.addEventListener("change", (e) => {
        const isEdit = e.target.value === "edit";
        editModeConfig.style.display = isEdit ? "block" : "none";
        if (isEdit) {
          editModeConfig.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    });
  }

  // 导出/导入配置
  const exportBtn = document.getElementById("exportSettingsBtn");
  const importBtn = document.getElementById("importSettingsBtn");
  const importFile = document.getElementById("importFile");

  if (exportBtn) exportBtn.addEventListener("click", exportSettings);
  if (importBtn) importBtn.addEventListener("click", () => importFile.click());
  if (importFile) importFile.addEventListener("change", importSettings);

  // WebDAV 按钮事件
  const webdavTestBtn = document.getElementById("webdavTestBtn");
  const webdavUploadBtn = document.getElementById("webdavUploadBtn");
  const webdavDownloadBtn = document.getElementById("webdavDownloadBtn");

  if (webdavTestBtn) webdavTestBtn.addEventListener("click", testWebDAVConnection);
  if (webdavUploadBtn) webdavUploadBtn.addEventListener("click", uploadToWebDAV);
  if (webdavDownloadBtn) webdavDownloadBtn.addEventListener("click", downloadFromWebDAV);

  // 上传服务管理按钮
  const addUploadServiceBtn = document.getElementById("addUploadServiceBtn");
  const saveUploadServiceBtn = document.getElementById("saveUploadServiceBtn");
  const cancelUploadServiceBtn = document.getElementById("cancelUploadServiceBtn");
  const addUploadParamBtn = document.getElementById("addUploadParamBtn");

  if (addUploadServiceBtn) addUploadServiceBtn.addEventListener("click", () => showUploadServiceForm());
  if (saveUploadServiceBtn) saveUploadServiceBtn.addEventListener("click", saveUploadService);
  if (cancelUploadServiceBtn) cancelUploadServiceBtn.addEventListener("click", hideUploadServiceForm);
  if (addUploadParamBtn) addUploadParamBtn.addEventListener("click", () => addUploadParameterRow());

  // 历史记录密码保护按钮
  const setPasswordBtn = document.getElementById("setPasswordBtn");
  const changePasswordBtn = document.getElementById("changePasswordBtn");
  const clearPasswordBtn = document.getElementById("clearPasswordBtn");

  if (setPasswordBtn) setPasswordBtn.addEventListener("click", setPassword);
  if (changePasswordBtn) changePasswordBtn.addEventListener("click", changePassword);
  if (clearPasswordBtn) clearPasswordBtn.addEventListener("click", clearPassword);

  // 图片分析服务商管理按钮
  const addAnalyzeProviderBtn = document.getElementById("addAnalyzeProviderBtn");
  const saveAnalyzeProviderBtn = document.getElementById("saveAnalyzeProviderBtn");
  const cancelAnalyzeProviderBtn = document.getElementById("cancelAnalyzeProviderBtn");
  const fetchAnalyzeModelsBtn = document.getElementById("fetchAnalyzeModelsBtn");
  const saveSystemPromptBtn = document.getElementById("saveSystemPromptBtn");
  const resetPromptBtn = document.getElementById("resetPromptBtn");
  const analyzeAdvancedToggle = document.getElementById("analyzeAdvancedToggle");

  if (addAnalyzeProviderBtn) addAnalyzeProviderBtn.addEventListener("click", () => showAnalyzeProviderForm());
  if (saveAnalyzeProviderBtn) saveAnalyzeProviderBtn.addEventListener("click", saveAnalyzeProvider);
  if (cancelAnalyzeProviderBtn) cancelAnalyzeProviderBtn.addEventListener("click", hideAnalyzeProviderForm);
  if (fetchAnalyzeModelsBtn) fetchAnalyzeModelsBtn.addEventListener("click", fetchAnalyzeModels);
  if (saveSystemPromptBtn) saveSystemPromptBtn.addEventListener("click", saveAnalyzeSystemPrompt);
  if (resetPromptBtn) resetPromptBtn.addEventListener("click", resetAnalyzeSystemPrompt);
  if (analyzeAdvancedToggle) {
    analyzeAdvancedToggle.addEventListener("click", () => {
      const params = document.getElementById("analyzeAdvancedParams");
      if (params) {
        const isHidden = params.style.display === "none";
        params.style.display = isHidden ? "block" : "none";
        analyzeAdvancedToggle.querySelector("span:first-child").textContent = isHidden ? "▼" : "▶";
      }
    });
  }

  // 密码可见性切换
  setupPasswordToggle();


  // Modal 关闭事件
  const modal = document.getElementById("previewModal");
  if (modal) {
    // 点击关闭按钮
    modal.querySelectorAll(".close-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        modal.style.display = "none";
      });
    });

    // 点击背景关闭
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  // 导入预览模态框事件绑定
  const closeImportPreviewBtn = document.getElementById("closeImportPreviewBtn");
  const cancelImportPreviewBtn = document.getElementById("cancelImportPreviewBtn");
  const confirmPartialImportBtn = document.getElementById("confirmPartialImportBtn");
  const importPreviewModal = document.getElementById("importPreviewModal");

  if (closeImportPreviewBtn) {
    closeImportPreviewBtn.addEventListener("click", () => {
      importPreviewModal.style.display = "none";
      pendingImportData = null;
    });
  }

  if (cancelImportPreviewBtn) {
    cancelImportPreviewBtn.addEventListener("click", () => {
      importPreviewModal.style.display = "none";
      pendingImportData = null;
    });
  }

  if (confirmPartialImportBtn) {
    confirmPartialImportBtn.addEventListener("click", executePartialImport);
  }

  if (importPreviewModal) {
    importPreviewModal.addEventListener("click", (e) => {
      if (e.target === importPreviewModal) {
        importPreviewModal.style.display = "none";
        pendingImportData = null;
      }
    });
  }
}

function showConfigPreviewModal(settings, onConfirm) {
  const modal = document.getElementById("previewModal");
  const content = document.getElementById("previewContent");
  const confirmBtn = document.getElementById("confirmImportBtn");

  if (!modal || !content || !confirmBtn) return;

  // 格式化展示 JSON
  content.textContent = JSON.stringify(settings, null, 2);

  // 绑定确认事件 (先移除旧的监听器，这里简单使用 onclick 覆盖)
  confirmBtn.onclick = () => {
    modal.style.display = "none";
    onConfirm();
  };

  modal.style.display = "flex";
}

function addHeaderRow(key = "", value = "") {
  const container = document.getElementById("customHeadersList");
  const template = document.getElementById("headerRowTemplate");
  const clone = template.content.cloneNode(true);

  const keyInput = clone.querySelector(".header-key");
  const valInput = clone.querySelector(".header-value");
  const removeBtn = clone.querySelector(".btn-remove-header");

  keyInput.value = key;
  valInput.value = value;

  removeBtn.addEventListener("click", (e) => {
    e.target.closest(".header-row").remove();
  });

  container.appendChild(clone);
}

function addParameterRow(
  key = "",
  value = "",
  type = "string",
  fieldType = "",
) {
  const container = document.getElementById("customParamsList");
  const template = document.getElementById("paramRowTemplate");
  const clone = template.content.cloneNode(true);

  const row = clone.querySelector(".param-row");
  const keyInput = row.querySelector(".param-key");
  const typeSelect = row.querySelector(".param-type");
  const valInput = row.querySelector(".param-value");
  const fieldTypeSelect = row.querySelector(".param-field-type");
  const removeBtn = row.querySelector(".btn-remove-param");

  keyInput.value = key;
  typeSelect.value = type;

  // 处理特殊类型显示（bool、random）
  const updateInputControl = () => {
    const currentType = typeSelect.value;
    const existingInput = row.querySelector(
      ".param-value, .param-value-select",
    );

    if (currentType === "bool") {
      if (existingInput.tagName === "INPUT") {
        const select = document.createElement("select");
        select.className = "param-value-select"; // 使用不同class防止样式冲突
        select.style.flex = "1";
        select.style.padding = "10px";
        select.style.border = "1px solid #e2e8f0";
        select.style.borderRadius = "6px";
        select.innerHTML =
          '<option value="true">True</option><option value="false">False</option>';
        select.value = String(value) === "true" ? "true" : "false";
        existingInput.replaceWith(select);
      }
    } else if (currentType === "random") {
      // random 类型：显示占位提示
      if (existingInput.tagName === "SELECT") {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "param-value";
        input.placeholder = "将自动生成随机数";
        input.value = "";
        input.disabled = true;
        input.style.backgroundColor = "#f0f0f0";
        existingInput.replaceWith(input);
      } else {
        existingInput.placeholder = "将自动生成随机数";
        existingInput.value = "";
        existingInput.disabled = true;
        existingInput.style.backgroundColor = "#f0f0f0";
      }
    } else {
      if (existingInput.tagName === "SELECT") {
        const input = document.createElement("input");
        input.type = "text";
        input.className = "param-value";
        input.placeholder = "参数值";
        input.value =
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value);
        existingInput.replaceWith(input);
      } else {
        existingInput.disabled = false;
        existingInput.style.backgroundColor = "";
        existingInput.placeholder = "参数值";
        // 如果之前是random类型，恢复值显示
        if (existingInput.value === "" && value !== "" && value !== "__RANDOM__") {
          existingInput.value = typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value);
        }
      }
    }
  };

  // 初始化控件状态
  if (type === "bool") {
    const existingInput = valInput; // template中的是input
    const select = document.createElement("select");
    select.className = "param-value-select"; // 对应上面逻辑
    select.style.width = "100px"; // 稍微固定下宽度，flex会覆盖
    select.style.flex = "1";
    select.style.padding = "10px";
    select.style.border = "1px solid #e2e8f0";
    select.style.borderRadius = "6px";
    select.innerHTML =
      '<option value="true">True</option><option value="false" selected>False</option>';
    select.value = String(value) === "true" ? "true" : "false";
    existingInput.replaceWith(select);
  } else if (type === "random") {
    valInput.placeholder = "将自动生成随机数";
    valInput.value = "";
    valInput.disabled = true;
    valInput.style.backgroundColor = "#f0f0f0";
  } else {
    valInput.value =
      typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value === "__RANDOM__" ? "" : value);
  }

  typeSelect.addEventListener("change", updateInputControl);

  if (fieldTypeSelect) fieldTypeSelect.value = fieldType || "";

  removeBtn.addEventListener("click", (e) => {
    e.target.closest(".param-row").remove();
  });

  container.appendChild(clone);
}

function showProviderForm(provider = null) {
  clearProviderForm(); // 先清空，防止状态残留

  const section = document.getElementById("providerFormSection");
  const title = document.getElementById("formTitle");
  if (!section) return;

  // 加载模板选项
  loadTemplateOptions();

  editingProviderId = provider ? provider.id : null;
  const container = document.getElementById("customParamsList");

  if (provider) {
    if (title) title.textContent = "编辑服务商";
    document.getElementById("providerName").value = provider.name || "";
    document.getElementById("providerEndpoint").value = provider.endpoint || "";
    document.getElementById("providerKey").value = provider.key || "";
    document.getElementById("providerResponsePath").value =
      provider.responsePath || "";

    // 设置服务类型
    const serviceType = provider.serviceType || "generate";
    const serviceTypeRadio = document.querySelector(
      `input[name="serviceType"][value="${serviceType}"]`,
    );
    if (serviceTypeRadio) serviceTypeRadio.checked = true;

    // 显示/隐藏改图模式配置
    const editModeConfig = document.getElementById("editModeConfig");
    if (editModeConfig) {
      editModeConfig.style.display = serviceType === "edit" ? "block" : "none";
    }

    // 设置multipart选项
    const useMultipartCheckbox = document.getElementById("providerUseMultipart");
    const multipartConfig = document.getElementById("multipartConfig");
    if (useMultipartCheckbox) {
      useMultipartCheckbox.checked = !!provider.useMultipart;
      if (multipartConfig) {
        multipartConfig.style.display = provider.useMultipart ? "block" : "none";
      }
    }

    // 设置图片字段名
    const imageFieldNameInput = document.getElementById("providerImageFieldName");
    if (imageFieldNameInput) {
      imageFieldNameInput.value = provider.imageFieldName || "image";
    }

    if (provider.customHeaders) {
      Object.entries(provider.customHeaders).forEach(([k, v]) => {
        addHeaderRow(k, v);
      });
    }

    if (provider.customParams) {
      Object.entries(provider.customParams).forEach(([k, v]) => {
        let type = "string";
        let fieldType = "";
        let actualValue = v;

        // 检查是否是新格式（带fieldType的对象）
        if (v && typeof v === "object" && v.value !== undefined) {
          actualValue = v.value;
          fieldType = v.fieldType || "";
          // 重新判断类型
          if (actualValue === "__RANDOM__") {
            type = "random";
          } else if (Array.isArray(actualValue)) {
            type = "list";
          } else if (typeof actualValue === "object" && actualValue !== null) {
            type = "object";
          } else if (typeof actualValue === "number") {
            type = Number.isInteger(actualValue) ? "int" : "float";
          } else if (typeof actualValue === "boolean") {
            type = "bool";
          } else {
            type = "string";
          }
        } else {
          // 旧格式兼容
          if (v === "__RANDOM__") {
            type = "random";
          } else if (Array.isArray(v)) {
            type = "list";
          } else if (typeof v === "object" && v !== null) {
            type = "object";
          } else if (typeof v === "number") {
            type = Number.isInteger(v) ? "int" : "float";
          } else if (typeof v === "boolean") {
            type = "bool";
          }
        }

        addParameterRow(k, actualValue, type, fieldType);
      });
    }

    // 异步配置回显
    const asyncMode = !!provider.asyncMode;
    document.getElementById("providerAsyncMode").checked = asyncMode;
    document.getElementById("asyncConfigSection").style.display = asyncMode
      ? "block"
      : "none";
    if (asyncMode) {
      document.getElementById("providerJobIdPath").value =
        provider.jobIdPath || "";
      document.getElementById("providerPollUrl").value = provider.pollUrl || "";
      document.getElementById("providerStatusPath").value =
        provider.statusPath || "";
      document.getElementById("providerSuccessValue").value =
        provider.successValue || "";
      document.getElementById("providerPollInterval").value =
        provider.pollInterval || 2;
    }
  } else {
    if (title) title.textContent = "添加服务商";
    clearProviderForm();
  }

  section.style.display = "block";
  section.scrollIntoView({ behavior: "smooth" });
}

function hideProviderForm() {
  const section = document.getElementById("providerFormSection");
  if (section) section.style.display = "none";
  editingProviderId = null;
  clearProviderForm();
}

function clearProviderForm() {
  [
    "providerName",
    "providerEndpoint",
    "providerKey",
    "providerResponsePath",
    "providerJobIdPath",
    "providerPollUrl",
    "providerStatusPath",
    "providerSuccessValue",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const asyncToggle = document.getElementById("providerAsyncMode");
  if (asyncToggle) {
    asyncToggle.checked = false;
    const section = document.getElementById("asyncConfigSection");
    if (section) section.style.display = "none";
  }
  const pollInterval = document.getElementById("providerPollInterval");
  if (pollInterval) pollInterval.value = "2";

  // 清理multipart选项
  const useMultipartCheckbox = document.getElementById("providerUseMultipart");
  const multipartConfig = document.getElementById("multipartConfig");
  if (useMultipartCheckbox) {
    useMultipartCheckbox.checked = false;
    if (multipartConfig) {
      multipartConfig.style.display = "none";
    }
  }

  // 重置图片字段名
  const imageFieldNameInput = document.getElementById("providerImageFieldName");
  if (imageFieldNameInput) {
    imageFieldNameInput.value = "image";
  }

  // 隐藏改图模式配置
  const editModeConfig = document.getElementById("editModeConfig");
  if (editModeConfig) {
    editModeConfig.style.display = "none";
  }

  // 重置服务类型为画图
  const generateRadio = document.querySelector('input[name="serviceType"][value="generate"]');
  if (generateRadio) {
    generateRadio.checked = true;
  }

  const containerParams = document.getElementById("customParamsList");
  const containerHeaders = document.getElementById("customHeadersList");
  if (containerParams) containerParams.innerHTML = "";
  if (containerHeaders) containerHeaders.innerHTML = "";
}

async function saveProvider() {
  const name = document.getElementById("providerName").value.trim();
  const endpoint = document.getElementById("providerEndpoint").value.trim();
  const key = document.getElementById("providerKey").value.trim();
  const responsePath = document
    .getElementById("providerResponsePath")
    .value.trim();

  // 获取异步配置
  const asyncMode = document.getElementById("providerAsyncMode").checked;
  const jobIdPath = document.getElementById("providerJobIdPath").value.trim();
  const pollUrl = document.getElementById("providerPollUrl").value.trim();
  const statusPath = document.getElementById("providerStatusPath").value.trim();
  const successValue = document
    .getElementById("providerSuccessValue")
    .value.trim();
  const pollInterval =
    parseInt(document.getElementById("providerPollInterval").value) || 2;

  const serviceType =
    document.querySelector('input[name="serviceType"]:checked')?.value ||
    "generate";

  // 获取multipart配置
  const useMultipart = document.getElementById("providerUseMultipart").checked;
  const imageFieldName = document.getElementById("providerImageFieldName").value.trim() || "image";

  if (!name || !endpoint) {
    showStatus("请输入服务商名称和端点", "error");
    return;
  }

  const customHeaders = {};
  document.querySelectorAll(".header-row").forEach((row) => {
    const k = row.querySelector(".header-key").value.trim();
    const v = row.querySelector(".header-value").value.trim();
    if (k) customHeaders[k] = v;
  });

  const customParams = {};
  document.querySelectorAll(".param-row").forEach((row) => {
    const k = row.querySelector(".param-key").value.trim();
    const type = row.querySelector(".param-type").value;
    // 兼容 input 和 select
    const valInput = row.querySelector(".param-value, .param-value-select");
    const v = valInput.value.trim();
    const fieldTypeSelect = row.querySelector(".param-field-type");
    const fieldType = fieldTypeSelect ? fieldTypeSelect.value : "";

    if (k) {
      try {
        let parsedValue;
        if (type === "int") parsedValue = parseInt(v, 10);
        else if (type === "float") parsedValue = parseFloat(v);
        else if (type === "bool") parsedValue = v === "true";
        else if (type === "random")
          parsedValue = "__RANDOM__"; // 特殊标记，运行时替换
        else if (type === "object" || type === "list")
          parsedValue = JSON.parse(v);
        else parsedValue = v;

        // 如果有字段类型，使用新格式
        if (fieldType) {
          customParams[k] = { value: parsedValue, fieldType: fieldType };
        } else {
          customParams[k] = parsedValue;
        }
      } catch (e) {
        console.warn(`参数 ${k} 转换失败:`, e);
        customParams[k] = fieldType ? { value: v, fieldType: fieldType } : v;
      }
    }
  });

  try {
    const response = await chrome.runtime.sendMessage({
      action: "getSettings",
    });
    let providers = response.providers || [];
    const providerData = {
      name,
      endpoint,
      key,
      responsePath,
      serviceType,
      customHeaders,
      customParams,
      asyncMode,
      useMultipart,
      imageFieldName,
      ...(asyncMode
        ? { jobIdPath, pollUrl, statusPath, successValue, pollInterval }
        : {}),
    };

    if (editingProviderId) {
      providers = providers.map((p) =>
        p.id === editingProviderId ? { ...p, ...providerData } : p,
      );
    } else {
      const newP = {
        id: generateId(),
        ...providerData,
        isCurrent: providers.length === 0,
      };
      providers.push(newP);
      if (newP.isCurrent) currentProviderId = newP.id;
    }

    // 自动递增配置版本号
    const currentVersion = response.configVersion || 1;
    const newVersion = currentVersion + 1;

    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: { ...response, providers, configVersion: newVersion },
    });
    hideProviderForm();
    renderProvidersList(providers);
    if (currentProviderId) {
      // const active = providers.find(p => p.id === currentProviderId);
      // if (active) updateCurrentDisplay(active); // Removed
    }
    showStatus(`保存成功（版本号：${newVersion}）`, "success");
  } catch (error) {
    showStatus("保存失败: " + error.message, "error");
  }
}

async function editProvider(id) {
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const p = (response.providers || []).find((x) => x.id === id);
  if (p) showProviderForm(p);
}

async function deleteProvider(id) {
  if (!confirm("确定要删除这个服务商吗？")) return;
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  let providers = (response.providers || []).filter((p) => p.id !== id);

  if (currentProviderId === id) {
    if (providers.length > 0) {
      providers[0].isCurrent = true;
      currentProviderId = providers[0].id;
    } else {
      currentProviderId = null;
      // const currentSection = document.getElementById('currentConfigSection');
      // if (currentSection) currentSection.style.display = 'none';
    }
  }

  await chrome.runtime.sendMessage({
    action: "saveSettings",
    settings: { ...response, providers },
  });
  renderProvidersList(providers);
  // if (currentProviderId) updateCurrentDisplay(providers.find(p => p.id === currentProviderId)); // Removed
  showStatus("服务商已删除", "success");
}

async function useProvider(id) {
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  let providers = response.providers || [];
  const p = providers.find((x) => x.id === id);
  if (!p) return;

  currentProviderId = id;
  providers = providers.map((x) => ({ ...x, isCurrent: x.id === id }));
  await chrome.runtime.sendMessage({
    action: "saveSettings",
    settings: { ...response, providers },
  });
  // updateCurrentDisplay(p); // Removed

  // Re-render whole list to update badges
  renderProvidersList(providers);
  showStatus("已选择 " + p.name, "success");
}

// updateCurrentDisplay removed

async function saveAllSettings() {
  const maxHistory =
    parseInt(document.getElementById("maxHistory").value) || 100;
  const useNotifications = document.getElementById("useNotifications").checked;
  const allowNSFW = document.getElementById("allowNSFW").checked;
  const imagesPerRow =
    parseInt(document.getElementById("imagesPerRow").value) || 4;

  // WebDAV 配置
  const webdavUrl = document.getElementById("webdavUrl").value.trim();
  const webdavUsername = document.getElementById("webdavUsername").value.trim();
  const webdavPassword = document.getElementById("webdavPassword").value.trim();
  const webdavFilename = document.getElementById("webdavFilename").value.trim() || "ai-drawer-config.json";
  const webdavAutoSync = document.getElementById("webdavAutoSync").checked;
  const securityKey = document.getElementById("securityKey").value;

  const response = await chrome.runtime.sendMessage({ action: "getSettings" });

  // 图片上传服务配置 - 保持现有的服务配置
  const imageUploadServices = response.imageUploadServices || [];

  // 自动递增配置版本号
  const currentVersion = response.configVersion || 1;
  const newVersion = currentVersion + 1;

  await chrome.runtime.sendMessage({
    action: "saveSettings",
    settings: {
      ...response,
      maxHistory,
      useNotifications,
      allowNSFW,
      imagesPerRow,
      webdavUrl,
      webdavUsername,
      webdavPassword,
      webdavFilename,
      webdavAutoSync,
      // 安全密钥：空字符串表示清除密钥
      securityKey: securityKey,
      // 图片上传服务配置
      imageUploadServices,
      // 更新版本号
      configVersion: newVersion,
    },
  });

  showStatus(`所有设置已保存！（版本号：${newVersion}）`, "success");

  // 如果开启了自动同步，则保存后自动上传
  if (webdavAutoSync) {
    console.log("WebDAV 自动同步已开启，正在上传配置...");
    uploadToWebDAV();
  }
}

// Test specific provider connection (per-card test button)
async function testProviderConnection(provider) {
  const btnTest = event.target; // Get the button that was clicked
  const originalText = btnTest.textContent;
  btnTest.disabled = true;
  btnTest.textContent = "⏳";

  try {
    const result = await chrome.runtime.sendMessage({
      action: "testConnection",
      settings: {
        endpoint: provider.endpoint,
        apiKey: provider.key,
        responsePath: provider.responsePath,
        customHeaders: provider.customHeaders,
        customParams: provider.customParams,
      },
    });
    if (result.success) showStatus(`✅ ${provider.name} 连接成功！`, "success");
    else throw new Error(result.error || "连接失败");
  } catch (error) {
    showStatus(`❌ ${provider.name} 连接失败：${error.message}`, "error");
  } finally {
    btnTest.disabled = false;
    btnTest.textContent = originalText;
  }
}

// Legacy global test connection (kept for compatibility, but not used in UI)
async function testConnection() {
  if (!currentProviderId) {
    showStatus('请先选择一个服务商并点击"使用"', "error");
    return;
  }
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const p = (response.providers || []).find((x) => x.id === currentProviderId);
  if (!p) return;

  const testBtn = document.getElementById("testBtn");
  testBtn.disabled = true;
  testBtn.textContent = "测试中...";

  try {
    const result = await chrome.runtime.sendMessage({
      action: "testConnection",
      settings: {
        endpoint: p.endpoint,
        apiKey: p.key,
        responsePath: p.responsePath,
        customHeaders: p.customHeaders,
        customParams: p.customParams,
      },
    });
    if (result.success) showStatus("✅ API连接成功！", "success");
    else throw new Error(result.error || "连接失败");
  } catch (error) {
    showStatus("❌ 连接失败：" + error.message, "error");
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "🧪 测试连接";
  }
}

function resetSettings() {
  if (!confirm("确定要重置所有设置为默认值吗？这将删除所有服务商配置！"))
    return;
  currentProviderId = null;
  chrome.runtime.sendMessage({
    action: "saveSettings",
    settings: {
      providers: [],
      maxHistory: 100,
      useNotifications: true,
      imagesPerRow: 4,
    },
  });
  const currentSection = document.getElementById("currentConfigSection");
  if (currentSection) currentSection.style.display = "none";
  renderProvidersList([]);
  document.getElementById("maxHistory").value = 100;
  document.getElementById("useNotifications").checked = true;
  document.getElementById("imagesPerRow").value = 4;
  showStatus("✅ 已重置为默认设置", "success");
}

async function copyProvider(providerId) {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    const provider = settings.providers.find((p) => p.id === providerId);
    if (!provider) return;

    // 深拷贝
    const copiedProvider = JSON.parse(JSON.stringify(provider));
    copiedProvider.id = null; // 清除ID，确保保存时生成新ID
    copiedProvider.name = `副本 - ${copiedProvider.name}`;

    showProviderForm(copiedProvider);
    // 强制清除编辑ID，确保是新增模式
    editingProviderId = null;
    document.getElementById("formTitle").textContent = "添加服务商 (复制)";
    showStatus("已复制配置，请修改后保存", "info");
  } catch (error) {
    console.error("复制失败:", error);
    showStatus("复制失败: " + error.message, "error");
  }
}

// Reorder providers via drag-and-drop
async function reorderProviders(draggedId, targetId) {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    let providers = settings.providers || [];

    const draggedIndex = providers.findIndex((p) => p.id === draggedId);
    const targetIndex = providers.findIndex((p) => p.id === targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged item and insert at target position
    const [draggedItem] = providers.splice(draggedIndex, 1);
    providers.splice(targetIndex, 0, draggedItem);

    // Save reordered providers
    await chrome.storage.local.set({ settings: { ...settings, providers } });

    // Re-render list
    renderProvidersList(providers);

    // Notify background to update context menu
    chrome.runtime.sendMessage({ action: "updateContextMenu" });

    showStatus("✅ 顺序已更新", "success");
  } catch (error) {
    console.error("重新排序失败:", error);
    showStatus("排序失败: " + error.message, "error");
  }
}

function generateId() {
  return (
    "provider_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9)
  );
}

// ==================== WebDAV 版本检查 ====================

/**
 * 检查 WebDAV 远程配置的版本号
 */
async function checkWebDAVVersion(currentSettings) {
  try {
    const config = getWebDAVConfig();
    if (!config.url) return;

    console.log("正在检查 WebDAV 远程配置版本...");

    // 发送消息给 background 下载配置文件（仅读取元数据）
    const result = await chrome.runtime.sendMessage({
      action: "webdavDownload",
      config: config,
    });

    if (result.success) {
      let data = result.data;

      // 检测是否需要解密
      if (isEncrypted(data)) {
        // 需要解密，尝试获取密钥
        let securityKey = await getSecurityKey();

        if (!securityKey) {
          // 无法解密，无法检查版本
          console.log("无法解密 WebDAV 配置文件，跳过版本检查");
          return;
        }

        // 尝试解密
        data = await decryptData(data, securityKey);
      }

      const remoteSettings = JSON.parse(data);

      // 简单校验
      if (!remoteSettings || typeof remoteSettings !== "object") {
        console.log("WebDAV 配置文件格式无效，跳过版本检查");
        return;
      }

      const currentVersion = currentSettings.configVersion || 1;
      const remoteVersion = remoteSettings.configVersion || 1;

      console.log(`本地版本号：${currentVersion}，远程版本号：${remoteVersion}`);

      // 如果远程版本号更高，显示提示
      if (remoteVersion > currentVersion) {
        showVersionUpdateAlert(currentVersion, remoteVersion);
      }
    }
  } catch (error) {
    console.log("WebDAV 版本检查失败:", error.message);
    // 静默失败，不影响正常使用
  }
}

/**
 * 显示版本更新提示
 */
function showVersionUpdateAlert(currentVersion, remoteVersion) {
  // 移除已有的提示
  const existing = document.getElementById("webdavVersionAlert");
  if (existing) existing.remove();

  const alert = document.createElement("div");
  alert.id = "webdavVersionAlert";
  alert.className = "webdav-version-alert";
  alert.innerHTML = `
    <div class="alert-content">
      <span class="alert-icon">🔄</span>
      <div class="alert-text">
        <strong>发现新版本配置</strong>
        <br>
        <span>远程版本：${remoteVersion} | 本地版本：${currentVersion}</span>
      </div>
      <button id="updateFromWebDAVBtn" class="btn primary small">
        更新配置
      </button>
      <button id="closeVersionAlertBtn" class="btn secondary small">
        稍后
      </button>
    </div>
  `;

  // 添加到页面顶部
  const container = document.querySelector(".container");
  if (container) {
    container.insertBefore(alert, container.firstChild);
  }

  // 绑定事件
  document.getElementById("updateFromWebDAVBtn").onclick = () => {
    downloadFromWebDAV();
    alert.remove();
  };

  document.getElementById("closeVersionAlertBtn").onclick = () => {
    alert.remove();
  };
}

// ==================== 结束 WebDAV 版本检查 ====================

/**
 * 检查版本号并弹出确认对话框
 * @param {number} currentVersion - 当前版本号
 * @param {number} importVersion - 导入/远程版本号
 * @param {string} sourceName - 配置来源名称（"导入" 或 "WebDAV 远程"）
 * @returns {boolean} 是否继续导入
 */
function checkVersionAndConfirm(currentVersion, importVersion, sourceName) {
  if (importVersion > currentVersion) {
    const confirmForce = confirm(
      `⚠️ 警告：${sourceName}配置版本号（${importVersion}）比当前版本号（${currentVersion}）更高！\n\n` +
      `这将覆盖您的本地配置。\n\n` +
      `是否继续强制导入？\n\n` +
      `点击"确定"继续导入（本地配置将被覆盖）\n` +
      `点击"取消"取消导入`
    );
    return confirmForce;
  }
  return true;
}

/**
 * 保存导入的设置
 * @param {object} settings - 要保存的设置
 * @param {number} importVersion - 导入的版本号
 * @param {function} statusCallback - 状态显示回调函数
 */
async function saveImportedSettings(settings, importVersion, statusCallback) {
  try {
    // 补全默认值
    const newSettings = { ...defaultSettings, ...settings };
    // 保持导入的版本号（不自动递增）
    newSettings.configVersion = importVersion;

    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: newSettings,
    });

    statusCallback(`配置已导入（版本号：${importVersion}），正在刷新...`, "success");
    setTimeout(() => {
      loadSettings(); // 重新加载设置
    }, 1000);
  } catch (error) {
    console.error("导入保存失败:", error);
    statusCallback("导入保存失败: " + error.message, "error");
  }
}

function showStatus(msg, type = "info") {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = msg;
  el.className = "status " + type;
  setTimeout(() => {
    el.textContent = "";
    el.className = "status";
  }, 3000);
}

async function exportSettings() {
  try {
    const { settings } = await chrome.storage.local.get("settings");

    // 检查是否有安全密钥
    const securityKey = await getSecurityKey();

    let data;
    if (securityKey) {
      // 有安全密钥：只移除 securityKey（不加密存储），其他全部保留
      const exportSettings = { ...settings };
      delete exportSettings.securityKey;
      // 确保版本号存在
      if (!exportSettings.configVersion) {
        exportSettings.configVersion = 1;
      }
      data = await encryptData(JSON.stringify(exportSettings, null, 2), securityKey);
      showStatus(`配置已加密导出（版本号：${exportSettings.configVersion}）`, "success");
    } else {
      // 无安全密钥：移除敏感信息后明文导出
      const exportSettings = { ...settings };
      delete exportSettings.securityKey;
      delete exportSettings.webdavPassword;
      // 确保版本号存在
      if (!exportSettings.configVersion) {
        exportSettings.configVersion = 1;
      }
      data = JSON.stringify(exportSettings, null, 2);
      showStatus(`配置已导出（未加密，版本号：${exportSettings.configVersion}）`, "info");
    }

    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-drawer-config-v${exportSettings.configVersion}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    showStatus("导出失败: " + e.message, "error");
  }
}

async function importSettings(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      let data = e.target.result;

      // 检测是否已加密
      if (isEncrypted(data)) {
        // 需要解密，尝试获取密钥
        let securityKey = await getSecurityKey();

        if (!securityKey) {
          // 弹出输入框让用户输入密钥
          securityKey = prompt("配置文件已加密，请输入安全密钥：");
          if (!securityKey) {
            showStatus("需要输入安全密钥才能导入配置", "error");
            return;
          }
        }

        // 尝试解密
        data = await decryptData(data, securityKey);
      }

      const settings = JSON.parse(data);
      if (!settings || typeof settings !== "object") {
        throw new Error("无效的配置文件格式");
      }

      // 显示部分导入预览模态框
      showImportPreviewModal(settings);

    } catch (error) {
      console.error("导入失败:", error);
      showStatus("导入失败: " + error.message, "error");
    }
  };
  reader.readAsText(file);
  event.target.value = ""; // 重置 input
}

/**
 * 显示导入预览模态框（支持部分导入）
 * @param {Object} imported - 解析后的配置数据
 */
function showImportPreviewModal(imported) {
  pendingImportData = imported;
  const content = document.getElementById("importPreviewContent");

  if (!content) {
    // 如果找不到新模态框，回退到旧的导入方式
    fallbackImport(imported);
    return;
  }

  // 定义可导入的配置项
  const configItems = [
    { key: "providers", label: "API 服务商", icon: "🔌", countKey: "length" },
    { key: "imageUploadServices", label: "图片上传服务", icon: "📤", countKey: "length" },
    { key: "analyzeProviders", label: "图片分析服务商", icon: "🔍", countKey: "length" },
    { key: "webdav", label: "WebDAV 配置", icon: "☁️", isGroup: true, 
      keys: ["webdavUrl", "webdavUsername", "webdavPassword", "webdavFilename", "webdavAutoSync"] },
    { key: "maxHistory", label: "最大历史记录数", icon: "📊", isSingle: true },
    { key: "imagesPerRow", label: "每行图片数", icon: "🖼️", isSingle: true },
    { key: "allowNSFW", label: "允许 NSFW 内容", icon: "🔞", isSingle: true },
    { key: "useNotifications", label: "启用通知", icon: "🔔", isSingle: true },
    { key: "securityKey", label: "安全密钥", icon: "🔐", isSingle: true, sensitive: true },
    { key: "historyPasswordHash", label: "历史记录密码", icon: "🔒", isSingle: true, sensitive: true },
  ];

  let html = '<div class="import-preview-list">';

  configItems.forEach(item => {
    // 处理组类型配置项（如 WebDAV）
    if (item.isGroup) {
      // 检查组内是否有任何配置
      const hasAnyValue = item.keys.some(key => {
        const val = imported[key];
        return val !== undefined && val !== null && val !== "";
      });

      // 显示预览
      let preview = "";
      if (hasAnyValue) {
        const configuredCount = item.keys.filter(key => {
          const val = imported[key];
          return val !== undefined && val !== null && val !== "";
        }).length;
        preview = `${configuredCount} 项已配置`;
      }

      html += `
        <div class="import-preview-item ${hasAnyValue ? "" : "disabled"}">
          <label class="import-item-label">
            <input type="checkbox" class="import-checkbox" data-key="${item.key}" data-keys="${item.keys.join(',')}" ${hasAnyValue ? "checked" : "disabled"}>
            <span class="import-item-icon">${item.icon}</span>
            <span class="import-item-text">
              <span class="import-item-name">${item.label}</span>
              ${hasAnyValue ? `<span class="import-item-preview">${escapeHtml(preview)}</span>` : '<span class="import-item-empty">无数据</span>'}
            </span>
          </label>
        </div>
      `;
      return;
    }

    const value = imported[item.key];
    const hasValue = value !== undefined && value !== null && value !== "";

    // 对于数组类型，检查是否有内容
    const hasContent = item.countKey ? (Array.isArray(value) && value.length > 0) : hasValue;

    // 显示数量或值预览
    let preview = "";
    if (hasContent) {
      if (item.countKey) {
        preview = `${value.length} 项`;
      } else if (item.sensitive) {
        preview = "已设置";
      } else if (typeof value === "boolean") {
        preview = value ? "是" : "否";
      } else {
        preview = String(value).substring(0, 30) + (String(value).length > 30 ? "..." : "");
      }
    }

    html += `
      <div class="import-preview-item ${hasContent ? "" : "disabled"}">
        <label class="import-item-label">
          <input type="checkbox" class="import-checkbox" data-key="${item.key}" ${hasContent ? "checked" : "disabled"}>
          <span class="import-item-icon">${item.icon}</span>
          <span class="import-item-text">
            <span class="import-item-name">${item.label}</span>
            ${hasContent ? `<span class="import-item-preview">${escapeHtml(preview)}</span>` : '<span class="import-item-empty">无数据</span>'}
          </span>
        </label>
      </div>
    `;
  });

  html += "</div>";

  content.innerHTML = html;

  // 显示模态框
  const modal = document.getElementById("importPreviewModal");
  if (modal) {
    modal.style.display = "flex";
  }
}

/**
 * 回退导入方式（当找不到新模态框时使用）
 */
async function fallbackImport(settings) {
  // 简单校验
  if (!Array.isArray(settings.providers)) {
    showStatus("配置文件缺少 providers 列表", "error");
    return;
  }

  // 获取当前配置版本号
  const { settings: currentSettings } = await chrome.storage.local.get("settings");
  const currentVersion = currentSettings.configVersion || 1;
  const importVersion = settings.configVersion || 1;

      // 如果导入的配置版本号比当前大，给出提示
      if (!checkVersionAndConfirm(currentVersion, importVersion, "导入")) {
        showStatus("已取消导入", "info");
        return;
      }

  // 弹出预览确认框
  showConfigPreviewModal(settings, async () => {
    try {
      // 补全默认值
      const newSettings = { ...defaultSettings, ...settings };
      // 保持导入的版本号（不自动递增）
      newSettings.configVersion = importVersion;

      await chrome.runtime.sendMessage({
        action: "saveSettings",
        settings: newSettings,
      });

      showStatus(`配置已导入（版本号：${importVersion}），正在刷新...`, "success");
      setTimeout(() => {
        loadSettings(); // 重新加载设置
      }, 1000);
    } catch (error) {
      console.error("导入保存失败:", error);
      showStatus("导入保存失败: " + error.message, "error");
    }
  });
}

/**
 * 执行部分导入
 */
async function executePartialImport() {
  if (!pendingImportData) return;

  const checkboxes = document.querySelectorAll(".import-checkbox");
  const mergeMode = document.getElementById("importMergeMode")?.checked ?? true;
  const selectedKeys = [];

  checkboxes.forEach(cb => {
    if (cb.checked && !cb.disabled) {
      // 检查是否是组类型配置项
      const keysStr = cb.dataset.keys;
      if (keysStr) {
        // 组类型：导入所有子键
        const keys = keysStr.split(",");
        keys.forEach(key => {
          selectedKeys.push(key);
        });
      } else {
        // 普通配置项
        selectedKeys.push(cb.dataset.key);
      }
    }
  });

  if (selectedKeys.length === 0) {
    showStatus("请至少选择一项配置进行导入", "error");
    return;
  }

  try {
    // 获取当前配置
    const { settings: currentSettings } = await chrome.storage.local.get("settings");

    // 执行导入
    selectedKeys.forEach(key => {
      const importedValue = pendingImportData[key];

      // 对于数组类型的配置，支持合并模式
      if (key === "providers" || key === "imageUploadServices" || key === "analyzeProviders") {
        if (mergeMode && Array.isArray(currentSettings[key]) && Array.isArray(importedValue)) {
          // 合并模式：保留现有配置，添加新项（根据 ID 去重）
          const existingIds = new Set(currentSettings[key].map(item => item.id));
          const newItems = importedValue.filter(item => !existingIds.has(item.id));
          currentSettings[key] = [...currentSettings[key], ...newItems];
        } else {
          // 覆盖模式：直接替换
          currentSettings[key] = importedValue;
        }
      } else {
        // 非数组类型直接覆盖
        currentSettings[key] = importedValue;
      }
    });

    // 更新版本号
    const importVersion = pendingImportData.configVersion || 1;
    currentSettings.configVersion = importVersion;

    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: currentSettings,
    });

    // 关闭模态框
    const modal = document.getElementById("importPreviewModal");
    if (modal) {
      modal.style.display = "none";
    }

    pendingImportData = null;

    showStatus(`已导入 ${selectedKeys.length} 项配置，正在刷新...`, "success");

    setTimeout(() => {
      loadSettings(); // 重新加载设置
    }, 1000);
  } catch (error) {
    console.error("导入保存失败:", error);
    showStatus("导入保存失败: " + error.message, "error");
  }
}

/**
 * HTML 转义函数
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ==================== WebDAV 同步功能 ====================

function getWebDAVConfig() {
  return {
    url: document.getElementById("webdavUrl")?.value.trim() || "",
    username: document.getElementById("webdavUsername")?.value.trim() || "",
    password: document.getElementById("webdavPassword")?.value.trim() || "",
    filename: document.getElementById("webdavFilename")?.value.trim() || "ai-drawer-config.json",
    autoSync: document.getElementById("webdavAutoSync")?.checked || false,
  };
}

function showWebDAVStatus(msg, type = "info") {
  const el = document.getElementById("webdavStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "status " + type;
  setTimeout(() => {
    el.textContent = "";
    el.className = "status";
  }, 4000);
}

// ==================== 加密/解密功能（使用 AES-GCM）====================

/**
 * 从密码派生 AES-GCM 密钥
 */
async function deriveKey(password) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  // 使用固定 salt，确保相同密码产生相同密钥
  const salt = encoder.encode("chrome-drawer-salt");
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 加密数据
 */
async function encryptData(data, password) {
  if (!password) return data;

  const encoder = new TextEncoder();
  const key = await deriveKey(password);
  // 生成随机 IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encoder.encode(data)
  );

  // 组合 IV + 加密数据并转换为 base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * 解密数据
 */
async function decryptData(encryptedData, password) {
  if (!password) return encryptedData;

  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // 从 base64 解码
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

    // 提取 IV 和加密数据
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const key = await deriveKey(password);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      data
    );

    return decoder.decode(decrypted);
  } catch (e) {
    throw new Error("解密失败，密钥可能不正确");
  }
}

/**
 * 获取安全密钥
 * 优先：1. 输入框有内容时使用输入框  2. 否则使用已保存的密钥
 */
async function getSecurityKey() {
  const inputKey = document.getElementById("securityKey")?.value || "";
  return inputKey;
}

/**
 * 检查数据是否已加密（通过检测格式）
 */
function isEncrypted(data) {
  // 1. 先尝试直接解析 JSON，如果成功，说明是未加密的配置
  try {
    const obj = JSON.parse(data);
    if (obj && typeof obj === 'object') {
      return false; // 是有效的 JSON，未加密
    }
  } catch (e) {
    // 不是 JSON，继续检查是否为加密数据
  }

  // 2. 检查是否为有效的 Base64 字符串（加密数据特征）
  try {
    const decoded = atob(data);
    // 加密数据包含 IV (12 bytes) + 密文，长度至少 28 bytes
    if (decoded.length < 28) return false;

    // 如果是 Base64 且无法解析为 JSON，则极大概率是加密数据
    // (因为我们的加密数据是 Base64 编码的二进制流)
    try {
      JSON.parse(decoded);
      return false; // Base64 解码后是 JSON，说明是 Base64 编码的明文（不符合加密格式）
    } catch {
      return true; // Base64 解码后不是 JSON，认为是加密数据
    }
  } catch (e) {
    return false; // 既不是 JSON 也无法 Base64 解码，视为未加密（或格式错误）
  }
}

async function testWebDAVConnection() {
  const config = getWebDAVConfig();

  if (!config.url) {
    showWebDAVStatus("请输入 WebDAV 服务器地址", "error");
    return;
  }

  const btn = document.getElementById("webdavTestBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳";

  try {
    const result = await chrome.runtime.sendMessage({
      action: "webdavTest",
      config: config,
    });

    if (result.success) {
      showWebDAVStatus("✅ 连接成功！", "success");
    } else {
      throw new Error(result.error || "连接失败");
    }
  } catch (error) {
    showWebDAVStatus("❌ 连接失败: " + error.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function uploadToWebDAV() {
  const config = getWebDAVConfig();

  if (!config.url) {
    showWebDAVStatus("请输入 WebDAV 服务器地址", "error");
    return;
  }

  const btn = document.getElementById("webdavUploadBtn");
  let originalText = "";
  if (btn) {
    originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "⏳";
  }

  try {
    // 获取当前配置
    const { settings } = await chrome.storage.local.get("settings");

    // 检查是否有安全密钥
    const securityKey = await getSecurityKey();

    let data;
    const version = settings.configVersion || 1;

    if (securityKey) {
      // 有安全密钥：只移除 securityKey（不加密存储），其他全部保留
      const exportSettings = { ...settings };
      delete exportSettings.securityKey;
      // 确保版本号存在
      if (!exportSettings.configVersion) {
        exportSettings.configVersion = 1;
      }
      data = await encryptData(JSON.stringify(exportSettings, null, 2), securityKey);
    } else {
      // 无安全密钥：移除敏感信息后明文导出
      const exportSettings = { ...settings };
      delete exportSettings.securityKey;
      delete exportSettings.webdavPassword;
      // 确保版本号存在
      if (!exportSettings.configVersion) {
        exportSettings.configVersion = 1;
      }
      data = JSON.stringify(exportSettings, null, 2);
      showStatus(`配置已导出（未加密，版本号：${exportSettings.configVersion}）`, "info");
    }

    const result = await chrome.runtime.sendMessage({
      action: "webdavUpload",
      config: config,
      data: data,
    });

    if (result.success) {
      showWebDAVStatus(`✅ 配置已上传到 WebDAV（版本号：${version}）`, "success");
    } else {
      throw new Error(result.error || "上传失败");
    }
  } catch (error) {
    showWebDAVStatus("❌ 上传失败: " + error.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function downloadFromWebDAV() {
  const config = getWebDAVConfig();

  if (!config.url) {
    showWebDAVStatus("请输入 WebDAV 服务器地址", "error");
    return;
  }

  const btn = document.getElementById("webdavDownloadBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳";

  try {
    // 获取当前配置版本号
    const { settings: currentSettings } = await chrome.storage.local.get("settings");
    const currentVersion = currentSettings.configVersion || 1;

    const result = await chrome.runtime.sendMessage({
      action: "webdavDownload",
      config: config,
    });

    if (result.success) {
      let data = result.data;

      // 检测是否需要解密
      if (isEncrypted(data)) {
        // 需要解密，尝试获取密钥
        let securityKey = await getSecurityKey();

        if (!securityKey) {
          // 弹出输入框让用户输入密钥
          securityKey = prompt("配置文件已加密，请输入安全密钥：");
          if (!securityKey) {
            throw new Error("需要输入安全密钥才能导入配置");
          }
        }

        // 尝试解密
        data = await decryptData(data, securityKey);
      }

      const settings = JSON.parse(data);

      // 简单校验
      if (!settings || typeof settings !== "object") {
        throw new Error("无效的配置文件格式");
      }
      if (!Array.isArray(settings.providers)) {
        throw new Error("配置文件缺少 providers 列表");
      }

      const remoteVersion = settings.configVersion || 1;

      // 如果远程版本号比当前大，给出提示
      if (!checkVersionAndConfirm(currentVersion, remoteVersion, "WebDAV 远程")) {
        showWebDAVStatus("已取消导入", "info");
        return;
      }

      // 显示部分导入预览模态框
      showImportPreviewModal(settings);

    } else {
      throw new Error(result.error || "下载失败");
    }
  } catch (error) {
    showWebDAVStatus("❌ 下载失败: " + error.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// 侧边菜单切换标签页
function switchTab(tabName) {
  // 更新导航按钮状态
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.dataset.tab === tabName) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // 切换内容区域
  const tabContents = document.querySelectorAll('.tab-content');
  tabContents.forEach(content => {
    if (content.id === `tab-${tabName}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

// 更新快捷键显示
async function updateShortcutDisplay() {
  const shortcutDisplay = document.getElementById('shortcutDisplay');
  const shortcutHint = document.getElementById('shortcutHint');
  const shortcutDesc = document.getElementById('shortcutDesc');

  if (!shortcutDisplay || !shortcutHint || !shortcutDesc) return;

  try {
    // 获取当前配置的快捷键
    const commands = await chrome.commands.getAll();
    const drawCommand = commands.find(cmd => cmd.name === 'draw-image');

    if (drawCommand && drawCommand.shortcut) {
      // 快捷键已设置，显示当前快捷键
      shortcutDisplay.textContent = drawCommand.shortcut;
      shortcutHint.style.display = 'none';
      shortcutDesc.style.display = 'inline';
    } else {
      // 快捷键未设置
      shortcutDisplay.textContent = '未设置';
      shortcutHint.style.display = 'inline';
      shortcutDesc.style.display = 'none';
    }
  } catch (error) {
    console.error('获取快捷键失败:', error);
    // 出错时显示默认值
    shortcutDisplay.textContent = 'Ctrl+Shift+D';
    shortcutHint.style.display = 'none';
    shortcutDesc.style.display = 'inline';
  }
}

// ==================== 图片上传服务管理 ====================

function renderUploadServicesList(services) {
  const container = document.getElementById("uploadServicesList");
  const noMessage = document.getElementById("noUploadServicesMessage");

  if (!services || services.length === 0) {
    if (container) container.style.display = "none";
    if (noMessage) noMessage.style.display = "block";
    return;
  }

  if (container) container.style.display = "grid";
  if (noMessage) noMessage.style.display = "none";

  if (container) {
    container.innerHTML = "";
    services.forEach((service) => {
      const item = createUploadServiceItem(service);
      container.appendChild(item);
    });
  }
}

function createUploadServiceItem(service) {
  const template = document.getElementById("uploadServiceItemTemplate");
  const clone = template.content.cloneNode(true);

  const div = clone.querySelector(".provider-item");
  div.dataset.id = service.id;

  if (service.id === currentUploadServiceId) {
    div.classList.add("active");
    const badge = div.querySelector(".provider-status-badge");
    if (badge) badge.style.display = "block";
  }

  div.querySelector(".provider-name").textContent = service.name;
  div.querySelector(".provider-endpoint").textContent = service.url;
  div.querySelector(".provider-endpoint").title = service.url;

  const btnCopy = div.querySelector(".btn-copy");
  if (btnCopy) {
    btnCopy.addEventListener("click", (e) => {
      e.stopPropagation();
      copyUploadService(service.id);
    });
  }

  div.querySelector(".btn-edit").addEventListener("click", (e) => {
    e.stopPropagation();
    editUploadService(service.id);
  });

  div.querySelector(".btn-delete").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteUploadService(service.id);
  });

  const btnTest = div.querySelector(".btn-test");
  if (btnTest) {
    btnTest.addEventListener("click", (e) => {
      e.stopPropagation();
      testUploadServiceConnection(service);
    });
  }

  div.addEventListener("click", () => useUploadService(service.id));

  return clone;
}

function showUploadServiceForm(service = null) {
  clearUploadServiceForm();

  const section = document.getElementById("uploadServiceFormSection");
  const title = document.getElementById("uploadFormTitle");
  if (!section) return;

  editingUploadServiceId = service ? service.id : null;

  if (service) {
    if (title) title.textContent = "编辑上传服务";
    document.getElementById("uploadServiceName").value = service.name || "";
    document.getElementById("uploadServiceUrl").value = service.url || "";
    document.getElementById("uploadServiceKey").value = service.key || "";
    document.getElementById("uploadServiceAuthType").value = service.authType || "header";
    document.getElementById("uploadServiceHeaderName").value = service.headerName || "X-API-Key";
    document.getElementById("uploadServiceResponsePath").value = service.responsePath || "image.url";
    document.getElementById("uploadServiceFieldName").value = service.fieldName || "source";
    document.getElementById("uploadServiceFormat").value = service.format || "json";

    // 加载自定义参数
    if (service.customParams) {
      Object.entries(service.customParams).forEach(([k, v]) => {
        // 检查是否是新格式（包含usage信息）
        if (v && typeof v === "object" && v.value !== undefined) {
          addUploadParameterRow(k, v.value, v.usage || "common");
        } else {
          // 旧格式兼容
          addUploadParameterRow(k, v, "common");
        }
      });
    }
  } else {
    if (title) title.textContent = "添加上传服务";
    clearUploadServiceForm();
  }

  section.style.display = "block";
  section.scrollIntoView({ behavior: "smooth" });
}

function hideUploadServiceForm() {
  const section = document.getElementById("uploadServiceFormSection");
  if (section) section.style.display = "none";
  editingUploadServiceId = null;
  clearUploadServiceForm();
}

function clearUploadServiceForm() {
  [
    "uploadServiceName",
    "uploadServiceUrl",
    "uploadServiceKey",
    "uploadServiceHeaderName",
    "uploadServiceResponsePath",
    "uploadServiceFieldName"
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  const authTypeSelect = document.getElementById("uploadServiceAuthType");
  if (authTypeSelect) authTypeSelect.value = "header";

  const formatSelect = document.getElementById("uploadServiceFormat");
  if (formatSelect) formatSelect.value = "json";

  const ignoreExpirationCheckbox = document.getElementById("uploadServiceIgnoreExpiration");
  if (ignoreExpirationCheckbox) ignoreExpirationCheckbox.checked = false;

  // 清除自定义参数
  const paramsContainer = document.getElementById("uploadCustomParamsList");
  if (paramsContainer) paramsContainer.innerHTML = "";
}

async function saveUploadService() {
  const name = document.getElementById("uploadServiceName").value.trim();
  const url = document.getElementById("uploadServiceUrl").value.trim();
  const key = document.getElementById("uploadServiceKey").value.trim();
  const authType = document.getElementById("uploadServiceAuthType").value || "header";
  const headerName = document.getElementById("uploadServiceHeaderName").value.trim() || "X-API-Key";
  const responsePath = document.getElementById("uploadServiceResponsePath").value.trim() || "image.url";
  const fieldName = document.getElementById("uploadServiceFieldName").value.trim() || "source";
  const format = document.getElementById("uploadServiceFormat").value || "json";
  const ignoreExpiration = false; // 移除忽略过期参数功能

  // 收集自定义参数
  const customParams = {};
  document.querySelectorAll(".upload-param-row").forEach((row) => {
    const k = row.querySelector(".upload-param-key").value.trim();
    const v = row.querySelector(".upload-param-value").value.trim();
    const usage = row.querySelector(".upload-param-usage").value;
    if (k) {
      customParams[k] = {
        value: v,
        usage: usage
      };
    }
  });

  if (!name || !url) {
    showStatus("请输入服务名称和上传端点", "error");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    let services = response.imageUploadServices || [];

    const serviceData = {
      name,
      url,
      key,
      authType,
      headerName,
      responsePath,
      fieldName,
      format,
      ignoreExpiration,
      customParams
    };

    if (editingUploadServiceId) {
      services = services.map((s) =>
        s.id === editingUploadServiceId ? { ...s, ...serviceData } : s
      );
    } else {
      const newService = {
        id: generateId(),
        ...serviceData,
        isActive: services.length === 0
      };
      services.push(newService);
      if (newService.isActive) currentUploadServiceId = newService.id;
    }

    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: { ...response, imageUploadServices: services }
    });

    hideUploadServiceForm();
    renderUploadServicesList(services);
    showStatus("保存成功", "success");
  } catch (error) {
    showStatus("保存失败: " + error.message, "error");
  }
}

async function editUploadService(id) {
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const service = (response.imageUploadServices || []).find((s) => s.id === id);
  if (service) showUploadServiceForm(service);
}

async function deleteUploadService(id) {
  if (!confirm("确定要删除这个上传服务吗？")) return;

  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  let services = (response.imageUploadServices || []).filter((s) => s.id !== id);

  if (currentUploadServiceId === id) {
    if (services.length > 0) {
      services[0].isActive = true;
      currentUploadServiceId = services[0].id;
    } else {
      currentUploadServiceId = null;
    }
  }

  await chrome.runtime.sendMessage({
    action: "saveSettings",
    settings: { ...response, imageUploadServices: services }
  });

  renderUploadServicesList(services);
  showStatus("上传服务已删除", "success");
}

async function useUploadService(id) {
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  let services = response.imageUploadServices || [];
  const service = services.find((s) => s.id === id);
  if (!service) return;

  currentUploadServiceId = id;
  services = services.map((s) => ({ ...s, isActive: s.id === id }));

  await chrome.runtime.sendMessage({
    action: "saveSettings",
    settings: { ...response, imageUploadServices: services }
  });

  renderUploadServicesList(services);
  showStatus("已选择 " + service.name, "success");
}

async function copyUploadService(serviceId) {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    const service = settings.imageUploadServices.find((s) => s.id === serviceId);
    if (!service) return;

    const copiedService = JSON.parse(JSON.stringify(service));
    copiedService.id = null;
    copiedService.name = `副本 - ${copiedService.name}`;

    showUploadServiceForm(copiedService);
    editingUploadServiceId = null;
    document.getElementById("uploadFormTitle").textContent = "添加上传服务 (复制)";
    showStatus("已复制配置，请修改后保存", "info");
  } catch (error) {
    console.error("复制失败:", error);
    showStatus("复制失败: " + error.message, "error");
  }
}

async function testUploadServiceConnection(service) {
  const btnTest = event.target;
  const originalText = btnTest.textContent;
  btnTest.disabled = true;
  btnTest.textContent = "⏳";

  try {
    // 创建一个1x1像素的测试图片
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(0, 0, 1, 1);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

    const result = await chrome.runtime.sendMessage({
      action: "testImageUpload",
      config: {
        uploadUrl: service.url,
        uploadKey: service.key,
        authType: service.authType,
        headerName: service.headerName,
        responsePath: service.responsePath,
        fieldName: service.fieldName,
        format: service.format,
        customParams: service.customParams || {}
      },
      testImageBlob: await blobToBase64(blob)
    });

    if (result.success) {
      showStatus(`✅ ${service.name} 连接成功！`, "success");
    } else {
      throw new Error(result.error || "连接失败");
    }
  } catch (error) {
    showStatus(`❌ ${service.name} 连接失败：${error.message}`, "error");
  } finally {
    btnTest.disabled = false;
    btnTest.textContent = originalText;
  }
}
// 将blob转换为base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 添加上传参数行
function addUploadParameterRow(key = "", value = "", usage = "common") {
  const container = document.getElementById("uploadCustomParamsList");
  const template = document.getElementById("uploadParamRowTemplate");
  const clone = template.content.cloneNode(true);

  const keyInput = clone.querySelector(".upload-param-key");
  const valInput = clone.querySelector(".upload-param-value");
  const usageSelect = clone.querySelector(".upload-param-usage");
  const removeBtn = clone.querySelector(".btn-remove-upload-param");

  keyInput.value = key;
  valInput.value = value;
  usageSelect.value = usage;

  removeBtn.addEventListener("click", (e) => {
    e.target.closest(".upload-param-row").remove();
  });

  container.appendChild(clone);
}

// ==================== 模板管理功能 ====================

function loadTemplateOptions() {
  const select = document.getElementById("providerTemplate");
  if (!select) return;

  select.innerHTML = '<option value="">选择模板（可选）</option>';

  // 获取所有模板（内置 + 用户自定义）
  const allTemplates = getAllTemplates();

  allTemplates.forEach(template => {
    const option = document.createElement("option");
    option.value = template.id;
    const typeIcon = template.serviceType === "edit" ? "✏️" : "🎨";
    const builtinMark = template.builtin ? " (内置)" : "";
    option.textContent = `${typeIcon} ${template.name}${builtinMark}`;
    select.appendChild(option);
  });
}

function getAllTemplates() {
  // 获取用户自定义模板
  const settings = JSON.parse(localStorage.getItem('ai-drawer-settings') || '{}');
  const userTemplates = settings.providerTemplates || [];

  // 合并内置模板和用户模板
  return [...builtinTemplates, ...userTemplates];
}

function onTemplateChange() {
  const select = document.getElementById("providerTemplate");
  const templateId = select.value;

  if (!templateId) return;

  const allTemplates = getAllTemplates();
  const template = allTemplates.find(t => t.id === templateId);

  if (template) {
    applyTemplate(template);
  }
}

function applyTemplate(template) {
  // 填充基本信息
  document.getElementById("providerName").value = template.name;
  document.getElementById("providerEndpoint").value = template.endpoint || "";
  document.getElementById("providerResponsePath").value = template.responsePath || "";

  // 设置服务类型
  const serviceTypeRadio = document.querySelector(`input[name="serviceType"][value="${template.serviceType}"]`);
  if (serviceTypeRadio) {
    serviceTypeRadio.checked = true;
    // 触发change事件以更新UI
    serviceTypeRadio.dispatchEvent(new Event('change'));
  }

  // 设置multipart选项
  const useMultipartCheckbox = document.getElementById("providerUseMultipart");
  if (useMultipartCheckbox) {
    useMultipartCheckbox.checked = !!template.useMultipart;
    useMultipartCheckbox.dispatchEvent(new Event('change'));
  }

  // 设置图片字段名
  const imageFieldNameInput = document.getElementById("providerImageFieldName");
  if (imageFieldNameInput) {
    imageFieldNameInput.value = template.imageFieldName || "image";
  }

  // 清空现有参数和头部
  const containerParams = document.getElementById("customParamsList");
  const containerHeaders = document.getElementById("customHeadersList");
  if (containerParams) containerParams.innerHTML = "";
  if (containerHeaders) containerHeaders.innerHTML = "";

  // 添加自定义头部
  if (template.customHeaders) {
    Object.entries(template.customHeaders).forEach(([k, v]) => {
      addHeaderRow(k, v);
    });
  }

  // 添加自定义参数
  if (template.customParams) {
    Object.entries(template.customParams).forEach(([k, v]) => {
      let type = "string";
      let fieldType = "";
      let actualValue = v;

      // 检查是否是新格式（带fieldType的对象）
      if (v && typeof v === "object" && v.value !== undefined) {
        actualValue = v.value;
        fieldType = v.fieldType || "";
        // 重新判断类型
        if (actualValue === "__RANDOM__") {
          type = "random";
        } else if (Array.isArray(actualValue)) {
          type = "list";
        } else if (typeof actualValue === "object" && actualValue !== null) {
          type = "object";
        } else if (typeof actualValue === "number") {
          type = Number.isInteger(actualValue) ? "int" : "float";
        } else if (typeof actualValue === "boolean") {
          type = "bool";
        } else {
          type = "string";
        }
      } else {
        // 旧格式兼容
        if (v === "__RANDOM__") {
          type = "random";
        } else if (Array.isArray(v)) {
          type = "list";
        } else if (typeof v === "object" && v !== null) {
          type = "object";
        } else if (typeof v === "number") {
          type = Number.isInteger(v) ? "int" : "float";
        } else if (typeof v === "boolean") {
          type = "bool";
        }
      }

      addParameterRow(k, actualValue, type, fieldType);
    });
  }

  showStatus("已应用模板配置", "success");
}

function showTemplateModal() {
  const modal = document.getElementById("templateModal");
  if (modal) {
    modal.style.display = "flex";
    loadTemplatesList();
  }
}

function hideTemplateModal() {
  const modal = document.getElementById("templateModal");
  if (modal) {
    modal.style.display = "none";
    hideTemplateForm();
  }
}

function loadTemplatesList() {
  const container = document.getElementById("templatesList");
  if (!container) return;

  container.innerHTML = "";

  const allTemplates = getAllTemplates();

  if (allTemplates.length === 0) {
    container.innerHTML = '<p class="no-templates">暂无模板</p>';
    return;
  }

  allTemplates.forEach(template => {
    const item = createTemplateItem(template);
    container.appendChild(item);
  });
}

function createTemplateItem(template) {
  const templateEl = document.getElementById("templateItemTemplate");
  const item = templateEl.content.cloneNode(true);

  const nameEl = item.querySelector(".template-name");
  const typeEl = item.querySelector(".template-type-badge");
  const endpointEl = item.querySelector(".template-endpoint");
  const editBtn = item.querySelector(".btn-edit-template");
  const deleteBtn = item.querySelector(".btn-delete-template");

  nameEl.textContent = template.name;
  typeEl.textContent = template.serviceType === "edit" ? "✏️ 改图" : "🎨 生图";
  typeEl.className = `template-type-badge ${template.serviceType}`;
  endpointEl.textContent = template.endpoint || "";
  endpointEl.title = template.endpoint || "";

  // 内置模板不能删除，但可以编辑（编辑后保存为新模板）
  if (template.builtin) {
    deleteBtn.style.display = "none";
    editBtn.textContent = "✏️ 编辑";
    editBtn.title = "编辑并保存为新模板";
  }

  editBtn.addEventListener("click", () => {
    showTemplateForm(template);
  });

  deleteBtn.addEventListener("click", () => {
    if (confirm(`确定要删除模板"${template.name}"吗？`)) {
      deleteTemplate(template.id);
    }
  });

  return item;
}

function showTemplateForm(template = null) {
  const formSection = document.getElementById("templateFormSection");
  const title = document.getElementById("templateFormTitle");

  if (!formSection) return;

  // 如果是内置模板，创建副本进行编辑
  if (template && template.builtin) {
    const newTemplate = { ...template };
    delete newTemplate.id;
    delete newTemplate.builtin;
    newTemplate.name = template.name + " (自定义)";
    template = newTemplate;
    editingTemplateId = null; // 作为新模板保存
  } else {
    editingTemplateId = template ? template.id : null;
  }

  if (template) {
    title.textContent = template.builtin ? "基于内置模板创建" : "编辑模板";
    document.getElementById("templateName").value = template.name || "";
    document.getElementById("templateServiceType").value = template.serviceType || "generate";
    document.getElementById("templateEndpoint").value = template.endpoint || "";
    document.getElementById("templateResponsePath").value = template.responsePath || "";
    document.getElementById("templateUseMultipart").checked = !!template.useMultipart;
    document.getElementById("templateImageFieldName").value = template.imageFieldName || "image";

    // 清空现有参数和头部
    const containerParams = document.getElementById("templateParamsList");
    const containerHeaders = document.getElementById("templateHeadersList");
    if (containerParams) containerParams.innerHTML = "";
    if (containerHeaders) containerHeaders.innerHTML = "";

    // 加载自定义头部
    if (template.customHeaders) {
      Object.entries(template.customHeaders).forEach(([k, v]) => {
        addTemplateHeaderRow(k, v);
      });
    }

    // 加载自定义参数
    if (template.customParams) {
      Object.entries(template.customParams).forEach(([k, v]) => {
        let type = "string";
        let fieldType = "";
        let actualValue = v;

        // 检查是否是新格式（带fieldType的对象）
        if (v && typeof v === "object" && v.value !== undefined) {
          actualValue = v.value;
          fieldType = v.fieldType || "";
          // 重新判断类型
          if (actualValue === "__RANDOM__") {
            type = "random";
          } else if (Array.isArray(actualValue)) {
            type = "list";
          } else if (typeof actualValue === "object" && actualValue !== null) {
            type = "object";
          } else if (typeof actualValue === "number") {
            type = Number.isInteger(actualValue) ? "int" : "float";
          } else if (typeof actualValue === "boolean") {
            type = "bool";
          } else {
            type = "string";
          }
        } else {
          // 旧格式兼容
          if (v === "__RANDOM__") {
            type = "random";
          } else if (Array.isArray(v)) {
            type = "list";
          } else if (typeof v === "object" && v !== null) {
            type = "object";
          } else if (typeof v === "number") {
            type = Number.isInteger(v) ? "int" : "float";
          } else if (typeof v === "boolean") {
            type = "bool";
          }
        }

        addTemplateParameterRow(k, actualValue, type, fieldType);
      });
    }
  } else {
    title.textContent = "新增模板";
    clearTemplateForm();
  }

  formSection.style.display = "block";
  formSection.scrollIntoView({ behavior: "smooth" });
}

function hideTemplateForm() {
  const formSection = document.getElementById("templateFormSection");
  if (formSection) {
    formSection.style.display = "none";
  }
  editingTemplateId = null;
  clearTemplateForm();
}

function clearTemplateForm() {
  document.getElementById("templateName").value = "";
  document.getElementById("templateServiceType").value = "generate";
  document.getElementById("templateEndpoint").value = "";
  document.getElementById("templateResponsePath").value = "";
  document.getElementById("templateUseMultipart").checked = false;
  document.getElementById("templateImageFieldName").value = "image";

  // 清空参数和头部
  const containerParams = document.getElementById("templateParamsList");
  const containerHeaders = document.getElementById("templateHeadersList");
  if (containerParams) containerParams.innerHTML = "";
  if (containerHeaders) containerHeaders.innerHTML = "";
}

function saveTemplate() {
  const name = document.getElementById("templateName").value.trim();
  const serviceType = document.getElementById("templateServiceType").value;
  const endpoint = document.getElementById("templateEndpoint").value.trim();
  const responsePath = document.getElementById("templateResponsePath").value.trim();
  const useMultipart = document.getElementById("templateUseMultipart").checked;
  const imageFieldName = document.getElementById("templateImageFieldName").value.trim() || "image";

  if (!name || !endpoint) {
    showStatus("请输入模板名称和端点", "error");
    return;
  }

  // 收集自定义请求头
  const customHeaders = {};
  document.querySelectorAll("#templateHeadersList .header-row").forEach((row) => {
    const k = row.querySelector(".header-key").value.trim();
    const v = row.querySelector(".header-value").value.trim();
    if (k) customHeaders[k] = v;
  });

  // 收集自定义参数
  const customParams = {};
  document.querySelectorAll("#templateParamsList .param-row").forEach((row) => {
    const k = row.querySelector(".param-key").value.trim();
    const type = row.querySelector(".param-type").value;
    const valInput = row.querySelector(".param-value, .param-value-select");
    const v = valInput.value.trim();
    const fieldTypeSelect = row.querySelector(".param-field-type");
    const fieldType = fieldTypeSelect ? fieldTypeSelect.value : "";

    if (k) {
      try {
        let parsedValue;
        if (type === "int") parsedValue = parseInt(v, 10);
        else if (type === "float") parsedValue = parseFloat(v);
        else if (type === "bool") parsedValue = v === "true";
        else if (type === "random") parsedValue = "__RANDOM__";
        else if (type === "object" || type === "list") parsedValue = JSON.parse(v);
        else parsedValue = v;

        // 如果有字段类型，使用新格式
        if (fieldType) {
          customParams[k] = { value: parsedValue, fieldType: fieldType };
        } else {
          customParams[k] = parsedValue;
        }
      } catch (e) {
        console.warn(`模板参数 ${k} 转换失败:`, e);
        customParams[k] = fieldType ? { value: v, fieldType: fieldType } : v;
      }
    }
  });

  const settings = JSON.parse(localStorage.getItem('ai-drawer-settings') || '{}');
  let templates = settings.providerTemplates || [];

  const templateData = {
    name,
    serviceType,
    endpoint,
    responsePath,
    useMultipart,
    imageFieldName,
    customParams,
    customHeaders
  };

  if (editingTemplateId) {
    // 编辑现有模板
    templates = templates.map(t => t.id === editingTemplateId ? { ...t, ...templateData } : t);
  } else {
    // 新增模板
    templateData.id = "template-" + Date.now();
    templates.push(templateData);
  }

  settings.providerTemplates = templates;
  localStorage.setItem('ai-drawer-settings', JSON.stringify(settings));

  showStatus("模板保存成功", "success");
  hideTemplateForm();
  loadTemplatesList();
  loadTemplateOptions(); // 更新主表单的模板选项
}

function deleteTemplate(templateId) {
  const settings = JSON.parse(localStorage.getItem('ai-drawer-settings') || '{}');
  let templates = settings.providerTemplates || [];

  templates = templates.filter(t => t.id !== templateId);
  settings.providerTemplates = templates;
  localStorage.setItem('ai-drawer-settings', JSON.stringify(settings));

  showStatus("模板删除成功", "success");
  loadTemplatesList();
  loadTemplateOptions(); // 更新主表单的模板选项
}

// 模态框关闭事件
document.addEventListener('click', (e) => {
  const templateModal = document.getElementById('templateModal');
  if (e.target === templateModal) {
    hideTemplateModal();
  }

  // 关闭按钮
  if (e.target.classList.contains('close-btn') && e.target.closest('#templateModal')) {
    hideTemplateModal();
  }
});
// 模板参数管理
function addTemplateParameterRow(key = "", value = "", type = "string", fieldType = "") {
  const container = document.getElementById("templateParamsList");
  if (!container) return;

  const template = document.getElementById("paramRowTemplate");
  const row = template.content.cloneNode(true);

  const keyInput = row.querySelector(".param-key");
  const typeSelect = row.querySelector(".param-type");
  const valueInput = row.querySelector(".param-value");
  const fieldTypeSelect = row.querySelector(".param-field-type");
  const removeBtn = row.querySelector(".btn-remove-param");

  keyInput.value = key;
  typeSelect.value = type;

  // 对于random类型，显示空值和禁用状态
  if (type === "random") {
    valueInput.value = "";
    valueInput.placeholder = "将自动生成随机数";
    valueInput.disabled = true;
    valueInput.style.backgroundColor = "#f0f0f0";
  } else {
    valueInput.value = typeof value === "object" ? JSON.stringify(value) : String(value === "__RANDOM__" ? "" : value);
  }

  if (fieldTypeSelect) fieldTypeSelect.value = fieldType;

  // 添加类型变化监听器
  typeSelect.addEventListener("change", () => {
    const newType = typeSelect.value;
    if (newType === "random") {
      valueInput.value = "";
      valueInput.placeholder = "将自动生成随机数";
      valueInput.disabled = true;
      valueInput.style.backgroundColor = "#f0f0f0";
    } else {
      valueInput.disabled = false;
      valueInput.style.backgroundColor = "";
      valueInput.placeholder = "参数值";
    }
  });

  removeBtn.addEventListener("click", () => {
    row.querySelector(".param-row").remove();
  });

  container.appendChild(row);
}

function addTemplateHeaderRow(key = "", value = "") {
  const container = document.getElementById("templateHeadersList");
  if (!container) return;

  const template = document.getElementById("headerRowTemplate");
  const row = template.content.cloneNode(true);

  const keyInput = row.querySelector(".header-key");
  const valueInput = row.querySelector(".header-value");
  const removeBtn = row.querySelector(".btn-remove-header");

  keyInput.value = key;
  valueInput.value = value;

  removeBtn.addEventListener("click", () => {
    row.querySelector(".header-row").remove();
  });

  container.appendChild(row);
}

// ==================== 历史记录密码保护功能 ====================

/**
 * 使用 SHA-256 哈希密码
 * @param {string} password - 明文密码
 * @returns {Promise<string>} 密码的 SHA-256 哈希值（十六进制字符串）
 */
async function hashPassword(password) {
  if (!password) return "";
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 验证密码
 * @param {string} inputPassword - 用户输入的密码
 * @param {string} storedHash - 存储的哈希值
 * @returns {Promise<boolean>} 密码是否正确
 */
async function verifyPassword(inputPassword, storedHash) {
  if (!storedHash) return true; // 未设置密码时总是通过
  const inputHash = await hashPassword(inputPassword);
  return inputHash === storedHash;
}

/**
 * 更新密码状态UI
 * @param {string} passwordHash - 存储的密码哈希值
 */
function updatePasswordStatusUI(passwordHash) {
  const passwordStatus = document.getElementById("passwordStatus");
  const newPasswordForm = document.getElementById("newPasswordForm");
  const changePasswordForm = document.getElementById("changePasswordForm");

  if (passwordHash) {
    // 已设置密码
    if (passwordStatus) {
      passwordStatus.innerHTML = '<span class="status-indicator set">✅ 已设置密码</span>';
    }
    if (newPasswordForm) newPasswordForm.style.display = "none";
    if (changePasswordForm) changePasswordForm.style.display = "block";
  } else {
    // 未设置密码
    if (passwordStatus) {
      passwordStatus.innerHTML = '<span class="status-indicator not-set">❌ 未设置</span>';
    }
    if (newPasswordForm) newPasswordForm.style.display = "block";
    if (changePasswordForm) changePasswordForm.style.display = "none";
  }
}

/**
 * 设置新密码
 */
async function setPassword() {
  const password = document.getElementById("historyPassword").value;
  const confirmPassword = document.getElementById("historyPasswordConfirm").value;

  if (!password) {
    showPasswordMessage("请输入密码", "error");
    return;
  }

  if (password.length < 4) {
    showPasswordMessage("密码长度至少需要4位", "error");
    return;
  }

  if (password !== confirmPassword) {
    showPasswordMessage("两次输入的密码不一致", "error");
    return;
  }

  try {
    const passwordHash = await hashPassword(password);

    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: { ...response, historyPasswordHash: passwordHash },
    });

    // 清空输入框
    document.getElementById("historyPassword").value = "";
    document.getElementById("historyPasswordConfirm").value = "";

    // 更新UI
    updatePasswordStatusUI(passwordHash);

    showPasswordMessage("密码设置成功！", "success");
  } catch (error) {
    console.error("设置密码失败:", error);
    showPasswordMessage("设置密码失败: " + error.message, "error");
  }
}

/**
 * 修改密码
 */
async function changePassword() {
  const currentPassword = document.getElementById("currentPassword").value;
  const newPassword = document.getElementById("newHistoryPassword").value;
  const confirmPassword = document.getElementById("newHistoryPasswordConfirm").value;

  // 验证原密码
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const isCurrentPasswordCorrect = await verifyPassword(
    currentPassword,
    response.historyPasswordHash || "",
  );

  if (!isCurrentPasswordCorrect) {
    showPasswordMessage("原密码错误", "error");
    return;
  }

  // 如果新密码为空，则不修改密码
  if (!newPassword && !confirmPassword) {
    showPasswordMessage("密码未修改", "info");
    return;
  }

  if (newPassword && newPassword.length < 4) {
    showPasswordMessage("新密码长度至少需要4位", "error");
    return;
  }

  if (newPassword !== confirmPassword) {
    showPasswordMessage("两次输入的新密码不一致", "error");
    return;
  }

  try {
    const newHash = newPassword ? await hashPassword(newPassword) : "";

    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: { ...response, historyPasswordHash: newHash },
    });

    // 清空输入框
    document.getElementById("currentPassword").value = "";
    document.getElementById("newHistoryPassword").value = "";
    document.getElementById("newHistoryPasswordConfirm").value = "";

    // 更新UI
    updatePasswordStatusUI(newHash);

    showPasswordMessage(newHash ? "密码修改成功！" : "密码已清除！", "success");
  } catch (error) {
    console.error("修改密码失败:", error);
    showPasswordMessage("修改密码失败: " + error.message, "error");
  }
}

/**
 * 清除密码
 */
async function clearPassword() {
  if (!confirm("确定要清除密码保护吗？清除后任何人都可以访问历史记录。")) {
    return;
  }

  const currentPassword = document.getElementById("currentPassword").value;

  // 验证原密码
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const isCurrentPasswordCorrect = await verifyPassword(
    currentPassword,
    response.historyPasswordHash || "",
  );

  if (!isCurrentPasswordCorrect) {
    showPasswordMessage("原密码错误，无法清除密码", "error");
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: { ...response, historyPasswordHash: "" },
    });

    // 清空输入框
    document.getElementById("currentPassword").value = "";

    // 更新UI
    updatePasswordStatusUI("");

    showPasswordMessage("密码已清除！", "success");
  } catch (error) {
    console.error("清除密码失败:", error);
    showPasswordMessage("清除密码失败: " + error.message, "error");
  }
}

/**
 * 设置密码可见性切换
 */
function setupPasswordToggle() {
  const toggleButtons = document.querySelectorAll(".password-toggle");

  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.previousElementSibling;
      if (input.type === "password") {
        input.type = "text";
        btn.textContent = "🙈";
      } else {
        input.type = "password";
        btn.textContent = "👁️";
      }
    });
  });

  // 添加回车键支持
  const passwordInputs = document.querySelectorAll(
    "#historyPassword, #historyPasswordConfirm, #currentPassword, #newHistoryPassword, #newHistoryPasswordConfirm",
  );

  passwordInputs.forEach((input) => {
    input.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        // 根据可见的表单触发相应操作
        const newPasswordForm = document.getElementById("newPasswordForm");
        const changePasswordForm = document.getElementById("changePasswordForm");

        if (newPasswordForm && newPasswordForm.style.display !== "none") {
          setPassword();
        } else if (changePasswordForm && changePasswordForm.style.display !== "none") {
          changePassword();
        }
      }
    });
  });
}

/**
 * 显示密码操作消息
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型 (success, error, info)
 */
function showPasswordMessage(message, type = "info") {
  const el = document.getElementById("passwordMessage");
  if (!el) return;
  el.textContent = message;
  el.className = "password-message " + type;
  setTimeout(() => {
    el.textContent = "";
    el.className = "password-message";
  }, 3000);
}

// ==================== 图片存储迁移功能 ====================

/**
 * 初始化迁移管理功能
 */
async function initMigrationManager() {
  // 加载存储统计
  await loadStorageStats();
  
  // 加载迁移状态
  await loadMigrationStatus();
  
  // 绑定事件
  const startMigrationBtn = document.getElementById("startMigrationBtn");
  if (startMigrationBtn) {
    startMigrationBtn.addEventListener("click", startMigration);
  }
  
  const refreshStatsBtn = document.getElementById("refreshStatsBtn");
  if (refreshStatsBtn) {
    refreshStatsBtn.addEventListener("click", loadStorageStats);
  }
  
  const cleanupInvalidRefsBtn = document.getElementById("cleanupInvalidRefsBtn");
  if (cleanupInvalidRefsBtn) {
    cleanupInvalidRefsBtn.addEventListener("click", cleanupInvalidRefs);
  }
}

/**
 * 加载存储统计信息
 */
async function loadStorageStats() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getStorageStats" });
    
    if (response && response.success) {
      const stats = response.stats;
      
      // 更新UI - 使用正确的元素ID和属性名
      const poolSizeEl = document.getElementById("imagePoolSize");
      const historyCountEl = document.getElementById("historyCount");
      
      if (poolSizeEl) {
        const sizeMB = ((stats.totalSize || 0) / 1024 / 1024).toFixed(2);
        poolSizeEl.textContent = `${stats.totalImages || 0} 张 (${sizeMB} MB)`;
      }
      if (historyCountEl) {
        // 获取历史记录数量
        const historyResponse = await chrome.runtime.sendMessage({ action: "getHistory" });
        historyCountEl.textContent = historyResponse?.history?.length || 0;
      }
    }
  } catch (error) {
    console.error("加载存储统计失败:", error);
    showMigrationStatus("加载存储统计失败: " + error.message, "error");
  }
}

/**
 * 加载迁移状态
 */
async function loadMigrationStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getMigrationStatus" });
    
    if (response) {
      updateMigrationUI(response);
    }
  } catch (error) {
    console.error("加载迁移状态失败:", error);
  }
}

/**
 * 更新迁移UI状态
 * @param {Object} status - 迁移状态对象
 */
function updateMigrationUI(status) {
  const startBtn = document.getElementById("startMigrationBtn");
  const progressSection = document.getElementById("migrationProgress");
  const progressBar = document.getElementById("migrationProgressBar");
  const progressText = document.getElementById("migrationProgressText");
  const completeSection = document.getElementById("migrationComplete");
  const statusText = document.getElementById("migrationStatus");
  const statusItem = document.getElementById("migrationStatusItem");
  const requiredSection = document.getElementById("migrationRequired");
  
  // 检查是否需要迁移
  if (!status.required) {
    // 新用户或已迁移完成，隐藏所有迁移相关UI
    if (requiredSection) requiredSection.style.display = "none";
    if (progressSection) progressSection.style.display = "none";
    if (completeSection) completeSection.style.display = "none";
    if (statusItem) statusItem.style.display = "none";
    return;
  }
  
  // 根据迁移状态更新UI
  switch (status.status) {
    case "idle":
      // 未开始迁移
      if (requiredSection) requiredSection.style.display = "block";
      if (progressSection) progressSection.style.display = "none";
      if (completeSection) completeSection.style.display = "none";
      if (statusItem) statusItem.style.display = "block";
      if (startBtn) {
        startBtn.style.display = "inline-flex";
        startBtn.disabled = false;
      }
      if (statusText) statusText.textContent = `⚠️ 待迁移 (${status.pendingCount || "?"} 条)`;
      break;
      
    case "in_progress":
      // 迁移进行中
      if (requiredSection) requiredSection.style.display = "block";
      if (progressSection) progressSection.style.display = "block";
      if (completeSection) completeSection.style.display = "none";
      if (statusItem) statusItem.style.display = "block";
      if (startBtn) {
        startBtn.style.display = "inline-flex";
        startBtn.disabled = true;
        startBtn.textContent = "迁移中...";
      }
      
      // 更新进度条
      const percent = status.total > 0 ? Math.round((status.current / status.total) * 100) : 0;
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `${status.current || 0} / ${status.total || 0}`;
      if (statusText) statusText.textContent = `🔄 迁移中 (${percent}%)`;
      break;
      
    case "completed":
      // 迁移完成，隐藏所有迁移相关UI
      if (requiredSection) requiredSection.style.display = "none";
      if (progressSection) progressSection.style.display = "none";
      if (completeSection) completeSection.style.display = "none";
      if (statusItem) statusItem.style.display = "none";
      break;
      
    case "error":
      // 迁移出错
      if (requiredSection) requiredSection.style.display = "block";
      if (progressSection) progressSection.style.display = "none";
      if (completeSection) completeSection.style.display = "none";
      if (statusItem) statusItem.style.display = "block";
      if (startBtn) {
        startBtn.style.display = "inline-flex";
        startBtn.disabled = false;
        startBtn.textContent = "🚀 开始迁移";
      }
      if (statusText) statusText.textContent = `❌ 失败: ${status.error || "未知错误"}`;
      break;
  }
}

/**
 * 开始迁移
 */
async function startMigration() {
  const startBtn = document.getElementById("startMigrationBtn");
  const statusText = document.getElementById("migrationStatusText");
  
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = "正在启动迁移...";
  }
  
  if (statusText) statusText.textContent = "正在准备迁移...";
  
  try {
    // 发送迁移请求
    const response = await chrome.runtime.sendMessage({ action: "startMigration" });
    
    if (response && response.success) {
      showMigrationStatus("迁移已开始，请勿关闭此页面...", "info");
      
      // 开始轮询迁移状态
      pollMigrationStatus();
    } else {
      throw new Error(response?.error || "启动迁移失败");
    }
  } catch (error) {
    console.error("启动迁移失败:", error);
    showMigrationStatus("启动迁移失败: " + error.message, "error");
    
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = "开始迁移";
    }
  }
}

/**
 * 轮询迁移状态
 */
async function pollMigrationStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getMigrationStatus" });
    
    if (response) {
      updateMigrationUI(response);
      
      // 如果仍在进行中，继续轮询
      if (response.status === "in_progress") {
        setTimeout(pollMigrationStatus, 1000);
      } else if (response.status === "completed") {
        // 迁移完成，刷新统计
        await loadStorageStats();
        showMigrationStatus("迁移完成！", "success");
      } else if (response.status === "error") {
        showMigrationStatus("迁移失败: " + (response.error || "未知错误"), "error");
      }
    }
  } catch (error) {
    console.error("轮询迁移状态失败:", error);
  }
}

/**
 * 清理无效引用
 */
async function cleanupInvalidRefs() {
  const btn = document.getElementById("cleanupInvalidRefsBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "清理中...";
  }
  
  try {
    const response = await chrome.runtime.sendMessage({ action: "cleanupInvalidRefs" });
    
    if (response && response.success) {
      const removed = response.removed || 0;
      showMigrationStatus(`清理完成，移除了 ${removed} 个无效引用`, "success");
      await loadStorageStats();
    } else {
      throw new Error(response?.error || "清理失败");
    }
  } catch (error) {
    console.error("清理无效引用失败:", error);
    showMigrationStatus("清理失败: " + error.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🧹 清理无效引用";
    }
  }
}

/**
 * 显示迁移状态消息
 * @param {string} message - 消息内容
 * @param {string} type - 消息类型
 */
function showMigrationStatus(message, type = "info") {
  const el = document.getElementById("migrationStatusMessage");
  if (!el) return;
  el.textContent = message;
  el.className = "status " + type;
  // 不自动清除，让用户手动看到
}

// ==================== 图片分析服务商管理 ====================

function renderAnalyzeProvidersList(providers) {
  const container = document.getElementById("analyzeProvidersList");
  const noMessage = document.getElementById("noAnalyzeProvidersMessage");

  if (!providers || providers.length === 0) {
    if (container) container.style.display = "none";
    if (noMessage) noMessage.style.display = "block";
    return;
  }

  if (container) container.style.display = "grid";
  if (noMessage) noMessage.style.display = "none";

  if (container) {
    container.innerHTML = "";
    providers.forEach((provider) => {
      const item = createAnalyzeProviderItem(provider);
      container.appendChild(item);
    });
  }
}

function createAnalyzeProviderItem(provider) {
  const template = document.getElementById("providerItemTemplate");
  const clone = template.content.cloneNode(true);

  const div = clone.querySelector(".provider-item");
  div.dataset.id = provider.id;

  if (provider.id === currentAnalyzeProviderId) {
    div.classList.add("active");
    const badge = div.querySelector(".provider-status-badge");
    if (badge) badge.style.display = "block";
  }

  div.querySelector(".provider-name").textContent = provider.name;
  div.querySelector(".provider-endpoint").textContent = provider.model || "";
  div.querySelector(".provider-endpoint").title = provider.model || "";

  const btnEdit = div.querySelector(".btn-edit");
  if (btnEdit) {
    btnEdit.addEventListener("click", (e) => {
      e.stopPropagation();
      editAnalyzeProvider(provider.id);
    });
  }

  const btnDelete = div.querySelector(".btn-delete");
  if (btnDelete) {
    btnDelete.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteAnalyzeProvider(provider.id);
    });
  }

  // 隐藏测试按钮（分析服务商不需要测试按钮）
  const btnTest = div.querySelector(".btn-test");
  if (btnTest) btnTest.style.display = "none";
  // 隐藏复制按钮
  const btnCopy = div.querySelector(".btn-copy");
  if (btnCopy) btnCopy.style.display = "none";

  div.addEventListener("click", () => useAnalyzeProvider(provider.id));

  return clone;
}

function showAnalyzeProviderForm(provider = null) {
  clearAnalyzeProviderForm();

  const section = document.getElementById("analyzeProviderFormSection");
  const title = document.getElementById("analyzeFormTitle");
  if (!section) return;

  editingAnalyzeProviderId = provider ? provider.id : null;

  if (provider) {
    if (title) title.textContent = "编辑分析服务商";
    document.getElementById("analyzeProviderName").value = provider.name || "";
    document.getElementById("analyzeProviderUrl").value = (provider.url || "").replace(/\/v1\/chat\/completions$/, "").replace(/\/$/, "");
    document.getElementById("analyzeProviderApiKey").value = provider.apiKey || "";
    document.getElementById("analyzeProviderModel").value = provider.model || "";
    document.getElementById("analyzeProviderTemperature").value = provider.temperature ?? 0.7;
    document.getElementById("analyzeProviderMaxTokens").value = provider.maxTokens ?? 2000;
    document.getElementById("analyzeProviderTopP").value = provider.topP ?? "";
    document.getElementById("analyzeProviderPresencePenalty").value = provider.presencePenalty ?? "";
    document.getElementById("analyzeProviderFrequencyPenalty").value = provider.frequencyPenalty ?? "";
  } else {
    if (title) title.textContent = "添加分析服务商";
    clearAnalyzeProviderForm();
  }

  section.style.display = "block";
  section.scrollIntoView({ behavior: "smooth" });
}

function hideAnalyzeProviderForm() {
  const section = document.getElementById("analyzeProviderFormSection");
  if (section) section.style.display = "none";
  editingAnalyzeProviderId = null;
  clearAnalyzeProviderForm();
}

function clearAnalyzeProviderForm() {
  ["analyzeProviderName", "analyzeProviderUrl", "analyzeProviderApiKey", "analyzeProviderModel"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("analyzeProviderTemperature").value = "0.7";
  document.getElementById("analyzeProviderMaxTokens").value = "2000";
  document.getElementById("analyzeProviderTopP").value = "";
  document.getElementById("analyzeProviderPresencePenalty").value = "";
  document.getElementById("analyzeProviderFrequencyPenalty").value = "";

  // 折叠高级参数
  const params = document.getElementById("analyzeAdvancedParams");
  if (params) params.style.display = "none";
  const toggle = document.getElementById("analyzeAdvancedToggle");
  if (toggle) toggle.querySelector("span:first-child").textContent = "▶";
}

async function saveAnalyzeProvider() {
  const name = document.getElementById("analyzeProviderName").value.trim();
  let url = document.getElementById("analyzeProviderUrl").value.trim();
  const apiKey = document.getElementById("analyzeProviderApiKey").value.trim();
  const model = document.getElementById("analyzeProviderModel").value.trim();

  // 高级参数
  const temperature = parseFloat(document.getElementById("analyzeProviderTemperature").value);
  const maxTokens = parseInt(document.getElementById("analyzeProviderMaxTokens").value);
  const topP = document.getElementById("analyzeProviderTopP").value;
  const presencePenalty = document.getElementById("analyzeProviderPresencePenalty").value;
  const frequencyPenalty = document.getElementById("analyzeProviderFrequencyPenalty").value;

  if (!name || !url || !apiKey || !model) {
    showStatus("请填写所有必填项", "error");
    return;
  }

  // 自动补全路径
  if (!url.endsWith("/v1/chat/completions")) {
    url = url.replace(/\/$/, "") + "/v1/chat/completions";
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    let providers = response.analyzeProviders || [];

    const providerData = {
      name,
      url,
      apiKey,
      model,
      temperature: isNaN(temperature) ? 0.7 : temperature,
      maxTokens: isNaN(maxTokens) ? 2000 : maxTokens,
      topP: topP !== "" ? parseFloat(topP) : undefined,
      presencePenalty: presencePenalty !== "" ? parseFloat(presencePenalty) : undefined,
      frequencyPenalty: frequencyPenalty !== "" ? parseFloat(frequencyPenalty) : undefined,
    };

    if (editingAnalyzeProviderId) {
      providers = providers.map((p) =>
        p.id === editingAnalyzeProviderId ? { ...p, ...providerData } : p
      );
    } else {
      const newProvider = {
        id: generateId(),
        ...providerData,
        isCurrent: providers.length === 0,
      };
      providers.push(newProvider);
      if (newProvider.isCurrent) currentAnalyzeProviderId = newProvider.id;
    }

    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: { ...response, analyzeProviders: providers },
    });

    hideAnalyzeProviderForm();
    renderAnalyzeProvidersList(providers);
    showStatus("保存成功", "success");
  } catch (error) {
    showStatus("保存失败: " + error.message, "error");
  }
}

async function editAnalyzeProvider(id) {
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const provider = (response.analyzeProviders || []).find((p) => p.id === id);
  if (provider) showAnalyzeProviderForm(provider);
}

async function deleteAnalyzeProvider(id) {
  if (!confirm("确定要删除这个分析服务商吗？")) return;

  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  let providers = (response.analyzeProviders || []).filter((p) => p.id !== id);

  if (currentAnalyzeProviderId === id) {
    if (providers.length > 0) {
      providers[0].isCurrent = true;
      currentAnalyzeProviderId = providers[0].id;
    } else {
      currentAnalyzeProviderId = null;
    }
  }

  await chrome.runtime.sendMessage({
    action: "saveSettings",
    settings: { ...response, analyzeProviders: providers },
  });

  renderAnalyzeProvidersList(providers);
  showStatus("分析服务商已删除", "success");
}

async function useAnalyzeProvider(id) {
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  let providers = response.analyzeProviders || [];
  const provider = providers.find((p) => p.id === id);
  if (!provider) return;

  currentAnalyzeProviderId = id;
  providers = providers.map((p) => ({ ...p, isCurrent: p.id === id }));

  await chrome.runtime.sendMessage({
    action: "saveSettings",
    settings: { ...response, analyzeProviders: providers },
  });

  renderAnalyzeProvidersList(providers);
  showStatus("已选择 " + provider.name, "success");
}

/**
 * 获取分析服务商模型列表
 */
async function fetchAnalyzeModels() {
  let url = document.getElementById("analyzeProviderUrl").value.trim();
  const apiKey = document.getElementById("analyzeProviderApiKey").value.trim();

  if (!url || !apiKey) {
    showStatus("请先填写 API 地址和 API Key", "error");
    return;
  }

  // 自动补全路径
  if (!url.endsWith("/v1/chat/completions")) {
    url = url.replace(/\/$/, "") + "/v1/chat/completions";
  }

  const btn = document.getElementById("fetchAnalyzeModelsBtn");
  btn.disabled = true;
  btn.textContent = "⏳";

  try {
    const { fetchModels } = await import(chrome.runtime.getURL("lib/analyze.js"));
    const models = await fetchModels(url, apiKey);

    const input = document.getElementById("analyzeProviderModel");

    // 创建或更新 datalist
    let datalist = document.getElementById("analyzeModelList");
    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = "analyzeModelList";
      document.body.appendChild(datalist);
    }
    input.setAttribute("list", "analyzeModelList");

    datalist.innerHTML = models.map(m =>
      `<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)}${m.supportsVision ? " (支持视觉)" : ""}</option>`
    ).join("");

    showStatus(`已获取 ${models.length} 个模型`, "success");
  } catch (error) {
    showStatus("获取失败: " + error.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 获取";
  }
}

/**
 * 保存系统提示词
 */
async function saveAnalyzeSystemPrompt() {
  const systemPrompt = document.getElementById("analyzeSystemPrompt").value.trim();

  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: { ...response, analyzeSystemPrompt: systemPrompt },
    });
    showStatus("系统提示词已保存", "success");
  } catch (error) {
    showStatus("保存失败: " + error.message, "error");
  }
}

/**
 * 恢复默认系统提示词
 */
function resetAnalyzeSystemPrompt() {
  if (!confirm("确定要恢复默认的系统提示词吗？当前内容将被覆盖。")) return;

  // 动态导入获取默认提示词
  import(chrome.runtime.getURL("lib/analyze.js")).then(({ DEFAULT_ANALYZE_SYSTEM_PROMPT }) => {
    document.getElementById("analyzeSystemPrompt").value = DEFAULT_ANALYZE_SYSTEM_PROMPT;
    showStatus("已恢复默认提示词", "success");
  }).catch((error) => {
    showStatus("恢复失败: " + error.message, "error");
  });
}