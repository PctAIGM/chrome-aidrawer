// AI画图助手 - 弹窗脚本
import { formatErrorMessage, fileToBase64, showNotification } from './lib/common.js';
import { copyImageToClipboard, downloadImage } from './lib/image-utils.js';

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadSettings();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "imageGenerated") {
    currentImageUrl = request.imageUrl;
    showResult(document.getElementById("promptInput").value.trim());
    setLoading(false);
  } else if (request.action === "imageError") {
    showError(request.error || "生成失败");
    setLoading(false);
  }
});

let allowNSFW = false; // NSFW设置
let currentImageUrl = null;
let uploadedImageUrl = null; // 存储上传后的图片URL
// 多图模式：选中的附加图片（主图之外的第 2、3... 张），每项 { name, dataUrl }
let selectedMultiImages = [];

// 图片 URL 字段类型兼容旧配置中的 image 和 image_url 别名。
const IMAGE_URL_FIELD_TYPES = new Set(["image", "imageUrl", "image_url"]);

function isImageFieldType(fieldType) {
  return IMAGE_URL_FIELD_TYPES.has(fieldType);
}

function isImageArrayField(value) {
  return value
    && typeof value === "object"
    && value.type === "list"
    && isImageFieldType(value.fieldType);
}

async function loadSettings() {
  try {
    // 解析 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    let prefillPrompt = urlParams.get("prompt");
    const prefillNegativePrompt = urlParams.get("negativePrompt");
    const prefillProviderId = urlParams.get("providerId");
    const prefillOperationType = urlParams.get("operationType");

    if (!prefillPrompt) {
      const { pendingPrompt = "" } = await chrome.storage.local.get("pendingPrompt");
      if (pendingPrompt) {
        prefillPrompt = pendingPrompt;
        await chrome.storage.local.remove("pendingPrompt");
      }
    }
    
    // 如果有预填充参数，填入输入框
    if (prefillPrompt) {
      document.getElementById("promptInput").value = prefillPrompt;
    }
    if (prefillNegativePrompt) {
      const negativePromptInput = document.getElementById("negativePromptInput");
      if (negativePromptInput) {
        negativePromptInput.value = prefillNegativePrompt;
      }
    }
    
    const response = await chrome.runtime.sendMessage({
      action: "getSettings",
    });
    const providers = response.providers || [];

    // 加载NSFW设置
    allowNSFW = !!response.allowNSFW;

    const select = document.getElementById("provider");
    select.innerHTML = "";

    if (providers.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "请先在设置中添加服务商";
      select.appendChild(option);
      document.getElementById("generateBtn").disabled = true;
      return;
    }

    providers.forEach((p) => {
      const option = document.createElement("option");
      option.value = p.id;
      option.dataset.serviceType = p.serviceType || "generate";
      const typeIcon = p.serviceType === "edit" ? "✏️" : "🎨";
      option.textContent = `${typeIcon} ${p.name}`;
      // 优先选择 URL 参数中指定的服务商
      if (prefillProviderId && p.id === prefillProviderId) {
        option.selected = true;
      } else if (!prefillProviderId && p.isCurrent) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    // 监听服务商变化
    select.addEventListener("change", onProviderChange);

    // 初始化时检查当前选中的服务商
    onProviderChange();
  } catch (error) {
    console.error("加载设置失败:", error);
  }
}

function onProviderChange() {
  const select = document.getElementById("provider");
  const selectedOption = select.options[select.selectedIndex];
  const serviceType = selectedOption?.dataset.serviceType || "generate";

  const imageUrlGroup = document.getElementById("imageUrlGroup");
  const generateBtn = document.getElementById("generateBtn");
  const btnText = generateBtn.querySelector(".btn-text");
  const historyTab = document.getElementById("historyTab");

  if (serviceType === "edit") {
    imageUrlGroup.style.display = "block";
    btnText.textContent = "开始改图";

    // 检查是否有上传服务，决定是否显示上传选项卡
    checkUploadServiceAvailability();
  } else {
    imageUrlGroup.style.display = "none";
    btnText.textContent = "生成图片";

    // 隐藏历史记录选项卡
    historyTab.style.display = "none";

    // 重置图片相关状态
    resetImageState();
  }

  // 检查是否配置了反向提示词
  checkNegativePromptAvailability();

  // 加载高级参数
  loadAdvancedParams();
}

async function checkNegativePromptAvailability() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const select = document.getElementById("provider");
    const providerId = select.value;
    const providers = response.providers || [];
    const currentProvider = providers.find(p => p.id === providerId);

    const negativePromptGroup = document.getElementById("negativePromptGroup");
    const negativePromptInput = document.getElementById("negativePromptInput");

    let hasNegativePrompt = false;
    let defaultValue = "";

    if (currentProvider && currentProvider.customParams) {
      for (const [key, value] of Object.entries(currentProvider.customParams)) {
        if (value && typeof value === "object" && (value.fieldType === "negativePrompt" || value.fieldType === "negative_prompt")) {
          hasNegativePrompt = true;
          defaultValue = value.value || "";
          break;
        }
      }
    }

    if (hasNegativePrompt) {
      negativePromptGroup.style.display = "block";
      // 只有在输入框为空，或者切换了服务商时才填充默认值
      // 为了简单起见，这里直接填充默认值
      negativePromptInput.value = defaultValue;
    } else {
      negativePromptGroup.style.display = "none";
      negativePromptInput.value = "";
    }
  } catch (error) {
    console.error("检查反向提示词配置失败:", error);
  }
}

// 加载高级参数
async function loadAdvancedParams() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const select = document.getElementById("provider");
    const providerId = select.value;
    const providers = response.providers || [];
    const currentProvider = providers.find(p => p.id === providerId);

    const paramsList = document.getElementById("advancedParamsList");
    paramsList.innerHTML = "";

    if (!currentProvider || !currentProvider.customParams) {
      paramsList.innerHTML = '<div class="no-advanced-params">当前服务商无可配置的高级参数</div>';
      return;
    }

    // 过滤掉特殊字段类型（prompt, imageUrl, imageBase64, negativePrompt）
    const editableParams = [];
    for (const [key, value] of Object.entries(currentProvider.customParams)) {
      // 检查是否是特殊字段类型
      if (value && typeof value === "object" && value.fieldType) {
        if (isImageFieldType(value.fieldType) || ["prompt", "imageBase64", "negativePrompt", "images"].includes(value.fieldType)) {
          continue;
        }
      }
      editableParams.push({ key, value });
    }

    if (editableParams.length === 0) {
      paramsList.innerHTML = '<div class="no-advanced-params">当前服务商无可配置的高级参数</div>';
      return;
    }

    // 渲染参数控件
    editableParams.forEach(({ key, value }) => {
      const item = createAdvancedParamItem(key, value);
      paramsList.appendChild(item);
    });
  } catch (error) {
    console.error("加载高级参数失败:", error);
  }
}

