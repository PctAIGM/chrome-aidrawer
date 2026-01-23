// AI画图助手 - 设置页面脚本

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  setupEventListeners();
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

  // 图片上传服务配置回显
  const uploadServices = settings.imageUploadServices || [];
  if (uploadServices.length > 0) {
    const activeService = uploadServices.find((s) => s.isActive);
    if (activeService) currentUploadServiceId = activeService.id;
  }
  renderUploadServicesList(uploadServices);

  renderProvidersList(settings.providers || []);

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

    await chrome.runtime.sendMessage({
      action: "saveSettings",
      settings: { ...response, providers },
    });
    hideProviderForm();
    renderProvidersList(providers);
    if (currentProviderId) {
      // const active = providers.find(p => p.id === currentProviderId);
      // if (active) updateCurrentDisplay(active); // Removed
    }
    showStatus("保存成功", "success");
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
    },
  });

  showStatus("所有设置已保存！", "success");

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
      data = await encryptData(JSON.stringify(exportSettings, null, 2), securityKey);
      showStatus("配置已加密导出", "success");
    } else {
      // 无安全密钥：移除敏感信息后明文导出
      const exportSettings = { ...settings };
      delete exportSettings.securityKey;
      delete exportSettings.webdavPassword;
      data = JSON.stringify(exportSettings, null, 2);
      showStatus("配置已导出（未加密）", "info");
    }

    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-drawer-config-${new Date().toISOString().slice(0, 10)}.json`;
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

      // 简单校验
      if (!Array.isArray(settings.providers)) {
        throw new Error("配置文件缺少 providers 列表");
      }

      // 弹出预览确认框
      showConfigPreviewModal(settings, async () => {
        try {
          // 补全默认值
          const newSettings = { ...defaultSettings, ...settings };

          await chrome.runtime.sendMessage({
            action: "saveSettings",
            settings: newSettings,
          });

          showStatus("配置已导入，正在刷新...", "success");
          setTimeout(() => {
            loadSettings(); // 重新加载设置
          }, 1000);
        } catch (error) {
          console.error("导入保存失败:", error);
          showStatus("导入保存失败: " + error.message, "error");
        }
      });

    } catch (error) {
      console.error("导入失败:", error);
      showStatus("导入失败: " + error.message, "error");
    }
  };
  reader.readAsText(file);
  event.target.value = ""; // 重置 input
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
    if (securityKey) {
      // 有安全密钥：只移除 securityKey（不加密存储），其他全部保留
      const exportSettings = { ...settings };
      delete exportSettings.securityKey;
      data = await encryptData(JSON.stringify(exportSettings, null, 2), securityKey);
    } else {
      // 无安全密钥：移除敏感信息后明文导出
      const exportSettings = { ...settings };
      delete exportSettings.securityKey;
      delete exportSettings.webdavPassword;
      data = JSON.stringify(exportSettings, null, 2);
    }

    const result = await chrome.runtime.sendMessage({
      action: "webdavUpload",
      config: config,
      data: data,
    });

    if (result.success) {
      showWebDAVStatus("✅ 配置已上传到 WebDAV", "success");
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

      // 弹出预览确认框
      showConfigPreviewModal(settings, async () => {
        try {
          // 补全默认值
          const newSettings = { ...defaultSettings, ...settings };

          await chrome.runtime.sendMessage({
            action: "saveSettings",
            settings: newSettings,
          });

          showWebDAVStatus("✅ 配置已从 WebDAV 下载并导入", "success");
          setTimeout(() => {
            loadSettings(); // 重新加载设置
          }, 1000);
        } catch (error) {
          showWebDAVStatus("❌ 导入失败: " + error.message, "error");
        }
      });

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