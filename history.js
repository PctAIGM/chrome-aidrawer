// AI画图助手 - 历史记录页面脚本
import {
  formatErrorMessage,
  showNotification,
  escapeHtml,
  truncateText,
  formatDate
} from './lib/common.js';
import {
  copyImageToClipboard,
  downloadImage,
  fetchImageBlob,
  handleImageError,
  retryLoadImage,
  setupImageErrorHandling,
  createImageErrorObserver
} from './lib/image-utils.js';

let historyData = [];
let filteredData = [];
let selectedItems = new Set();
let localNSFWSetting = null; // 本地NSFW设置，null表示使用全局设置

document.addEventListener("DOMContentLoaded", () => {
  loadHistory();
  setupEventListeners();
  setupImageErrorObserver();
});



// 调试功能：手动触发404处理（开发时使用）
function debugTrigger404Handling() {
  console.log('🔧 手动触发404处理测试');
  const allImages = document.querySelectorAll('img[data-error-type]');
  console.log('找到图片数量:', allImages.length);

  allImages.forEach((img, index) => {
    console.log(`测试图片 ${index + 1}:`, img.src, img.dataset.errorType);
    // 模拟404错误
    handleImageError(img, img.dataset.errorType);
  });
}

// 调试功能：检查页面中所有图片的状态
function debugCheckImageStatus() {
  console.log('🔧 检查页面中所有图片的状态');
  const allImages = document.querySelectorAll('img[data-error-type]');
  console.log('找到图片数量:', allImages.length);

  allImages.forEach((img, index) => {
    console.log(`图片 ${index + 1}:`, {
      src: img.src,
      type: img.dataset.errorType,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      failed: img.complete && img.naturalWidth === 0,
      visible: img.style.display !== 'none'
    });

    // 如果图片加载失败，自动触发处理
    if (img.complete && img.naturalWidth === 0 && img.style.display !== 'none') {
      console.log(`自动处理失败的图片 ${index + 1}`);
      handleImageError(img, img.dataset.errorType);
    }
  });
}


// 设置图片错误监听器，用于检测动态添加的图片
function setupImageErrorObserver() {
  const observer = createImageErrorObserver();

  // 开始观察
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}