// 创建高级参数控件
function createAdvancedParamItem(key, value) {
  const div = document.createElement("div");
  div.className = "advanced-param-item";

  // 解析值
  let actualValue = value;
  let fieldType = "";
  if (value && typeof value === "object" && value.value !== undefined) {
    actualValue = value.value;
    fieldType = value.fieldType || "";
  }

  const label = document.createElement("label");
  label.textContent = key;
  label.title = key;
  div.appendChild(label);

  // 根据类型创建不同的输入控件
  if (actualValue === "__RANDOM__") {
    // 随机数类型：显示只读提示
    const input = document.createElement("input");
    input.type = "text";
    input.value = "随机生成";
    input.disabled = true;
    input.dataset.paramKey = key;
    input.dataset.paramType = "random";
    input.style.backgroundColor = "#f0f0f0";
    div.appendChild(input);
  } else if (typeof actualValue === "boolean") {
    // 布尔类型：复选框
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = actualValue;
    checkbox.dataset.paramKey = key;
    checkbox.dataset.paramType = "bool";
    div.appendChild(checkbox);
  } else if (typeof actualValue === "number") {
    // 数字类型
    const input = document.createElement("input");
    input.type = "number";
    input.value = actualValue;
    input.step = Number.isInteger(actualValue) ? "1" : "any";
    input.dataset.paramKey = key;
    input.dataset.paramType = Number.isInteger(actualValue) ? "int" : "float";
    div.appendChild(input);
  } else if (Array.isArray(actualValue)) {
    // 数组类型：JSON字符串
    const input = document.createElement("input");
    input.type = "text";
    input.value = JSON.stringify(actualValue);
    input.dataset.paramKey = key;
    input.dataset.paramType = "array";
    div.appendChild(input);
  } else if (typeof actualValue === "object" && actualValue !== null) {
    // 对象类型：JSON字符串
    const input = document.createElement("input");
    input.type = "text";
    input.value = JSON.stringify(actualValue);
    input.dataset.paramKey = key;
    input.dataset.paramType = "object";
    div.appendChild(input);
  } else {
    // 字符串或其他类型
    const input = document.createElement("input");
    input.type = "text";
    input.value = String(actualValue || "");
    input.dataset.paramKey = key;
    input.dataset.paramType = "string";
    div.appendChild(input);
  }

  return div;
}

// 切换高级参数显示/隐藏
function toggleAdvancedParams() {
  const btn = document.getElementById("toggleAdvancedParamsBtn");
  const content = document.getElementById("advancedParamsContent");

  if (content.style.display === "none") {
    content.style.display = "block";
    btn.classList.add("expanded");
  } else {
    content.style.display = "none";
    btn.classList.remove("expanded");
  }
}

// 收集高级参数
function collectAdvancedParams() {
  const params = {};
  const inputs = document.querySelectorAll("#advancedParamsList input, #advancedParamsList select");

  inputs.forEach((input) => {
    const key = input.dataset.paramKey;
    const type = input.dataset.paramType;

    if (!key) return;

    if (type === "random") {
      params[key] = "__RANDOM__";
    } else if (type === "bool") {
      params[key] = input.checked;
    } else if (type === "int") {
      params[key] = parseInt(input.value, 10);
    } else if (type === "float") {
      params[key] = parseFloat(input.value);
    } else if (type === "array" || type === "object") {
      try {
        params[key] = JSON.parse(input.value);
      } catch (e) {
        params[key] = input.value;
      }
    } else {
      params[key] = input.value;
    }
  });

  return params;
}

async function checkUploadServiceAvailability() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const uploadServices = response.imageUploadServices || [];
    const hasActiveUploadService = uploadServices.some(service => service.isActive);

    // 获取当前选择的服务商配置
    const select = document.getElementById("provider");
    const providerId = select.value;
    const providers = response.providers || [];
    const currentProvider = providers.find(p => p.id === providerId);
    const useMultipart = currentProvider?.useMultipart;
    
    // 检查是否配置了imageBase64字段类型
    const hasImageBase64Field = currentProvider?.customParams &&
      Object.values(currentProvider.customParams).some(
        v => v && typeof v === 'object' && v.fieldType === 'imageBase64'
      );

    // 检查是否配置了多图字段类型（type === 'list' 且 fieldType 为图片）
    const hasImagesField = currentProvider?.customParams &&
      Object.values(currentProvider.customParams).some(isImageArrayField);

    const uploadTab = document.getElementById("uploadTab");
    const historyTab = document.getElementById("historyTab");
    const uploadImageBtn = document.getElementById("uploadImageBtn");
    const uploadHistoryImageBtn = document.getElementById("uploadHistoryImageBtn");

    // 多图模式：显示"添加图片URL"按钮
    const addExtraUrlBtn = document.getElementById("addExtraUrlBtn");
    if (addExtraUrlBtn) {
      addExtraUrlBtn.style.display = hasImagesField ? "block" : "none";
      // 离开多图模式时清空附加URL
      if (!hasImagesField) clearExtraUrlList();
    }

    // 多图模式：主图缩略图显示序号①，与附加图②③对齐
    const mainImageBadge = document.getElementById("mainImageBadge");
    if (mainImageBadge) {
      mainImageBadge.style.display = hasImagesField ? "block" : "none";
    }

    // 历史记录选项卡始终显示（在改图模式下）
    historyTab.style.display = "block";

    if (useMultipart || hasImageBase64Field) {
      // multipart接口或imageBase64字段：总是显示上传选项卡，不需要图床
      uploadTab.style.display = "block";
      if (uploadImageBtn) {
        uploadImageBtn.style.display = "none"; // 隐藏上传到图床按钮
      }
      if (uploadHistoryImageBtn) {
        uploadHistoryImageBtn.style.display = "none"; // 隐藏历史记录的上传到图床按钮
      }
    } else if (hasActiveUploadService) {
      // 非multipart接口且无imageBase64字段：需要图床服务
      uploadTab.style.display = "block";
      if (uploadImageBtn) {
        uploadImageBtn.style.display = "block"; // 显示上传到图床按钮
      }
      if (uploadHistoryImageBtn) {
        uploadHistoryImageBtn.style.display = "block"; // 显示历史记录的上传到图床按钮
      }
    } else {
      // 没有图床服务且不是multipart且无imageBase64字段
      uploadTab.style.display = "none";
      // 如果没有上传服务，强制切换到URL输入模式
      switchToUrlTab();
    }
  } catch (error) {
    console.error("检查上传服务失败:", error);
    document.getElementById("uploadTab").style.display = "none";
    switchToUrlTab();
  }
}

