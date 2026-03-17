// 编辑图片对话框脚本
import { fileToBase64 } from './lib/common.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 获取图片URL
  const response = await chrome.runtime.sendMessage({ action: 'getContextImage' });
  const imageUrl = response?.imageUrl;

  // 获取待处理的provider ID
  const { pendingEditProvider } = await chrome.storage.local.get('pendingEditProvider');

  // 检查是否配置了图片上传服务
  const settings = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const uploadServices = settings?.imageUploadServices || [];
  const hasUploadService = uploadServices.some(service => service.isActive);

  if (imageUrl) {
    const preview = document.getElementById('imagePreview');
    preview.src = imageUrl;
    preview.style.display = 'block';
  } else if (hasUploadService) {
    // 没有右键图片但有上传服务，显示文件选择
    const imageSelectSection = document.getElementById('imageSelectSection');
    if (imageSelectSection) {
      imageSelectSection.style.display = 'block';
    }
  }

  setupEventListeners(imageUrl, pendingEditProvider, hasUploadService);

  // 加载高级参数
  loadAdvancedParams(pendingEditProvider);
});

function setupEventListeners(imageUrl, providerId, hasUploadService) {
  const promptInput = document.getElementById('promptInput');
  const submitBtn = document.getElementById('submitBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const debugBtn = document.getElementById('debugBtn');
  const errorMessage = document.getElementById('errorMessage');
  const imageFileInput = document.getElementById('imageFileInput');
  const uploadImageBtn = document.getElementById('uploadImageBtn');
  const uploadStatus = document.getElementById('uploadStatus');

  // 监听来自background的消息
  let messageHandler = null;
  let debugData = null;  // 存储调试数据
  let currentImageUrl = imageUrl; // 当前使用的图片URL

  // 图片上传功能
  if (hasUploadService && uploadImageBtn) {
    uploadImageBtn.addEventListener('click', async () => {
      const file = imageFileInput.files[0];
      if (!file) {
        showUploadStatus('请先选择图片文件', 'error');
        return;
      }

      if (!file.type.startsWith('image/')) {
        showUploadStatus('请选择图片文件', 'error');
        return;
      }

      uploadImageBtn.disabled = true;
      uploadImageBtn.textContent = '上传中...';
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
          currentImageUrl = result.imageUrl;

          // 更新预览
          const preview = document.getElementById('imagePreview');
          preview.src = currentImageUrl;
          preview.style.display = 'block';

          // 隐藏文件选择区域
          const imageSelectSection = document.getElementById('imageSelectSection');
          if (imageSelectSection) {
            imageSelectSection.style.display = 'none';
          }

          showUploadStatus('图片上传成功！', 'success');
          showUploadedImageUrlInDialog(result.imageUrl);
        } else {
          throw new Error(result.error || '上传失败');
        }
      } catch (error) {
        console.error('图片上传失败:', error);
        showUploadStatus('上传失败: ' + error.message, 'error');
      } finally {
        uploadImageBtn.disabled = false;
        uploadImageBtn.textContent = '上传图片';
      }
    });
  }

  // 提交按钮
  submitBtn.addEventListener('click', async () => {
    const prompt = promptInput.value.trim();
    const negativePromptInput = document.getElementById('negativePromptInput');
    const negativePrompt = negativePromptInput && negativePromptInput.offsetParent !== null ? negativePromptInput.value.trim() : "";

    // 隐藏之前的错误和调试按钮
    errorMessage.style.display = 'none';
    debugBtn.style.display = 'none';
    debugData = null;

    if (!prompt) {
      showError('请输入改图提示词');
      return;
    }

    if (!currentImageUrl || !providerId) {
      showError('图片信息丢失，请重新选择图片或右键点击图片');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '处理中...';

    // 设置超时定时器
    const timeout = setTimeout(() => {
      showError('改图请求超时，请检查网络连接或服务商配置');
      submitBtn.disabled = false;
      submitBtn.textContent = '开始改图';
    }, 60000); // 60秒超时

    // 监听改图结果
    messageHandler = (request) => {
      if (request.action === 'imageGenerated') {
        clearTimeout(timeout);
        // 保存调试数据
        if (request.debugData) {
          debugData = request.debugData;
        }
        // 成功，延迟一点再关闭让用户看到
        submitBtn.textContent = '改图成功！';
        setTimeout(() => {
          chrome.storage.local.remove('pendingEditProvider');
          window.close();
        }, 500);
      } else if (request.action === 'imageError') {
        clearTimeout(timeout);
        // 保存调试数据
        if (request.debugData) {
          debugData = request.debugData;
          debugBtn.style.display = 'inline-block';
        }
        showError(request.error || '改图失败');
        submitBtn.disabled = false;
        submitBtn.textContent = '开始改图';
      }
    };

    chrome.runtime.onMessage.addListener(messageHandler);

    try {
      // 收集高级参数
      const advancedParams = collectAdvancedParams();

      // 发送改图请求
      await chrome.runtime.sendMessage({
        action: 'editImage',
        prompt: prompt,
        negativePrompt: negativePrompt,
        imageUrl: currentImageUrl,
        providerId: providerId,
        advancedParams: advancedParams
      });
    } catch (error) {
      clearTimeout(timeout);
      console.error('发送改图请求失败:', error);
      showError('发送请求失败: ' + error.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '开始改图';
      if (messageHandler) {
        chrome.runtime.onMessage.removeListener(messageHandler);
      }
    }
  });

  // 检查是否配置了反向提示词
  chrome.runtime.sendMessage({ action: "getSettings" }).then(response => {
    const providers = response.providers || [];
    const currentProvider = providers.find(p => p.id === providerId);

    const negativePromptGroup = document.getElementById("negativePromptGroup");
    const negativePromptInput = document.getElementById("negativePromptInput");

    let hasNegativePrompt = false;
    let defaultValue = "";

    if (currentProvider && currentProvider.customParams) {
      for (const [key, value] of Object.entries(currentProvider.customParams)) {
        if (value && typeof value === "object" && value.fieldType === "negativePrompt") {
          hasNegativePrompt = true;
          defaultValue = value.value || "";
          break;
        }
      }
    }

    if (hasNegativePrompt) {
      negativePromptGroup.style.display = "block";
      negativePromptInput.value = defaultValue;
    }
  }).catch(e => console.error(e));

  // 调试按钮
  debugBtn.addEventListener('click', () => {
    if (debugData) {
      console.log('=== 改图调试信息 ===');
      console.log('服务商:', debugData.providerName);
      console.log('请求体:', debugData.request);
      console.log('响应数据:', debugData.response);

      // 显示调试信息弹窗
      const debugInfo = `
调试信息
-----------------
服务商: ${debugData.providerName || '未知'}

请求体:
${JSON.stringify(debugData.request, null, 2)}

响应数据:
${JSON.stringify(debugData.response, null, 2)}
      `.trim();

      alert(debugInfo);
    }
  });

  // 取消按钮
  cancelBtn.addEventListener('click', async () => {
    if (messageHandler) {
      chrome.runtime.onMessage.removeListener(messageHandler);
    }
    await chrome.storage.local.remove('pendingEditProvider');
    window.close();
  });

  // 回车提交
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      submitBtn.click();
    }
  });

  // 显示错误信息
  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
  }

  // 显示上传状态
  function showUploadStatus(message, type = 'info') {
    if (uploadStatus) {
      uploadStatus.textContent = message;
      uploadStatus.className = type === 'error' ? 'error-message' : 'success-message';
      uploadStatus.style.display = 'block';
    }
  }

  // 隐藏上传状态
  function hideUploadStatus() {
    if (uploadStatus) {
      uploadStatus.style.display = 'none';
    }
  }

  // 显示上传后的图片URL（编辑对话框中）
  function showUploadedImageUrlInDialog(imageUrl) {
    // 移除已有的URL显示区域
    const existingUrlDiv = document.getElementById('editDialogUploadedUrl');
    if (existingUrlDiv) {
      existingUrlDiv.remove();
    }

    // 创建URL显示区域
    const urlDiv = document.createElement('div');
    urlDiv.id = 'editDialogUploadedUrl';
    urlDiv.style.cssText = `
      margin-top: 12px; padding: 12px; background: #f0fff4; border: 1px solid #9ae6b4;
      border-radius: 8px; font-size: 13px; word-break: break-all;
    `;

    urlDiv.innerHTML = `
      <div style="color: #2f855a; margin-bottom: 8px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
        <span>🔗</span>
        <span>图片链接</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <input type="text" value="${imageUrl}" readonly style="
          flex: 1; padding: 6px 8px; border: 1px solid #9ae6b4; border-radius: 4px;
          background: white; font-size: 12px; color: #374151;
        ">
        <button class="copy-dialog-url-btn" style="
          padding: 6px 12px; background: #48bb78; color: white; border: none;
          border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap;
        ">复制</button>
      </div>
    `;

    // 插入到上传状态下方
    if (uploadStatus && uploadStatus.parentNode) {
      uploadStatus.parentNode.insertBefore(urlDiv, uploadStatus.nextSibling);
    }

    // 绑定复制按钮事件
    const copyBtn = urlDiv.querySelector('.copy-dialog-url-btn');
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const originalText = copyBtn.textContent;

        try {
          await navigator.clipboard.writeText(imageUrl);
          copyBtn.textContent = "✅ 已复制";
          copyBtn.style.background = "#22c55e";

          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = "#48bb78";
          }, 2000);
        } catch (error) {
          console.error("复制图片链接失败:", error);
          copyBtn.textContent = "❌ 失败";
          copyBtn.style.background = "#f56565";

          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = "#48bb78";
          }, 2000);
        }
      };
    }
  }
}

// 加载高级参数
async function loadAdvancedParams(providerId) {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const providers = response.providers || [];
    const currentProvider = providers.find(p => p.id === providerId);

    const paramsList = document.getElementById("advancedParamsList");
    paramsList.innerHTML = "";

    // 添加展开/折叠按钮事件
    const toggleBtn = document.getElementById("toggleAdvancedParamsBtn");
    const content = document.getElementById("advancedParamsContent");
    
    toggleBtn.addEventListener("click", () => {
      if (content.style.display === "none") {
        content.style.display = "block";
        toggleBtn.classList.add("expanded");
      } else {
        content.style.display = "none";
        toggleBtn.classList.remove("expanded");
      }
    });

    if (!currentProvider || !currentProvider.customParams) {
      paramsList.innerHTML = '<div class="no-advanced-params">当前服务商无可配置的高级参数</div>';
      return;
    }

    // 过滤掉特殊字段类型（prompt, imageUrl, negativePrompt）
    const editableParams = [];
    for (const [key, value] of Object.entries(currentProvider.customParams)) {
      // 检查是否是特殊字段类型
      if (value && typeof value === "object" && value.fieldType) {
        if (["prompt", "imageUrl", "negativePrompt"].includes(value.fieldType)) {
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