async function loadHistory() {
  const loading = document.querySelector(".loading");
  if (loading) loading.style.display = "block";

  try {
    const response = await chrome.runtime.sendMessage({ action: "getHistory" });
    historyData = response.history || [];
    filteredData = [...historyData];

    // 初始化NSFW设置
    await initializeNSFWSetting();

    // 检查上传服务并显示上传按钮
    await checkUploadServiceAndShowButtons();

    renderGallery();
  } catch (error) {
    console.error("加载历史记录失败:", error);
    showEmptyState();
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function renderGallery() {
  const gallery = document.getElementById("gallery");
  const emptyState = document.getElementById("emptyState");
  const historyCount = document.getElementById("historyCount");

  if (historyCount) historyCount.textContent = `${filteredData.length} 条记录`;

  // 清空选中状态
  selectedItems.clear();
  updateExportButton();
  updateSelectAllCheckbox();

  if (filteredData.length === 0) {
    showEmptyState();
    return;
  }

  if (gallery) {
    gallery.innerHTML = "";

    // 获取设置
    chrome.runtime.sendMessage({ action: "getSettings" }).then((settings) => {
      const imagesPerRow = settings.imagesPerRow || 4;
      // 使用本地NSFW设置，如果为null则使用全局设置
      const allowNSFW = localNSFWSetting !== null ? localNSFWSetting : !!settings.allowNSFW;

      gallery.style.display = "grid";
      gallery.style.gridTemplateColumns = `repeat(${imagesPerRow}, 1fr)`;

      if (emptyState) emptyState.style.display = "none";

      filteredData.forEach((item) => {
        const card = createHistoryCard(item, allowNSFW);
        gallery.appendChild(card);
      });
    });
  }
}

function createHistoryCard(item, allowNSFW) {
  const card = document.createElement("div");
  card.className = "history-card";
  if (!allowNSFW) card.classList.add("nsfw-blur");
  card.dataset.id = item.id;

  const isEdit = item.operationType === "edit" && item.originalImageUrl;
  const isSelected = selectedItems.has(item.id);

  // 如果是改图操作，显示原图和结果图
  const nsfwOverlayHtml = !allowNSFW
    ? '<div class="nsfw-overlay"><span class="nsfw-icon">🔞</span>点击查看</div>'
    : "";

  let imageHtml;
  if (isEdit) {
    imageHtml = `
      <div class="card-image dual-image">
        <div class="image-container original">
          <img src="${item.originalImageUrl}" alt="原图" loading="lazy" data-error-type="original">
          <div class="image-error" style="display: none;">
            <div class="error-icon">🖼️</div>
            <div class="error-text">原图已失效</div>
            <button class="retry-btn" data-retry-type="card">重试</button>
          </div>
          <span class="image-label">原图</span>
        </div>
        <div class="arrow">→</div>
        <div class="image-container result">
          <img src="${item.imageUrl}" alt="改图结果" loading="lazy" data-error-type="result">
          <div class="image-error" style="display: none;">
            <div class="error-icon">🖼️</div>
            <div class="error-text">图片已失效</div>
            <button class="retry-btn" data-retry-type="card">重试</button>
          </div>
          <span class="image-label">改图</span>
        </div>
        ${nsfwOverlayHtml}
      </div>
    `;
  } else {
    imageHtml = `
      <div class="card-image">
        <img src="${item.imageUrl}" alt="${escapeHtml(item.prompt)}" loading="lazy" data-error-type="single">
        <div class="image-error" style="display: none;">
          <div class="error-icon">🖼️</div>
          <div class="error-text">图片已失效</div>
          <button class="retry-btn" data-retry-type="card">重试</button>
        </div>
        ${nsfwOverlayHtml}
      </div>
    `;
  }

  card.innerHTML = `
    <div class="card-select">
      <input type="checkbox" class="item-checkbox" data-id="${item.id}" ${isSelected ? "checked" : ""}>
    </div>
    ${imageHtml}
    <div class="card-info">
      <div class="card-prompt-wrapper">
        <p class="card-prompt" title="${escapeHtml(item.prompt)}">${escapeHtml(truncateText(item.prompt, 50))}</p>
        <button class="copy-prompt-btn" title="复制提示词">📋</button>
      </div>
      <div class="card-meta">
        <span class="provider-tag">${escapeHtml(item.provider || "未知")}</span>
        ${isEdit ? '<span class="operation-tag edit">✏️ 改图</span>' : '<span class="operation-tag generate">🎨 生成</span>'}
      </div>
      <p class="card-date">${formatDate(item.createdAt)}</p>
    </div>
    <div class="card-actions">
      <button class="action-btn copy-btn" title="复制到剪贴板">复制</button>
      <button class="action-btn download-btn" title="下载图片">下载</button>
      <button class="action-btn upload-btn" title="分享到相册">分享</button>
      <button class="action-btn delete-btn" title="删除">删除</button>
    </div>
  `;

  // 复选框事件
  const checkbox = card.querySelector(".item-checkbox");
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  checkbox.addEventListener("change", (e) => {
    if (e.target.checked) {
      selectedItems.add(item.id);
    } else {
      selectedItems.delete(item.id);
    }
    updateExportButton();
    updateSelectAllCheckbox();
  });

  card.querySelector(".card-image").addEventListener("click", () => {
    if (
      card.classList.contains("nsfw-blur") &&
      !card.classList.contains("nsfw-reveal")
    ) {
      card.classList.add("nsfw-reveal");
    } else {
      openModal(item);
    }
  });
  card.querySelector(".copy-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    copyImage(item);
  });
  card.querySelector(".copy-prompt-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    copyPrompt(item.prompt);
  });
  card.querySelector(".download-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    downloadImageItem(item);
  });
  card.querySelector(".upload-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    uploadImageToAlbum(item);
  });
  card.querySelector(".delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteItem(item.id);
  });

  // 为图片添加错误处理事件监听器
  const images = card.querySelectorAll('img');
  images.forEach(img => {
    setupImageErrorHandling(img, img.dataset.errorType);
  });

  // 为重试按钮添加事件监听器
  const retryButtons = card.querySelectorAll('.retry-btn[data-retry-type="card"]');
  retryButtons.forEach(btn => {
    btn.addEventListener('click', function () {
      retryLoadImage(this);
    });
  });

  return card;
}