function setupEventListeners() {
  document
    .getElementById("generateBtn")
    .addEventListener("click", generateImage);
  document.getElementById("copyBtn").addEventListener("click", copyImage);
  document
    .getElementById("downloadBtn")
    .addEventListener("click", downloadImageWrapper);
  document.getElementById("newBtn").addEventListener("click", resetToInput);
  document.getElementById("retryBtn").addEventListener("click", resetToInput);

  document.getElementById("promptInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      generateImage();
    }
  });

  // 图片来源选项卡切换
  document.getElementById("urlTab").addEventListener("click", switchToUrlTab);
  document.getElementById("uploadTab").addEventListener("click", switchToUploadTab);
  document.getElementById("historyTab").addEventListener("click", switchToHistoryTab);

  // 历史记录密码验证
  document.getElementById("historyPasswordSubmitBtn").addEventListener("click", verifyHistoryPassword);
  document.getElementById("historyPasswordInput").addEventListener("keyup", (e) => {
    if (e.key === "Enter") {
      verifyHistoryPassword();
    }
  });

  // 历史记录图片上传相关事件
  document.getElementById("uploadHistoryImageBtn").addEventListener("click", uploadHistoryImage);
  document.getElementById("removeHistoryImageBtn").addEventListener("click", removeSelectedHistoryImage);

  // 图片上传相关事件
  document.getElementById("selectImageBtn").addEventListener("click", () => {
    document.getElementById("imageFileInput").click();
  });

  document.getElementById("imageFileInput").addEventListener("change", handleFileSelect);
  document.getElementById("uploadImageBtn").addEventListener("click", uploadImage);
  document.getElementById("removeImageBtn").addEventListener("click", removeSelectedImage);

  // 多图URL模式：添加附加图片URL
  document.getElementById("addExtraUrlBtn").addEventListener("click", () => addExtraUrlRow());

  // 提示词切换按钮
  document.getElementById("togglePromptBtn").addEventListener("click", togglePrompt);

  // 高级参数展开/折叠按钮
  document.getElementById("toggleAdvancedParamsBtn").addEventListener("click", toggleAdvancedParams);
}

async function generateImage() {
  const prompt = document.getElementById("promptInput").value.trim();
  const providerId = document.getElementById("provider").value;
  const select = document.getElementById("provider");
  const selectedOption = select.options[select.selectedIndex];
  const serviceType = selectedOption?.dataset.serviceType || "generate";

  if (!prompt) {
    showError("请输入图片描述");
    return;
  }

  if (!providerId) {
    showError("请先选择一个服务商");
    return;
  }

  // 如果是改图服务商，检查图片
  let imageUrl = null;
  let imageFile = null;
  if (serviceType === "edit") {
    // 获取当前服务商配置，检查是否使用multipart
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const providers = response.providers || [];
    const currentProvider = providers.find(p => p.id === providerId);
    const useMultipart = currentProvider?.useMultipart;
    
    // 检查是否配置了imageBase64字段类型
    const hasImageBase64Field = currentProvider?.customParams &&
      Object.values(currentProvider.customParams).some(
        v => v && typeof v === 'object' && v.fieldType === 'imageBase64'
      );

    // 检查是否配置了多图字段类型（type === 'list' 且 fieldType 为图片）
    const hasImagesField = currentProvider?.customParams &&
      Object.values(currentProvider.customParams).some(isImageArrayField);
    const isMultiImageMode = !!hasImagesField;

    // 检查当前活动的选项卡
    const urlTab = document.getElementById("urlTab");
    const uploadTab = document.getElementById("uploadTab");
    const historyTab = document.getElementById("historyTab");
    
    const isUrlMode = urlTab.classList.contains("active");
    const isUploadMode = uploadTab.classList.contains("active");
    const isHistoryMode = historyTab.classList.contains("active");

    console.log("改图模式 - URL模式:", isUrlMode, "上传模式:", isUploadMode, "历史记录模式:", isHistoryMode, "使用multipart:", useMultipart, "imageBase64字段:", hasImageBase64Field);

    if (isUrlMode) {
      imageUrl = document.getElementById("imageUrlInput").value.trim();
      if (!imageUrl) {
        showError("请输入要编辑的图片URL");
        return;
      }
      console.log("使用URL模式，图片URL:", imageUrl);
    } else if (isHistoryMode) {
      // 历史记录模式
      if (!selectedHistoryImageUrl) {
        showError("请从历史记录中选择一张图片");
        return;
      }
      
      if (useMultipart || hasImageBase64Field) {
        // multipart模式或imageBase64字段：使用base64数据
        if (selectedHistoryImageData) {
          // 直接使用base64数据
          imageFile = { 
            name: "history-image.png",
            type: "image/png",
            dataUrl: selectedHistoryImageData 
          };
          console.log("使用历史记录图片(base64)，multipart或imageBase64模式");
        } else if (selectedHistoryImageUrl.startsWith("data:")) {
          imageFile = { 
            name: "history-image.png",
            type: "image/png",
            dataUrl: selectedHistoryImageUrl 
          };
          console.log("使用历史记录图片(base64 URL)，multipart或imageBase64模式");
        } else if (hasImageBase64Field) {
          // imageBase64模式但图片是URL，需要下载转换（后续在background中处理）
          imageUrl = selectedHistoryImageUrl;
          console.log("使用历史记录图片(URL)，imageBase64模式将在后台转换");
        } else {
          showError("历史记录图片格式不支持multipart模式");
          return;
        }
      } else {
        // 非multipart模式且无imageBase64字段：需要URL
        if (uploadedHistoryImageUrl) {
          // 已上传到图床
          imageUrl = uploadedHistoryImageUrl;
          console.log("使用历史记录图片(已上传)，URL:", imageUrl);
        } else if (selectedHistoryImageUrl.startsWith("http")) {
          // 已经是HTTP URL
          imageUrl = selectedHistoryImageUrl;
          console.log("使用历史记录图片(HTTP URL):", imageUrl);
        } else {
          showError("请先点击'上传到图床'按钮上传历史记录图片");
          return;
        }
      }
    } else {
      // 上传模式
      const fileInput = document.getElementById("imageFileInput");

      if (useMultipart && fileInput.files.length > 0) {
        // multipart接口：直接使用本地文件
        imageFile = fileInput.files[0];
        console.log("使用multipart模式，直接使用本地文件:", imageFile.name);
      } else if (hasImageBase64Field && fileInput.files.length > 0) {
        // imageBase64字段：直接使用本地文件（转换为base64）
        imageFile = fileInput.files[0];
        console.log("使用imageBase64模式，直接使用本地文件:", imageFile.name);
      } else if (!useMultipart && !hasImageBase64Field && uploadedImageUrl) {
        // 非multipart接口且无imageBase64字段：使用上传后的URL
        imageUrl = uploadedImageUrl;
        console.log("使用非multipart模式，图片URL:", imageUrl);
      } else {
        // 错误情况
        if (useMultipart || hasImageBase64Field) {
          showError("请先选择图片文件");
        } else {
          if (fileInput.files.length > 0) {
            showError("请先点击'上传到图床'按钮上传选择的图片");
          } else {
            showError("请先选择并上传图片");
          }
        }
        return;
      }
    }
  }

  setLoading(true);

  try {
    // 首先在后台设置为当前使用的服务商
    await chrome.runtime.sendMessage({ action: "useProvider", id: providerId });

    // 获取反向提示词
    const negativePromptInput = document.getElementById("negativePromptInput");
    const negativePrompt = negativePromptInput && negativePromptInput.offsetParent !== null ? negativePromptInput.value.trim() : "";

    // 收集高级参数
    const advancedParams = collectAdvancedParams();

    // 多图模式：汇总所有图片（主图 + 附加图）为 URI/dataUrl 数组
    let imagesData = null;
    // 重新读取当前 provider 是否多图、当前 tab 是否 URL 模式（上方 edit 块内的变量作用域不通）
    const _urlTabActive = document.getElementById("urlTab")?.classList.contains("active");
    let _multiProvider = false;
    {
      const _resp = await chrome.runtime.sendMessage({ action: "getSettings" });
      const _prov = (_resp.providers || []).find(p => p.id === providerId);
      _multiProvider = !!(_prov?.customParams &&
        Object.values(_prov.customParams).some(isImageArrayField));
    }
    if (serviceType === "edit" && _multiProvider) {
      imagesData = [];
      // 主图
      if (imageFile) {
        if (imageFile.dataUrl) {
          imagesData.push(imageFile.dataUrl);
        } else {
          imagesData.push(await fileToBase64(imageFile));
        }
      } else if (imageUrl) {
        imagesData.push(imageUrl);
      }
      // 附加图（优先使用已上传的远程 URL，避免发送大段 base64）
      for (const img of selectedMultiImages) {
        if (img.uploadedUrl) imagesData.push(img.uploadedUrl);
        else if (img.dataUrl) imagesData.push(img.dataUrl);
      }
      // URL 模式下的附加URL
      if (_urlTabActive) {
        for (const u of getExtraUrls()) {
          imagesData.push(u);
        }
      }
      if (imagesData.length === 0) imagesData = null;
    }

    // 发送生成/改图消息
    if (serviceType === "edit") {
      if (imageFile) {
        // 对于multipart接口，发送文件数据
        let base64;
        if (imageFile.dataUrl) {
          // 历史记录图片，直接使用dataUrl
          base64 = imageFile.dataUrl;
        } else {
          // 上传的文件，需要转换
          base64 = await fileToBase64(imageFile);
        }
        await chrome.runtime.sendMessage({
          action: "editImage",
          prompt: prompt,
          negativePrompt: negativePrompt,
          imageData: base64,
          fileName: imageFile.name,
          providerId: providerId,
          useLocalFile: true,
          advancedParams: advancedParams,
          imagesData: imagesData,
        });
      } else {
        // 对于非multipart接口，发送URL
        await chrome.runtime.sendMessage({
          action: "editImage",
          prompt: prompt,
          negativePrompt: negativePrompt,
          imageUrl: imageUrl,
          providerId: providerId,
          advancedParams: advancedParams,
          imagesData: imagesData,
        });
      }
    } else {
      await chrome.runtime.sendMessage({
        action: "generateImage",
        prompt: prompt,
        negativePrompt: negativePrompt,
        advancedParams: advancedParams,
      });
    }

    // 生成成功后，后台会发送 imageGenerated 消息
    // 但为了这里的流程，我们可以稍等一下检查历史记录或者等待消息
  } catch (error) {
    console.error("生成失败:", error);
    showError(formatErrorMessage(error) || "生成失败，请重试");
    setLoading(false);
  }
}

