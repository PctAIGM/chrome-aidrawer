// AI画图助手 - 弹窗脚本

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadSettings();
});

let currentImageUrl = null;
let uploadedImageUrl = null; // 存储上传后的图片URL

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getSettings",
    });
    const providers = response.providers || [];

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
      if (p.isCurrent) option.selected = true;
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

  if (serviceType === "edit") {
    imageUrlGroup.style.display = "block";
    btnText.textContent = "开始改图";
    
    // 检查是否有上传服务，决定是否显示上传选项卡
    checkUploadServiceAvailability();
  } else {
    imageUrlGroup.style.display = "none";
    btnText.textContent = "生成图片";
    
    // 重置图片相关状态
    resetImageState();
  }
}

async function checkUploadServiceAvailability() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const uploadServices = response.imageUploadServices || [];
    const hasActiveUploadService = uploadServices.some(service => service.isActive);
    
    const uploadTab = document.getElementById("uploadTab");
    if (hasActiveUploadService) {
      uploadTab.style.display = "block";
    } else {
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
    .addEventListener("click", downloadImage);
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

  // 图片上传相关事件
  document.getElementById("selectImageBtn").addEventListener("click", () => {
    document.getElementById("imageFileInput").click();
  });
  
  document.getElementById("imageFileInput").addEventListener("change", handleFileSelect);
  document.getElementById("uploadImageBtn").addEventListener("click", uploadImage);
  document.getElementById("removeImageBtn").addEventListener("click", removeSelectedImage);
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
  if (serviceType === "edit") {
    const urlTab = document.getElementById("urlTab");
    const isUrlMode = urlTab.classList.contains("active");
    
    console.log("改图模式 - URL模式:", isUrlMode, "上传的图片URL:", uploadedImageUrl);
    
    if (isUrlMode) {
      imageUrl = document.getElementById("imageUrlInput").value.trim();
      if (!imageUrl) {
        showError("请输入要编辑的图片URL");
        return;
      }
      console.log("使用URL模式，图片URL:", imageUrl);
    } else {
      // 上传模式
      if (!uploadedImageUrl) {
        // 检查是否选择了文件但还没上传
        const fileInput = document.getElementById("imageFileInput");
        if (fileInput.files.length > 0) {
          showError("请先点击'上传到图床'按钮上传选择的图片");
        } else {
          showError("请先选择并上传图片");
        }
        return;
      }
      imageUrl = uploadedImageUrl;
      console.log("使用上传模式，图片URL:", imageUrl);
    }
  }

  setLoading(true);

  try {
    // 首先在后台设置为当前使用的服务商
    await chrome.runtime.sendMessage({ action: "useProvider", id: providerId });

    // 发送生成/改图消息
    if (serviceType === "edit") {
      await chrome.runtime.sendMessage({
        action: "editImage",
        prompt: prompt,
        imageUrl: imageUrl,
        providerId: providerId,
      });
    } else {
      await chrome.runtime.sendMessage({
        action: "generateImage",
        prompt: prompt,
      });
    }

    // 生成成功后，后台会发送 imageGenerated 消息
    // 但为了这里的流程，我们可以稍等一下检查历史记录或者等待消息
  } catch (error) {
    console.error("生成失败:", error);
    showError(error.message || "生成失败，请重试");
    setLoading(false);
  }
}

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

function showResult(prompt) {
  document.getElementById("inputSection").style.display = "none";
  document.getElementById("errorSection").style.display = "none";
  document.getElementById("resultSection").style.display = "block";

  const resultImg = document.getElementById("resultImg");
  resultImg.src = currentImageUrl;

  document.getElementById("resultPrompt").textContent = prompt;
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
function switchToUrlTab() {
  document.getElementById("urlTab").classList.add("active");
  document.getElementById("uploadTab").classList.remove("active");
  document.getElementById("urlSection").style.display = "block";
  document.getElementById("uploadSection").style.display = "none";
  console.log("切换到URL模式");
}

function switchToUploadTab() {
  document.getElementById("urlTab").classList.remove("active");
  document.getElementById("uploadTab").classList.add("active");
  document.getElementById("urlSection").style.display = "none";
  document.getElementById("uploadSection").style.display = "block";
  console.log("切换到上传模式，当前上传状态:", !!uploadedImageUrl);
}

// 文件选择处理
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showUploadStatus('请选择图片文件', 'error');
    return;
  }

  // 显示预览
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
}

// 上传图片到图床
async function uploadImage() {
  const fileInput = document.getElementById("imageFileInput");
  const file = fileInput.files[0];
  
  if (!file) {
    showUploadStatus('请先选择图片', 'error');
    return;
  }

  const uploadBtn = document.getElementById("uploadImageBtn");
  const originalText = uploadBtn.textContent;
  
  uploadBtn.disabled = true;
  uploadBtn.textContent = '上传中...';
  hideUploadStatus();

  try {
    // 将文件转换为base64
    const base64 = await fileToBase64(file);
    
    const result = await chrome.runtime.sendMessage({
      action: 'uploadImage',
      imageData: base64,
      fileName: file.name
    });

    if (result.success) {
      uploadedImageUrl = result.imageUrl;
      console.log("图片上传成功，URL:", uploadedImageUrl);
      
      // 更新按钮状态，显示已上传
      const uploadBtn = document.getElementById("uploadImageBtn");
      uploadBtn.textContent = '✅ 已上传';
      uploadBtn.style.background = '#48bb78';
      uploadBtn.style.color = 'white';
      
      showUploadStatus('图片上传成功！可以开始改图了', 'success');
    } else {
      throw new Error(result.error || '上传失败');
    }
  } catch (error) {
    console.error('图片上传失败:', error);
    let errorMessage = '上传失败';
    
    if (error.message) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error.toString && error.toString() !== '[object Object]') {
      errorMessage = error.toString();
    } else {
      errorMessage = '上传失败: 未知错误';
    }
    
    showUploadStatus(errorMessage, 'error');
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
function removeSelectedImage() {
  const imagePreview = document.getElementById("imagePreview");
  const uploadImageBtn = document.getElementById("uploadImageBtn");
  const fileInput = document.getElementById("imageFileInput");
  
  imagePreview.style.display = "none";
  uploadImageBtn.style.display = "none";
  fileInput.value = "";
  uploadedImageUrl = null;
  
  // 重置上传按钮状态
  uploadImageBtn.textContent = "📤 上传到图床";
  uploadImageBtn.style.background = '';
  uploadImageBtn.style.color = '';
  uploadImageBtn.dataset.lastFileName = '';
  
  hideUploadStatus();
  console.log("已移除选择的图片，重置上传状态");
}

// 重置图片相关状态
function resetImageState() {
  uploadedImageUrl = null;
  removeSelectedImage();
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

// 将文件转换为base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function copyImage() {
  try {
    const response = await fetch(currentImageUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    showNotification("图片已复制到剪贴板");
  } catch (error) {
    console.error("复制失败:", error);
    showNotification("复制失败，请重试", "error");
  }
}

function downloadImage() {
  const link = document.createElement("a");
  link.href = currentImageUrl;
  link.download = `ai-generated-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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

function showNotification(message, type = "success") {
  const existing = document.querySelector(".notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.remove(), 2000);
}