function updateExportButton() {
  const count = selectedItems.size;

  const exportBtn = document.getElementById("exportSelectedBtn");
  if (exportBtn) {
    exportBtn.textContent = `导出选中 (${count})`;
    exportBtn.disabled = count === 0;
  }

  const shareBtn = document.getElementById("shareSelectedBtn");
  if (shareBtn) {
    shareBtn.textContent = `分享选中 (${count})`;
    shareBtn.disabled = count === 0;
  }
}

function updateSelectAllCheckbox() {
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  if (selectAllCheckbox) {
    if (filteredData.length === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (selectedItems.size === 0) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    } else if (selectedItems.size === filteredData.length) {
      selectAllCheckbox.checked = true;
      selectAllCheckbox.indeterminate = false;
    } else {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = true;
    }
  }
}

function toggleSelectAll(checked) {
  const checkboxes = document.querySelectorAll(".item-checkbox");
  checkboxes.forEach((cb) => {
    cb.checked = checked;
    const id = Number(cb.dataset.id);
    if (checked) {
      selectedItems.add(id);
    } else {
      selectedItems.delete(id);
    }
  });
  updateExportButton();
  updateSelectAllCheckbox();
}

async function exportSelectedImages() {
  if (selectedItems.size === 0) {
    showNotification("请先选择要导出的图片", "error");
    return;
  }

  const exportBtn = document.getElementById("exportSelectedBtn");
  const originalText = exportBtn.textContent;
  exportBtn.disabled = true;
  exportBtn.textContent = "导出中...";

  try {
    const zip = new JSZip();
    const imgFolder = zip.folder("ai-images");

    let successCount = 0;
    let failCount = 0;

    // 获取选中的图片数据
    const selectedImages = filteredData.filter((item) =>
      selectedItems.has(item.id),
    );

    for (let i = 0; i < selectedImages.length; i++) {
      const item = selectedImages[i];
      exportBtn.textContent = `导出中 (${i + 1}/${selectedImages.length})`;

      try {
        // 下载图片并转为 blob
        const blob = await fetchImageBlob(item.imageUrl);

        // 生成文件名
        const timestamp = new Date(item.createdAt).getTime();
        const promptSlug = (item.prompt || "image")
          .substring(0, 30)
          .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_");
        const fileName = `${timestamp}_${promptSlug}.png`;

        imgFolder.file(fileName, blob);
        successCount++;

        // 如果是改图操作，也导出原图
        if (item.operationType === "edit" && item.originalImageUrl) {
          try {
            const originalBlob = await fetchImageBlob(
              item.originalImageUrl,
            );
            imgFolder.file(
              `${timestamp}_${promptSlug}_original.png`,
              originalBlob,
            );
          } catch (e) {
            console.warn("导出原图失败:", e);
          }
        }
      } catch (error) {
        console.error(`导出图片失败 (${item.id}):`, error);
        failCount++;
      }
    }

    if (successCount === 0) {
      showNotification("导出失败，没有成功导出任何图片", "error");
      return;
    }

    // 生成 zip 文件
    exportBtn.textContent = "正在打包...";
    const content = await zip.generateAsync({ type: "blob" });

    // 下载 zip 文件
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const zipFileName = `ai-images-${dateStr}-${timeStr}.zip`;

    const link = document.createElement("a");
    link.href = URL.createObjectURL(content);
    link.download = zipFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    if (failCount > 0) {
      showNotification(
        `导出完成：成功 ${successCount} 张，失败 ${failCount} 张`,
        "success",
      );
    } else {
      showNotification(`成功导出 ${successCount} 张图片`, "success");
    }
  } catch (error) {
    console.error("导出失败:", error);
    showNotification("导出失败：" + error.message, "error");
  } finally {
    exportBtn.disabled = selectedItems.size === 0;
    exportBtn.textContent = originalText;
    updateExportButton();
  }
}