async function showResult(prompt) {
  document.getElementById("inputSection").style.display = "none";
  document.getElementById("errorSection").style.display = "none";
  document.getElementById("resultSection").style.display = "block";

  const resultImg = document.getElementById("resultImg");
  resultImg.src = currentImageUrl;

  document.getElementById("resultPrompt").textContent = prompt;

  // 重新获取NSFW设置，确保是最新的
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    allowNSFW = !!response.allowNSFW;
  } catch (error) {
    console.error("获取NSFW设置失败:", error);
  }

  // 处理NSFW遮罩
  const resultImageContainer = document.querySelector(".result-image");
  const existingOverlay = resultImageContainer.querySelector(".nsfw-overlay");

  if (!allowNSFW) {
    // 添加模糊效果和遮罩
    resultImageContainer.classList.add("nsfw-blur");
    resultImageContainer.classList.remove("nsfw-reveal");

    // 移除现有遮罩（如果存在）
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // 创建新的遮罩
    const overlay = document.createElement("div");
    overlay.className = "nsfw-overlay";
    overlay.innerHTML = '<span class="nsfw-icon">🔞</span><span>点击查看</span>';

    // 添加点击事件
    overlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resultImageContainer.classList.add("nsfw-reveal");
    });

    // 添加鼠标悬停事件
    overlay.addEventListener("mouseenter", () => {
      overlay.style.background = "rgba(0, 0, 0, 0.8)";
    });

    overlay.addEventListener("mouseleave", () => {
      overlay.style.background = "rgba(0, 0, 0, 0.7)";
    });

    // 添加到容器
    resultImageContainer.appendChild(overlay);

  } else {
    // 移除模糊效果和遮罩
    resultImageContainer.classList.remove("nsfw-blur", "nsfw-reveal");
    if (existingOverlay) {
      existingOverlay.remove();
    }
  }

  // 检查是否有上传服务，显示上传按钮
  checkAndShowUploadButton();
}

function showError(message) {
  document.getElementById("inputSection").style.display = "none";
  document.getElementById("resultSection").style.display = "none";
  document.getElementById("errorSection").style.display = "block";
  document.getElementById("errorText").textContent = message;
}

function resetToInput() {
  document.getElementById("resultSection").style.display = "none";
  document.getElementById("errorSection").style.display = "none";
  document.getElementById("inputSection").style.display = "block";

  currentImageUrl = null;
}

// 图片来源选项卡切换
function switchToUploadTab() {
  const urlTab = document.getElementById("urlTab");
  const uploadTab = document.getElementById("uploadTab");
  const historyTab = document.getElementById("historyTab");
  
  urlTab.classList.remove("active");
  uploadTab.classList.add("active");
  historyTab.classList.remove("active");
  
  document.getElementById("urlSection").style.display = "none";
  document.getElementById("uploadSection").style.display = "block";
  document.getElementById("historySection").style.display = "none";
  
  console.log("切换到上传模式，当前上传状态:", !!uploadedImageUrl);
}

// 切换到URL选项卡
function switchToUrlTab() {
  const urlTab = document.getElementById("urlTab");
  const uploadTab = document.getElementById("uploadTab");
  const historyTab = document.getElementById("historyTab");
  
  urlTab.classList.add("active");
  uploadTab.classList.remove("active");
  historyTab.classList.remove("active");
  
  document.getElementById("urlSection").style.display = "block";
  document.getElementById("uploadSection").style.display = "none";
  document.getElementById("historySection").style.display = "none";
  
  console.log("切换到URL模式");
}

