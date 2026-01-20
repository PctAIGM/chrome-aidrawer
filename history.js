// AI画图助手 - 历史记录页面脚本

document.addEventListener("DOMContentLoaded", () => {
  loadHistory();
  setupEventListeners();
});

let historyData = [];
let filteredData = [];
let selectedItems = new Set();

async function loadHistory() {
  const loading = document.querySelector(".loading");
  if (loading) loading.style.display = "block";

  try {
    const response = await chrome.runtime.sendMessage({ action: "getHistory" });
    historyData = response.history || [];
    filteredData = [...historyData];
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
      const allowNSFW = !!settings.allowNSFW;

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
          <img src="${item.originalImageUrl}" alt="原图" loading="lazy">
          <span class="image-label">原图</span>
        </div>
        <div class="arrow">→</div>
        <div class="image-container result">
          <img src="${item.imageUrl}" alt="改图结果" loading="lazy">
          <span class="image-label">改图</span>
        </div>
        ${nsfwOverlayHtml}
      </div>
    `;
  } else {
    imageHtml = `
      <div class="card-image">
        <img src="${item.imageUrl}" alt="${escapeHtml(item.prompt)}" loading="lazy">
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
    downloadImage(item);
  });
  card.querySelector(".delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteItem(item.id);
  });

  return card;
}

function updateExportButton() {
  const exportBtn = document.getElementById("exportSelectedBtn");
  if (exportBtn) {
    const count = selectedItems.size;
    exportBtn.textContent = `导出选中 (${count})`;
    exportBtn.disabled = count === 0;
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
        const blob = await fetchBlobWithFallback(item.imageUrl);

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
            const originalBlob = await fetchBlobWithFallback(
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
          <div style="flex: 1; text-align: center;">
            <img src="${item.originalImageUrl}" style="width: 100%; border-radius: 8px; border: 1px solid #edf2f7;" alt="原图">
            <p style="margin-top: 8px; color: #718096; font-size: 13px;">原图</p>
          </div>
          <div style="font-size: 24px; color: #667eea;">→</div>
          <div style="flex: 1; text-align: center;">
            <img src="${item.imageUrl}" style="width: 100%; border-radius: 8px; border: 1px solid #edf2f7;" alt="改图结果">
            <p style="margin-top: 8px; color: #667eea; font-size: 13px; font-weight: 600;">✏️ 改图结果</p>
          </div>
        </div>
      `;
    } else {
      viewer.innerHTML = `<img id="modalImage" src="${item.imageUrl}" alt="预览图片" style="width: 100%; max-height: 60vh; object-fit: contain; display: block;">`;
    }
  }

  if (modalPrompt) modalPrompt.textContent = item.prompt;
  const opText = isEdit ? "✏️ 改图" : "🎨 生成";
  if (modalMeta)
    modalMeta.textContent = `${item.provider || "未知"} · ${opText} · ${formatDate(item.createdAt)}`;

  if (modal) modal.style.display = "flex";

  const copyBtn = document.getElementById("modalCopyBtn");
  if (copyBtn) copyBtn.onclick = () => copyImage(item);

  const downloadBtn = document.getElementById("modalDownloadBtn");
  if (downloadBtn) downloadBtn.onclick = () => downloadImage(item);
}

function closeModal() {
  const modal = document.getElementById("imageModal");
  if (modal) modal.style.display = "none";
}

async function copyImage(item) {
  try {
    // 如果是base64 URL，直接使用
    if (item.imageUrl.startsWith('data:')) {
      const response = await fetch(item.imageUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showNotification("图片已复制到剪贴板", "success");
      return;
    }

    // 对于普通URL，使用 canvas 方式复制图片，解决 blob URL 和跨域问题
    const img = new Image();
    img.crossOrigin = "anonymous";

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = item.imageUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // 尝试转换为 blob 并复制
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob failed"));
      }, "image/png");
    });

    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
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

function downloadImage(item) {
  const link = document.createElement("a");
  link.href = item.imageUrl;
  link.download = `ai-generated-${item.id}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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

function searchHistory(query) {
  if (!query.trim()) {
    filteredData = [...historyData];
  } else {
    const lowerQuery = query.toLowerCase();
    filteredData = historyData.filter((item) =>
      item.prompt.toLowerCase().includes(lowerQuery),
    );
  }
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
      searchHistory(query);
    });
  }

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        const query = searchInput.value;
        searchHistory(query);
      }
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
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function truncateText(text, maxLength) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

function formatDate(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;

  return date.toLocaleDateString("zh-CN");
}

function showNotification(message, type = "info") {
  const existing = document.querySelector(".notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.remove(), 3000);
}

async function fetchBlobWithFallback(url) {
  // 如果是base64 URL，直接转换为blob
  if (url.startsWith('data:')) {
    try {
      // 对于base64 URL，使用更可靠的转换方法
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Base64 fetch failed: ${response.status}`);
      }
      return await response.blob();
    } catch (error) {
      console.warn("Base64 URL fetch失败，尝试手动转换:", error);
      
      // 手动转换base64为blob的备用方法
      try {
        const [header, base64Data] = url.split(',');
        const mimeMatch = header.match(/data:([^;]+)/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
        
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
      } catch (manualError) {
        console.error("手动转换base64也失败:", manualError);
        throw error;
      }
    }
  }

  // 对于普通HTTP URL，使用原有逻辑
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Fetch failed");
    return await response.blob();
  } catch (error) {
    console.warn("直接下载失败, 尝试后台代理下载:", error);
    // Fallback to background fetch
    try {
      const response = await chrome.runtime.sendMessage({
        action: "fetchBlobBase64",
        url: url,
      });
      if (response && response.success && response.base64) {
        const res = await fetch(response.base64);
        return await res.blob();
      }
      throw new Error(response?.error || "后台下载失败");
    } catch (bgError) {
      throw error; // Throw original error or new one? Original might be more useful if background also failed.
    }
  }
}