// 批量分享选中的图片
async function shareSelectedImages() {
  if (selectedItems.size === 0) {
    showNotification("请先选择要分享的图片", "error");
    return;
  }

  const shareBtn = document.getElementById("shareSelectedBtn");
  const originalText = shareBtn.textContent;
  shareBtn.disabled = true;
  shareBtn.textContent = "分享中...";

  let successCount = 0;
  let failCount = 0;
  const uploadedUrls = [];

  // 获取选中的图片数据
  const selectedImages = filteredData.filter((item) =>
    selectedItems.has(item.id)
  );

  for (let i = 0; i < selectedImages.length; i++) {
    const item = selectedImages[i];
    shareBtn.textContent = `分享中 (${i + 1}/${selectedImages.length})`;

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'uploadImageToAlbum',
        imageUrl: item.imageUrl,
        prompt: item.prompt
      });

      if (result.success) {
        successCount++;
        uploadedUrls.push(result.imageUrl);
      } else {
        failCount++;
        console.error(`分享图片失败 (${item.id}):`, result.error);
      }
    } catch (error) {
      failCount++;
      console.error(`分享图片失败 (${item.id}):`, error);
    }
  }

  // 显示结果通知
  if (successCount > 0 && failCount === 0) {
    showNotification(`成功分享 ${successCount} 张图片到相册`, "success");
  } else if (successCount > 0 && failCount > 0) {
    showNotification(`分享完成：成功 ${successCount} 张，失败 ${failCount} 张`, "success");
  } else {
    showNotification("分享失败，请检查上传服务配置", "error");
  }

  // 如果有成功上传的图片，复制链接到剪贴板
  if (uploadedUrls.length > 0) {
    try {
      await navigator.clipboard.writeText(uploadedUrls.join("\n"));
      showNotification(`已复制 ${uploadedUrls.length} 个链接到剪贴板`, "success");
    } catch (e) {
      console.warn("复制链接失败:", e);
    }
  }

  shareBtn.disabled = selectedItems.size === 0;
  shareBtn.textContent = originalText;
  updateExportButton();
}