// 文件选择处理（支持多选：第一张为主图，其余追加为附加图）
function handleFileSelect(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  const imageFiles = files.filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) {
    showUploadStatus('请选择图片文件', 'error');
    return;
  }

  const file = imageFiles[0];

  // 显示主图预览
  const reader = new FileReader();
  reader.onload = (e) => {
    const previewImg = document.getElementById("previewImg");
    const imagePreview = document.getElementById("imagePreview");
    const uploadImageBtn = document.getElementById("uploadImageBtn");

    previewImg.src = e.target.result;
    imagePreview.style.display = "block";
    uploadImageBtn.style.display = "block";

    // 清除之前的上传状态，但保留提示用户需要重新上传
    hideUploadStatus();
    // 只有当选择了新文件时才清空uploadedImageUrl
    // 这样可以避免用户重复选择同一文件时丢失上传状态
    const currentFileName = file.name;
    const lastFileName = uploadImageBtn.dataset.lastFileName;

    if (currentFileName !== lastFileName) {
      uploadedImageUrl = null;
      uploadImageBtn.dataset.lastFileName = currentFileName;
      console.log("选择了新文件:", currentFileName, "清除之前的上传状态");
    } else {
      console.log("选择了相同文件:", currentFileName, "保持上传状态:", !!uploadedImageUrl);
    }
  };
  reader.readAsDataURL(file);

  // 多选时，第 2 张及以后追加为附加图
  const extraFiles = imageFiles.slice(1);
  if (extraFiles.length > 0) {
    let loaded = 0;
    extraFiles.forEach((f, idx) => {
      const r = new FileReader();
      r.onload = (e) => {
        selectedMultiImages.push({ name: f.name, dataUrl: e.target.result });
        loaded++;
        if (loaded === extraFiles.length) renderMultiImagePreview();
      };
      r.readAsDataURL(f);
    });
  }
}

// 渲染多图附加预览网格
function renderMultiImagePreview() {
  const container = document.getElementById("multiImagePreview");
  if (!container) return;
  container.innerHTML = "";
  if (selectedMultiImages.length === 0) {
    container.style.display = "none";
    return;
  }
  // 每张附加图一块：缩略图（全宽）+ 下方全宽 URL 行，纵向堆叠
  container.style.display = "flex";
  selectedMultiImages.forEach((img, index) => {
    const item = document.createElement("div");
    item.className = "multi-image-item";

    // 缩略图区
    const thumb = document.createElement("div");
    thumb.className = "multi-image-thumb";
    const im = document.createElement("img");
    im.src = img.dataUrl;
    im.alt = "附加图";
    const badge = document.createElement("span");
    badge.className = "multi-image-badge";
    badge.textContent = String(index + 2);
    // 已上传到图床时，给序号徽标加个"已上传"标记
    if (img.uploadedUrl) {
      badge.classList.add("uploaded");
      badge.title = "已上传到图床";
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "multi-image-remove";
    btn.innerHTML = "&times;";
    btn.title = "移除";
    btn.addEventListener("click", () => {
      selectedMultiImages.splice(index, 1);
      renderMultiImagePreview();
    });
    thumb.appendChild(im);
    thumb.appendChild(badge);
    thumb.appendChild(btn);
    item.appendChild(thumb);

    // 已上传时，缩略图下方显示全宽 URL（带复制按钮）
    if (img.uploadedUrl) {
      const urlRow = document.createElement("div");
      urlRow.className = "multi-url-row";
      const urlInput = document.createElement("input");
      urlInput.type = "text";
      urlInput.value = img.uploadedUrl;
      urlInput.readOnly = true;
      urlInput.title = img.uploadedUrl;
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "multi-url-copy";
      copyBtn.textContent = "复制";
      copyBtn.title = "复制此图链接";
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(img.uploadedUrl);
          const orig = copyBtn.textContent;
          copyBtn.textContent = "✅";
          setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        } catch (e) {
          copyBtn.textContent = "❌";
          setTimeout(() => { copyBtn.textContent = "复制"; }, 1500);
        }
      });
      urlRow.appendChild(urlInput);
      urlRow.appendChild(copyBtn);
      item.appendChild(urlRow);
    }

    container.appendChild(item);
  });
}

// ==================== 多图 URL 模式 ====================
let extraUrlSeq = 0;

// 添加一个附加图片URL输入框
function addExtraUrlRow(url = "") {
  const list = document.getElementById("extraUrlList");
  if (!list) return;
  list.style.display = "block";
  const seq = ++extraUrlSeq;
  const row = document.createElement("div");
  row.className = "extra-url-row";
  row.dataset.seq = String(seq);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "extra-url-input";
  input.placeholder = "输入附加图片URL...";
  input.value = url;
  const badge = document.createElement("span");
  badge.className = "extra-url-badge";
  badge.textContent = String(list.children.length + 2);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "extra-url-remove";
  btn.innerHTML = "&times;";
  btn.title = "移除";
  btn.addEventListener("click", () => {
    row.remove();
    refreshExtraUrlBadges();
    if (list.children.length === 0) {
      list.style.display = "none";
    }
  });
  row.appendChild(badge);
  row.appendChild(input);
  row.appendChild(btn);
  list.appendChild(row);
}

// 重新编号附加URL的序号
function refreshExtraUrlBadges() {
  const list = document.getElementById("extraUrlList");
  if (!list) return;
  list.querySelectorAll(".extra-url-row").forEach((row, idx) => {
    const badge = row.querySelector(".extra-url-badge");
    if (badge) badge.textContent = String(idx + 2);
  });
}

// 清空所有附加URL
function clearExtraUrlList() {
  const list = document.getElementById("extraUrlList");
  if (list) {
    list.innerHTML = "";
    list.style.display = "none";
  }
}

// 获取所有附加URL（去重、去空）
function getExtraUrls() {
  const list = document.getElementById("extraUrlList");
  if (!list) return [];
  const urls = [];
  list.querySelectorAll(".extra-url-input").forEach((input) => {
    const v = input.value.trim();
    if (v) urls.push(v);
  });
  return urls;
}

