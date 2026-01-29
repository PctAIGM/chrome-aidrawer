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

async function loadSettings() {
  try {
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
    
    // 获取当前选择的服务商配置
    const select = document.getElementById("provider");
    const providerId = select.value;
    const providers = response.providers || [];
    const currentProvider = providers.find(p => p.id === providerId);
    const useMultipart = currentProvider?.useMultipart;
    
    const uploadTab = document.getElementById("uploadTab");
    const uploadImageBtn = document.getElementById("uploadImageBtn");
    
    if (useMultipart) {
      // multipart接口：总是显示上传选项卡，不需要图床
      uploadTab.style.display = "block";
      if (uploadImageBtn) {
        uploadImageBtn.style.display = "none"; // 隐藏上传到图床按钮
      }
      // 更新提示文字
      const hint = document.querySelector("#uploadSection .hint");
      if (hint) {
        hint.textContent = "multipart接口直接使用本地文件，无需上传到图床";
      }
    } else if (hasActiveUploadService) {
      // 非multipart接口：需要图床服务
      uploadTab.style.display = "block";
      if (uploadImageBtn) {
        uploadImageBtn.style.display = "block"; // 显示上传到图床按钮
      }
      // 恢复原始提示文字
      const hint = document.querySelector("#uploadSection .hint");
      if (hint) {
        hint.textContent = "改图服务需要提供图片";
      }
    } else {
      // 没有图床服务且不是multipart
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

  // 图片上传相关事件
  document.getElementById("selectImageBtn").addEventListener("click", () => {
    document.getElementById("imageFileInput").click();
  });
  
  document.getElementById("imageFileInput").addEventListener("change", handleFileSelect);
  document.getElementById("uploadImageBtn").addEventListener("click", uploadImage);
  document.getElementById("removeImageBtn").addEventListener("click", removeSelectedImage);

  // 提示词切换按钮
  document.getElementById("togglePromptBtn").addEventListener("click", togglePrompt);
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

    const urlTab = document.getElementById("urlTab");
    const isUrlMode = urlTab.classList.contains("active");
    
    console.log("改图模式 - URL模式:", isUrlMode, "使用multipart:", useMultipart, "上传的图片URL:", uploadedImageUrl);
    
    if (isUrlMode) {
      imageUrl = document.getElementById("imageUrlInput").value.trim();
      if (!imageUrl) {
        showError("请输入要编辑的图片URL");
        return;
      }
      console.log("使用URL模式，图片URL:", imageUrl);
    } else {
      // 上传模式
      const fileInput = document.getElementById("imageFileInput");
      
      if (useMultipart && fileInput.files.length > 0) {
        // multipart接口：直接使用本地文件
        imageFile = fileInput.files[0];
        console.log("使用multipart模式，直接使用本地文件:", imageFile.name);
      } else if (!useMultipart && uploadedImageUrl) {
        // 非multipart接口：使用上传后的URL
        imageUrl = uploadedImageUrl;
        console.log("使用非multipart模式，图片URL:", imageUrl);
      } else {
        // 错误情况
        if (useMultipart) {
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

    // 发送生成/改图消息
    if (serviceType === "edit") {
      if (imageFile) {
        // 对于multipart接口，发送文件数据
        const base64 = await fileToBase64(imageFile);
        await chrome.runtime.sendMessage({
          action: "editImage",
          prompt: prompt,
          imageData: base64,
          fileName: imageFile.name,
          providerId: providerId,
          useLocalFile: true,
        });
      } else {
        // 对于非multipart接口，发送URL
        await chrome.runtime.sendMessage({
          action: "editImage",
          prompt: prompt,
          imageUrl: imageUrl,
          providerId: providerId,
        });
      }
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
      
      // 显示图片URL和复制按钮
      showUploadStatus('图片上传成功！可以开始改图了', 'success');
      showImageUrl(uploadedImageUrl);
    } else {
      const errorMsg = formatErrorMessage(result.error || '上传失败');
      throw new Error(errorMsg);
    }
  } catch (error) {
    const errorMsg = formatErrorMessage(error);
    console.error('图片上传失败:', error);
    console.error('格式化后的错误信息:', errorMsg);
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
      <input type="text" id="imageUrlInput" value="${imageUrl}" readonly style="
        flex: 1; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px;
        background: white; font-size: 12px; color: #374151;
      ">
      <button id="copyUrlBtn" style="
        padding: 6px 12px; background: #667eea; color: white; border: none;
        border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap;
      ">复制</button>
    </div>
  `;

  // 插入到上传状态下方
  const uploadStatus = document.getElementById("uploadStatus");
  if (uploadStatus && uploadStatus.parentNode) {
    uploadStatus.parentNode.insertBefore(urlDiv, uploadStatus.nextSibling);
  }

  // 绑定复制按钮事件
  const copyBtn = document.getElementById("copyUrlBtn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const urlInput = document.getElementById("imageUrlInput");
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