function openModal(item) {
  const modal = document.getElementById("imageModal");
  const modalImage = document.getElementById("modalImage");
  const modalPrompt = document.getElementById("modalPrompt");
  const modalMeta = document.getElementById("modalMeta");

  const isEdit = item.operationType === "edit" && item.originalImageUrl;

  const viewer = document.getElementById("modalImageViewer");

  if (viewer) {
    if (isEdit) {
      // 改图模式：显示原图和结果图
      viewer.innerHTML = `
        <div style="display: flex; gap: 16px; align-items: center; justify-content: center;">
          <div style="flex: 1; text-align: center; position: relative;">
            <img src="${item.originalImageUrl}" 
                 style="width: 100%; border-radius: 8px; border: 1px solid #edf2f7;" 
                 alt="原图"
                 data-error-type="modal-original">
            <div class="modal-image-error" style="display: none;">
              <div style="padding: 40px; text-align: center; color: #6c757d; background: #f8f9fa; border-radius: 8px; border: 1px solid #edf2f7;">
                <div style="font-size: 32px; margin-bottom: 12px;">🖼️</div>
                <div style="font-size: 14px; margin-bottom: 12px;">原图已失效</div>
                <button class="retry-btn" data-retry-type="modal" style="padding: 6px 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">重试</button>
              </div>
            </div>
            <p style="margin-top: 8px; color: #718096; font-size: 13px;">原图</p>
          </div>
          <div style="font-size: 24px; color: #667eea;">→</div>
          <div style="flex: 1; text-align: center; position: relative;">
            <img src="${item.imageUrl}" 
                 style="width: 100%; border-radius: 8px; border: 1px solid #edf2f7;" 
                 alt="改图结果"
                 data-error-type="modal-result">
            <div class="modal-image-error" style="display: none;">
              <div style="padding: 40px; text-align: center; color: #6c757d; background: #f8f9fa; border-radius: 8px; border: 1px solid #edf2f7;">
                <div style="font-size: 32px; margin-bottom: 12px;">🖼️</div>
                <div style="font-size: 14px; margin-bottom: 12px;">改图结果已失效</div>
                <button class="retry-btn" data-retry-type="modal" style="padding: 6px 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">重试</button>
              </div>
            </div>
            <p style="margin-top: 8px; color: #667eea; font-size: 13px; font-weight: 600;">✏️ 改图结果</p>
          </div>
        </div>
      `;
    } else {
      viewer.innerHTML = `
        <div style="position: relative;">
          <img id="modalImage" 
               src="${item.imageUrl}" 
               alt="预览图片" 
               style="width: 100%; max-height: 60vh; object-fit: contain; display: block;"
               data-error-type="modal-single">
          <div class="modal-image-error" style="display: none;">
            <div style="padding: 60px; text-align: center; color: #6c757d; background: #f8f9fa; border-radius: 8px;">
              <div style="font-size: 48px; margin-bottom: 16px;">🖼️</div>
              <div style="font-size: 16px; margin-bottom: 16px;">图片已失效</div>
              <button class="retry-btn" data-retry-type="modal" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">重试</button>
            </div>
          </div>
        </div>
      `;
    }

    // 为新创建的图片添加错误处理事件监听器
    const modalImages = viewer.querySelectorAll('img');
    modalImages.forEach(img => {
      img.addEventListener('error', function () {
        handleImageError(this, this.dataset.errorType);
      });
    });

    // 为重试按钮添加事件监听器
    const retryButtons = viewer.querySelectorAll('.retry-btn[data-retry-type="modal"]');
    retryButtons.forEach(btn => {
      btn.addEventListener('click', function () {
        retryLoadImage(this);
      });
    });
  }

  if (modalPrompt) {
    modalPrompt.textContent = `"${item.prompt}"`;
    modalPrompt.style.display = "none";
  }

  // 设置提示词切换
  const promptToggle = document.getElementById("modalPromptToggle");
  if (promptToggle) {
    promptToggle.onclick = () => {
      const isHidden = modalPrompt.style.display === "none";
      modalPrompt.style.display = isHidden ? "block" : "none";
    };
  }

  const opText = isEdit ? "✏️ 改图" : "🎨 生成";
  if (modalMeta)
    modalMeta.textContent = `${item.provider || "未知"} · ${opText} · ${formatDate(item.createdAt)}`;

  if (modal) modal.style.display = "flex";

  const copyBtn = document.getElementById("modalCopyBtn");
  if (copyBtn) copyBtn.onclick = () => copyImage(item);

  const downloadBtn = document.getElementById("modalDownloadBtn");
  if (downloadBtn) downloadBtn.onclick = () => downloadImageItem(item);

  const uploadBtn = document.getElementById("modalUploadBtn");
  if (uploadBtn) uploadBtn.onclick = () => uploadImageToAlbum(item);
}

function closeModal() {
  const modal = document.getElementById("imageModal");
  if (modal) modal.style.display = "none";
}

async function copyImage(item) {
  try {
    await copyImageToClipboard(item.imageUrl);
    showNotification("图片已复制到剪贴板", "success");
  } catch (error) {
    console.error("复制失败:", error);
    // 如果图片复制失败，尝试复制图片 URL
    try {
      await navigator.clipboard.writeText(item.imageUrl);
      showNotification("图片URL已复制到剪贴板", "success");
    } catch (e) {
      showNotification("复制失败，请重试", "error");
    }
  }
}

async function copyPrompt(prompt) {
  try {
    await navigator.clipboard.writeText(prompt);
    showNotification("提示词已复制", "success");
  } catch (error) {
    console.error("复制提示词失败:", error);
    showNotification("复制失败", "error");
  }
}

function downloadImageItem(item) {
  downloadImage(item.imageUrl, `ai-generated-${item.id}.png`);
}

async function deleteItem(id) {
  if (!confirm("确定要删除这条记录吗？")) return;

  try {
    await chrome.runtime.sendMessage({ action: "deleteHistoryItem", id });
    historyData = historyData.filter((item) => item.id !== id);
    filteredData = filteredData.filter((item) => item.id !== id);
    selectedItems.delete(id);
    renderGallery();
    showNotification("删除成功", "success");
  } catch (error) {
    console.error("删除失败:", error);
    showNotification("删除失败", "error");
  }
}