// 上传图片到图床（支持多图批量上传）
async function uploadImage() {
  const fileInput = document.getElementById("imageFileInput");
  const file = fileInput.files[0];

  if (!file) {
    showUploadStatus('请先选择图片', 'error');
    return;
  }

  const hasExtra = selectedMultiImages.length > 0;
  const uploadBtn = document.getElementById("uploadImageBtn");
  const originalText = uploadBtn.textContent;

  uploadBtn.disabled = true;
  uploadBtn.textContent = hasExtra ? `上传中... (1/${selectedMultiImages.length + 1})` : '上传中...';
  hideUploadStatus();

  // 单个图片上传辅助函数
  const uploadOne = async (imageData, fileName) => {
    const result = await chrome.runtime.sendMessage({
      action: 'uploadImage',
      imageData: imageData,
      fileName: fileName
    });
    if (!result.success) {
      throw new Error(formatErrorMessage(result.error || '上传失败'));
    }
    return result.imageUrl;
  };

  try {
    // 上传主图
    const base64 = await fileToBase64(file);
    uploadedImageUrl = await uploadOne(base64, file.name);
    console.log("主图上传成功，URL:", uploadedImageUrl);

    // 上传附加图（如果有）
    if (hasExtra) {
      for (let i = 0; i < selectedMultiImages.length; i++) {
        uploadBtn.textContent = `上传中... (${i + 2}/${selectedMultiImages.length + 1})`;
        const img = selectedMultiImages[i];
        const url = await uploadOne(img.dataUrl, img.name);
        selectedMultiImages[i].uploadedUrl = url;
        console.log(`附加图 ${i + 2} 上传成功，URL:`, url);
      }
      renderMultiImagePreview();
    }

    // 更新按钮状态，显示已上传
    uploadBtn.textContent = '✅ 已上传';
    uploadBtn.style.background = '#48bb78';
    uploadBtn.style.color = 'white';

    // 显示图片URL和复制按钮
    const total = hasExtra ? selectedMultiImages.length + 1 : 1;
    showUploadStatus(hasExtra ? `${total} 张图片上传成功！可以开始改图了` : '图片上传成功！可以开始改图了', 'success');
    showImageUrl(uploadedImageUrl);
  } catch (error) {
    const errorMsg = formatErrorMessage(error);
    console.error("图片上传失败:", error);
    console.error("格式化后的错误信息:", errorMsg);
    showUploadStatus(errorMsg, 'error');
    uploadedImageUrl = null;
  } finally {
    uploadBtn.disabled = false;
    // 只有在上传失败时才重置按钮文本
    if (!uploadedImageUrl) {
      uploadBtn.textContent = originalText;
      uploadBtn.style.background = '';
      uploadBtn.style.color = '';
    }
  }
}

// 移除选择的图片
// 显示图片URL和复制按钮
function showImageUrl(imageUrl) {
  // 移除已有的URL显示区域
  const existingUrlDiv = document.getElementById("imageUrlDisplay");
  if (existingUrlDiv) {
    existingUrlDiv.remove();
  }

  // 创建URL显示区域
  const urlDiv = document.createElement("div");
  urlDiv.id = "imageUrlDisplay";
  urlDiv.style.cssText = `
    margin-top: 12px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 8px; font-size: 13px; word-break: break-all;
  `;

  urlDiv.innerHTML = `
    <div style="color: #4a5568; margin-bottom: 8px; font-weight: 500;">图片链接：</div>
    <div style="display: flex; gap: 8px; align-items: center;">
      <input type="text" id="imageUrlDisplayInput" value="${imageUrl}" readonly style="
        flex: 1; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px;
        background: white; font-size: 12px; color: #374151;
      ">
      <button id="copyUrlBtn" style="
        padding: 6px 12px; background: #667eea; color: white; border: none;
        border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap;
      ">复制</button>
    </div>
  `;

  // 插入到主图预览下方（与附加图 URL 行“缩略图在上、URL 在下”的布局保持一致）
  const imagePreview = document.getElementById("imagePreview");
  if (imagePreview && imagePreview.parentNode) {
    imagePreview.parentNode.insertBefore(urlDiv, imagePreview.nextSibling);
  } else {
    // 兜底：主图预览不存在时，插入到上传状态下方
    const uploadStatus = document.getElementById("uploadStatus");
    if (uploadStatus && uploadStatus.parentNode) {
      uploadStatus.parentNode.insertBefore(urlDiv, uploadStatus.nextSibling);
    }
  }

  // 绑定复制按钮事件
  const copyBtn = document.getElementById("copyUrlBtn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const urlInput = document.getElementById("imageUrlDisplayInput");
      const originalText = copyBtn.textContent;

      try {
        await navigator.clipboard.writeText(imageUrl);
        copyBtn.textContent = "✅ 已复制";
        copyBtn.style.background = "#48bb78";

        // 选中输入框文本
        urlInput.select();

        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.background = "#667eea";
        }, 2000);
      } catch (error) {
        console.error("复制失败:", error);
        copyBtn.textContent = "❌ 失败";
        copyBtn.style.background = "#f56565";

        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.background = "#667eea";
        }, 2000);
      }
    };
  }
}

// 隐藏图片URL显示
function hideImageUrl() {
  const urlDiv = document.getElementById("imageUrlDisplay");
  if (urlDiv) {
    urlDiv.remove();
  }
}

function removeSelectedImage() {
  const imagePreview = document.getElementById("imagePreview");
  const uploadImageBtn = document.getElementById("uploadImageBtn");
  const fileInput = document.getElementById("imageFileInput");

  imagePreview.style.display = "none";
  uploadImageBtn.style.display = "none";
  fileInput.value = "";
  uploadedImageUrl = null;
  selectedMultiImages = [];
  renderMultiImagePreview();

  // 重置上传按钮状态
  uploadImageBtn.textContent = "📤 上传到图床";
  uploadImageBtn.style.background = '';
  uploadImageBtn.style.color = '';
  uploadImageBtn.dataset.lastFileName = '';

  hideUploadStatus();
  hideImageUrl();
  console.log("已移除选择的图片，重置上传状态");
}

// 重置图片相关状态
function resetImageState() {
  uploadedImageUrl = null;
  selectedMultiImages = [];
  renderMultiImagePreview();
  clearExtraUrlList();
  selectedHistoryImageUrl = null;
  selectedHistoryPrompt = "";
  selectedHistoryImageData = null;
  uploadedHistoryImageUrl = null;
  removeSelectedImage();
  removeSelectedHistoryImage();
  document.getElementById("imageUrlInput").value = "";
  switchToUrlTab();
}

// 显示上传状态
function showUploadStatus(message, type = 'info') {
  const uploadStatus = document.getElementById("uploadStatus");
  uploadStatus.textContent = message;
  uploadStatus.className = `upload-status ${type}`;
  uploadStatus.style.display = 'block';
}

// 隐藏上传状态
function hideUploadStatus() {
  const uploadStatus = document.getElementById("uploadStatus");
  uploadStatus.style.display = 'none';
}

async function copyImage() {
  try {
    await copyImageToClipboard(currentImageUrl);
    showNotification("图片已复制到剪贴板");
  } catch (error) {
    console.error("复制失败:", error);
    showNotification(formatErrorMessage(error) || "复制失败，请重试", "error");
  }
}

function downloadImageWrapper() {
  downloadImage(currentImageUrl, `ai-generated-${Date.now()}.png`);
}