async function clearAllHistory() {
  if (!confirm("确定要清空所有历史记录吗？此操作不可恢复。")) return;

  try {
    await chrome.runtime.sendMessage({ action: "clearHistory" });
    historyData = [];
    filteredData = [];
    selectedItems.clear();
    renderGallery();
    showNotification("已清空所有记录", "success");
  } catch (error) {
    console.error("清空失败:", error);
    showNotification("清空失败", "error");
  }
}

function searchHistory(query, operationType = "all") {
  let result = [...historyData];

  // 按提示词搜索
  if (query && query.trim()) {
    const lowerQuery = query.toLowerCase();
    result = result.filter((item) =>
      item.prompt.toLowerCase().includes(lowerQuery),
    );
  }

  // 按操作类型过滤
  if (operationType !== "all") {
    if (operationType === "edit") {
      result = result.filter((item) => item.operationType === "edit");
    } else if (operationType === "generate") {
      result = result.filter((item) => item.operationType !== "edit");
    }
  }

  filteredData = result;
  selectedItems.clear();
  renderGallery();
}

function showEmptyState() {
  const gallery = document.getElementById("gallery");
  const emptyState = document.getElementById("emptyState");
  if (gallery) gallery.style.display = "none";
  if (emptyState) emptyState.style.display = "flex";
}

function setupEventListeners() {
  const searchBtn = document.getElementById("searchBtn");
  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      const query = document.getElementById("searchInput").value;
      const operationType = document.getElementById("operationTypeFilter").value;
      searchHistory(query, operationType);
    });
  }

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        const query = searchInput.value;
        const operationType = document.getElementById("operationTypeFilter").value;
        searchHistory(query, operationType);
      }
    });
  }

  // 操作类型过滤器
  const operationTypeFilter = document.getElementById("operationTypeFilter");
  if (operationTypeFilter) {
    operationTypeFilter.addEventListener("change", (e) => {
      const query = document.getElementById("searchInput").value;
      searchHistory(query, e.target.value);
    });
  }

  const clearBtn = document.getElementById("clearAllBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearAllHistory);
  }

  const modalClose = document.querySelector(".modal-close");
  if (modalClose) {
    modalClose.addEventListener("click", closeModal);
  }

  window.addEventListener("click", (e) => {
    const modal = document.getElementById("imageModal");
    if (e.target === modal) {
      closeModal();
    }
  });

  // 全选复选框
  const selectAllCheckbox = document.getElementById("selectAllCheckbox");
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", (e) => {
      toggleSelectAll(e.target.checked);
    });
  }

  // 导出按钮
  const exportBtn = document.getElementById("exportSelectedBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportSelectedImages);
  }

  // 批量分享按钮
  const shareSelectedBtn = document.getElementById("shareSelectedBtn");
  if (shareSelectedBtn) {
    shareSelectedBtn.addEventListener("click", shareSelectedImages);
  }

  // NSFW开关
  const nsfwToggle = document.getElementById("nsfwToggle");
  if (nsfwToggle) {
    nsfwToggle.addEventListener("change", (e) => {
      localNSFWSetting = e.target.checked;
      renderGallery();
    });
  }
}


// fetchBlobWithFallback, handleImageError, retryLoadImage 已移至 lib/image-utils.js

// 检查上传服务并显示上传按钮
async function checkUploadServiceAndShowButtons() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const uploadServices = response.imageUploadServices || [];
    const hasActiveUploadService = uploadServices.some(service => service.isActive);

    // 显示或隐藏所有上传按钮
    const uploadButtons = document.querySelectorAll('.upload-btn');
    uploadButtons.forEach(btn => {
      btn.style.display = hasActiveUploadService ? 'inline-flex' : 'none';
    });

    // 显示或隐藏模态框中的上传按钮
    const modalUploadBtn = document.getElementById("modalUploadBtn");
    if (modalUploadBtn) {
      modalUploadBtn.style.display = hasActiveUploadService ? 'inline-flex' : 'none';
    }

    // 显示或隐藏批量分享按钮
    const shareSelectedBtn = document.getElementById("shareSelectedBtn");
    if (shareSelectedBtn) {
      shareSelectedBtn.style.display = hasActiveUploadService ? 'inline-flex' : 'none';
    }
  } catch (error) {
    console.error("检查上传服务失败:", error);
  }
}