function setLoading(loading) {
  const generateBtn = document.getElementById("generateBtn");
  const btnText = generateBtn.querySelector(".btn-text");
  const btnLoading = generateBtn.querySelector(".btn-loading");

  generateBtn.disabled = loading;

  if (loading) {
    btnText.style.display = "none";
    btnLoading.style.display = "inline";
  } else {
    btnText.style.display = "inline";
    btnLoading.style.display = "none";
  }
}

// 切换提示词显示/隐藏
function togglePrompt() {
  const promptElement = document.getElementById("resultPrompt");
  const toggleBtn = document.getElementById("togglePromptBtn");

  if (promptElement.style.display === "none") {
    promptElement.style.display = "block";
    toggleBtn.textContent = "隐藏提示词";
  } else {
    promptElement.style.display = "none";
    toggleBtn.textContent = "显示提示词";
  }
}

// 检查并显示上传按钮
async function checkAndShowUploadButton() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const uploadServices = response.imageUploadServices || [];
    const hasActiveUploadService = uploadServices.some(service => service.isActive);

    const uploadBtn = document.getElementById("uploadToAlbumBtn");
    if (hasActiveUploadService && currentImageUrl) {
      if (uploadBtn) {
        uploadBtn.style.display = "inline-flex";
        uploadBtn.onclick = () => uploadCurrentImageToAlbum();
      }
    } else {
      if (uploadBtn) {
        uploadBtn.style.display = "none";
      }
    }
  } catch (error) {
    console.error("检查上传服务失败:", error);
  }
}

// 上传当前图片到相册
async function uploadCurrentImageToAlbum() {
  if (!currentImageUrl) {
    showNotification("没有可上传的图片", "error");
    return;
  }

  const uploadBtn = document.getElementById("uploadToAlbumBtn");
  const originalText = uploadBtn.textContent;

  uploadBtn.disabled = true;
  uploadBtn.textContent = "上传中...";

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'uploadImageToAlbum',
      imageUrl: currentImageUrl,
      prompt: document.getElementById("resultPrompt").textContent
    });

    if (result.success) {
      showNotification("图片已上传到相册！", "success");
    } else {
      const errorMsg = formatErrorMessage(result.error || '上传失败');
      throw new Error(errorMsg);
    }
  } catch (error) {
    const errorMsg = formatErrorMessage(error);
    console.error('上传到相册失败:', error);
    console.error('格式化后的错误信息:', errorMsg);
    showNotification(errorMsg, "error");
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = originalText;
  }
}

// 切换到历史记录选项卡
async function switchToHistoryTab() {
    const urlTab = document.getElementById("urlTab");
    const uploadTab = document.getElementById("uploadTab");
    const historyTab = document.getElementById("historyTab");
    
    urlTab.classList.remove("active");
    uploadTab.classList.remove("active");
    historyTab.classList.add("active");
    
    document.getElementById("urlSection").style.display = "none";
    document.getElementById("uploadSection").style.display = "none";
    document.getElementById("historySection").style.display = "block";
    
    // 检查密码保护并显示密码提示或加载历史记录
    await checkPasswordProtectionAndLoad();
    
    console.log("切换到历史记录模式");
}

// 检查密码保护并加载历史记录
async function checkPasswordProtectionAndLoad() {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const passwordHash = response.historyPasswordHash || "";
    
    const passwordPrompt = document.getElementById("historyPasswordPrompt");
    const historyImageList = document.getElementById("historyImageList");
    const historyLoading = document.getElementById("historyLoading");
    const historyEmpty = document.getElementById("historyEmpty");
    
    if (passwordHash) {
        // 需要密码验证
        passwordPrompt.style.display = "block";
        historyImageList.style.display = "none";
        historyLoading.style.display = "none";
        historyEmpty.style.display = "none";
    } else {
        // 无需密码，直接加载历史记录
        passwordPrompt.style.display = "none";
        await loadHistoryImages();
    }
}

// 验证历史记录密码
async function verifyHistoryPassword() {
    const passwordInput = document.getElementById("historyPasswordInput");
    const passwordError = document.getElementById("historyPasswordError");
    const password = passwordInput.value.trim();
    
    if (!password) {
        passwordError.textContent = "请输入密码";
        passwordError.style.display = "block";
        return;
    }
    
    try {
        // 使用 SHA-256 哈希验证密码
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const inputHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        
        const response = await chrome.runtime.sendMessage({ action: "getSettings" });
        const storedHash = response.historyPasswordHash || "";
        
        if (inputHash === storedHash) {
            // 密码正确，隐藏密码提示并加载历史记录
            passwordError.style.display = "none";
            passwordInput.value = "";
            document.getElementById("historyPasswordPrompt").style.display = "none";
            await loadHistoryImages();
        } else {
            passwordError.textContent = "密码错误";
            passwordError.style.display = "block";
            passwordInput.value = "";
            passwordInput.focus();
        }
    } catch (error) {
        console.error("密码验证失败:", error);
        passwordError.textContent = "验证失败: " + error.message;
        passwordError.style.display = "block";
    }
}

// 加载历史记录图片
async function loadHistoryImages() {
    const historyImageList = document.getElementById("historyImageList");
    const historyLoading = document.getElementById("historyLoading");
    const historyEmpty = document.getElementById("historyEmpty");
    
    historyLoading.style.display = "flex";
    historyImageList.innerHTML = "";
    historyEmpty.style.display = "none";
    
    try {
        const response = await chrome.runtime.sendMessage({ action: "getHistory" });
        const historyData = response.history || [];
        
        historyLoading.style.display = "none";
        
        if (historyData.length === 0) {
            historyEmpty.style.display = "block";
            return;
        }
        
        // 渲染历史记录图片（只显示最近的20条）
        const recentHistory = historyData.slice(0, 20);
        
        for (const item of recentHistory) {
            const div = document.createElement("div");
            div.className = "history-item";
            
            // 获取图片URL
            const imageUrl = item.imageMd5 || item.imageUrl;
            if (!imageUrl) continue;
            
            div.dataset.url = imageUrl;
            div.dataset.prompt = item.prompt || "";
            div.dataset.imageData = ""; // 将存储base64数据
            
            const img = document.createElement("img");
            img.className = "history-thumb";
            img.loading = "lazy";
            
            // 处理不同格式的图片URL
            if (imageUrl.startsWith("data:")) {
                // base64格式
                img.src = imageUrl;
                div.dataset.imageData = imageUrl;
            } else if (imageUrl.startsWith("http")) {
                // HTTP URL格式
                img.src = imageUrl;
            } else {
                // MD5格式，需要从图片池获取
                try {
                    const res = await chrome.runtime.sendMessage({
                        action: "getImageByMd5",
                        md5: imageUrl
                    });
                    if (res?.success && res?.imageUrl) {
                        img.src = res.imageUrl;
                        // 如果返回的是base64，存储它
                        if (res.imageUrl.startsWith("data:")) {
                            div.dataset.imageData = res.imageUrl;
                        }
                    }
                } catch (e) {
                    console.error("获取图片失败:", e);
                }
            }
            
            // 处理图片加载错误
            img.onerror = () => {
                div.style.display = "none";
            };
            
            // 点击选择历史记录图片
            div.addEventListener("click", () => {
                selectHistoryImage(
                    div.dataset.url, 
                    div.dataset.prompt, 
                    div.dataset.imageData || null
                );
            });
            
            div.appendChild(img);
            historyImageList.appendChild(div);
        }
        
        historyImageList.style.display = "grid";
        
    } catch (error) {
        console.error("加载历史记录失败:", error);
        historyLoading.style.display = "none";
        historyEmpty.style.display = "block";
    }
}