// 显示上传后的图片URL
function showUploadedImageUrl(imageUrl, uploadBtn) {
  // 找到按钮所在的卡片
  const card = uploadBtn.closest('.history-card');
  if (!card) return;

  // 移除已有的URL显示区域
  const existingUrlDiv = card.querySelector('.uploaded-url-display');
  if (existingUrlDiv) {
    existingUrlDiv.remove();
  }

  // 创建URL显示区域
  const urlDiv = document.createElement('div');
  urlDiv.className = 'uploaded-url-display';
  urlDiv.style.cssText = `
    margin-top: 12px; padding: 12px; background: #f0fff4; border: 1px solid #9ae6b4;
    border-radius: 8px; font-size: 13px; word-break: break-all;
  `;

  urlDiv.innerHTML = `
    <div style="color: #2f855a; margin-bottom: 8px; font-weight: 600; display: flex; align-items: center; gap: 6px;">
      <span>🔗</span>
      <span>已上传到相册</span>
    </div>
    <div style="color: #4a5568; margin-bottom: 6px; font-weight: 500; font-size: 12px;">分享链接：</div>
    <div style="display: flex; gap: 8px; align-items: center;">
      <input type="text" value="${imageUrl}" readonly style="
        flex: 1; padding: 6px 8px; border: 1px solid #9ae6b4; border-radius: 4px;
        background: white; font-size: 12px; color: #374151;
      ">
      <button class="copy-uploaded-url-btn" style="
        padding: 6px 12px; background: #48bb78; color: white; border: none;
        border-radius: 4px; font-size: 12px; cursor: pointer; white-space: nowrap;
      ">复制</button>
    </div>
  `;

  // 插入到卡片的操作按钮区域下方
  const actionsDiv = card.querySelector('.card-actions');
  if (actionsDiv && actionsDiv.parentNode) {
    actionsDiv.parentNode.insertBefore(urlDiv, actionsDiv.nextSibling);
  }

  // 绑定复制按钮事件
  const copyBtn = urlDiv.querySelector('.copy-uploaded-url-btn');
  if (copyBtn) {
    copyBtn.onclick = async (e) => {
      e.stopPropagation(); // 防止触发卡片点击事件
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
        console.error("复制分享链接失败:", error);
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

// 上传图片到相册
async function uploadImageToAlbum(item) {
  const uploadBtn = event.target;
  const originalText = uploadBtn.textContent;

  uploadBtn.disabled = true;
  uploadBtn.textContent = "上传中...";

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'uploadImageToAlbum',
      imageUrl: item.imageUrl,
      prompt: item.prompt
    });

    if (result.success) {
      showNotification("图片已上传到相册！", "success");
      // 显示上传后的图片URL
      showUploadedImageUrl(result.imageUrl, uploadBtn);
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



// 初始化NSFW设置
async function initializeNSFWSetting() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const globalAllowNSFW = !!response.allowNSFW;

    // 重置本地设置为null，表示使用全局设置
    localNSFWSetting = null;

    // 更新开关状态为全局设置值
    const nsfwToggle = document.getElementById("nsfwToggle");
    if (nsfwToggle) {
      nsfwToggle.checked = globalAllowNSFW;
    }
  } catch (error) {
    console.error("初始化NSFW设置失败:", error);
    // 默认不显示敏感内容
    localNSFWSetting = false;
    const nsfwToggle = document.getElementById("nsfwToggle");
    if (nsfwToggle) {
      nsfwToggle.checked = false;
    }
  }
}

// 在控制台暴露调试函数（放在文件最后确保所有函数都已定义）
window.debugTrigger404Handling = debugTrigger404Handling;
window.debugCheckImageStatus = debugCheckImageStatus;

// 简单的测试函数
window.testDebugFunctions = function () {
  console.log('🧪 测试调试函数是否可用');
  console.log('debugTrigger404Handling:', typeof debugTrigger404Handling);
  console.log('debugCheckImageStatus:', typeof debugCheckImageStatus);
  return 'Debug functions test completed';
};