// 选择历史记录图片
let selectedHistoryImageUrl = null;
let selectedHistoryPrompt = "";
let selectedHistoryImageData = null; // 存储base64数据（用于multipart）
let uploadedHistoryImageUrl = null; // 存储上传后的URL（用于非multipart）

function selectHistoryImage(imageUrl, prompt, imageData) {
    selectedHistoryImageUrl = imageUrl;
    selectedHistoryPrompt = prompt;
    selectedHistoryImageData = imageData || null;
    uploadedHistoryImageUrl = null; // 重置上传状态
    
    console.log("选中历史记录图片:", imageUrl, "是否有base64数据:", !!imageData);
    
    // 更新UI显示已选择
    const items = document.querySelectorAll(".history-item");
    items.forEach(item => {
        item.classList.remove("selected");
        if (item.dataset.url === imageUrl) {
            item.classList.add("selected");
        }
    });
    
    // 如果提示词为空，使用历史记录的提示词
    const promptInput = document.getElementById("promptInput");
    if (promptInput && !promptInput.value.trim() && prompt) {
        promptInput.value = prompt;
    }
    
    // 检查是否需要上传到图床
    checkHistoryImageUploadNeeded();
}

// 检查历史记录图片是否需要上传到图床
async function checkHistoryImageUploadNeeded() {
    const historyUploadArea = document.getElementById("historyUploadArea");
    const historySelectedPreview = document.getElementById("historySelectedPreview");
    const historySelectedImg = document.getElementById("historySelectedImg");
    const uploadHistoryImageBtn = document.getElementById("uploadHistoryImageBtn");
    
    if (!selectedHistoryImageUrl) {
        historyUploadArea.style.display = "none";
        return;
    }
    
    // 获取当前提供商配置
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const select = document.getElementById("provider");
    const providerId = select.value;
    const providers = response.providers || [];
    const currentProvider = providers.find(p => p.id === providerId);
    const useMultipart = currentProvider?.useMultipart;
    
    // 检查图片URL类型
    const isHttpUrl = selectedHistoryImageUrl.startsWith("http://") || selectedHistoryImageUrl.startsWith("https://");
    const isDataUrl = selectedHistoryImageUrl.startsWith("data:");
    
    // 显示预览
    historySelectedImg.src = isDataUrl ? selectedHistoryImageUrl : 
                             (isHttpUrl ? selectedHistoryImageUrl : selectedHistoryImageData || selectedHistoryImageUrl);
    historySelectedPreview.style.display = "block";
    historyUploadArea.style.display = "block";
    
    if (useMultipart) {
        // multipart模式：不需要上传，直接使用
        uploadHistoryImageBtn.style.display = "none";
        showHistoryUploadStatus("multipart接口可直接使用，无需上传", "info");
    } else if (isHttpUrl) {
        // 已经是HTTP URL，可以直接使用
        uploadHistoryImageBtn.style.display = "none";
        showHistoryUploadStatus("图片URL可直接使用", "success");
        uploadedHistoryImageUrl = selectedHistoryImageUrl;
    } else {
        // base64或MD5格式，需要上传到图床
        uploadHistoryImageBtn.style.display = "block";
        showHistoryUploadStatus("需要上传到图床获取URL", "info");
    }
}

// 显示历史记录上传状态
function showHistoryUploadStatus(message, type = "info") {
    const status = document.getElementById("historyUploadStatus");
    status.textContent = message;
    status.className = `upload-status ${type}`;
    status.style.display = "block";
}

// 隐藏历史记录上传状态
function hideHistoryUploadStatus() {
    const status = document.getElementById("historyUploadStatus");
    status.style.display = "none";
}

// 上传历史记录图片到图床
async function uploadHistoryImage() {
    if (!selectedHistoryImageData && !selectedHistoryImageUrl.startsWith("data:")) {
        showHistoryUploadStatus("没有可上传的图片数据", "error");
        return;
    }
    
    const uploadBtn = document.getElementById("uploadHistoryImageBtn");
    const originalText = uploadBtn.textContent;
    
    uploadBtn.disabled = true;
    uploadBtn.textContent = "上传中...";
    
    try {
        const imageData = selectedHistoryImageData || selectedHistoryImageUrl;
        
        const result = await chrome.runtime.sendMessage({
            action: "uploadImage",
            imageData: imageData,
            fileName: "history-image.png"
        });
        
        if (result.success) {
            uploadedHistoryImageUrl = result.imageUrl;
            console.log("历史记录图片上传成功，URL:", uploadedHistoryImageUrl);
            
            uploadBtn.textContent = "✅ 已上传";
            uploadBtn.style.background = "#48bb78";
            uploadBtn.style.color = "white";
            
            showHistoryUploadStatus("上传成功！可以开始改图了", "success");
        } else {
            throw new Error(result.error || "上传失败");
        }
    } catch (error) {
        console.error("上传历史记录图片失败:", error);
        showHistoryUploadStatus("上传失败: " + formatErrorMessage(error), "error");
        uploadBtn.textContent = originalText;
        uploadBtn.disabled = false;
    }
}

// 移除选择的历史记录图片
function removeSelectedHistoryImage() {
    selectedHistoryImageUrl = null;
    selectedHistoryPrompt = "";
    selectedHistoryImageData = null;
    uploadedHistoryImageUrl = null;
    
    // 更新UI
    const items = document.querySelectorAll(".history-item");
    items.forEach(item => item.classList.remove("selected"));
    
    const historyUploadArea = document.getElementById("historyUploadArea");
    const historySelectedPreview = document.getElementById("historySelectedPreview");
    const uploadHistoryImageBtn = document.getElementById("uploadHistoryImageBtn");
    
    historyUploadArea.style.display = "none";
    historySelectedPreview.style.display = "none";
    hideHistoryUploadStatus();
    
    // 重置上传按钮
    uploadHistoryImageBtn.textContent = "📤 上传到图床";
    uploadHistoryImageBtn.style.background = "";
    uploadHistoryImageBtn.style.color = "";
    uploadHistoryImageBtn.disabled = false;
}







