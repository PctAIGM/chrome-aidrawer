// AI画图助手 - 图片处理工具库
// 此文件包含所有图片相关的处理函数

/**
 * 复制图片到剪贴板
 * 支持base64和普通URL，自动处理跨域问题
 * @param {string} imageUrl - 图片URL（支持data:URL和http(s):URL）
 * @returns {Promise<void>}
 * @throws {Error} 复制失败时抛出错误
 */
export async function copyImageToClipboard(imageUrl) {
  try {
    // 如果是base64 URL，直接使用
    if (imageUrl.startsWith('data:')) {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return;
    }

    // 对于普通URL，使用 canvas 方式复制图片，解决 blob URL 和跨域问题
    const img = new Image();
    img.crossOrigin = "anonymous";

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // 转换为 blob 并复制
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob failed"));
      }, "image/png");
    });

    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch (error) {
    console.error("复制图片失败:", error);
    // 如果图片复制失败，尝试复制图片 URL
    try {
      await navigator.clipboard.writeText(imageUrl);
      console.log("已复制图片URL作为备选");
    } catch (e) {
      throw new Error("复制失败，请重试");
    }
  }
}

/**
 * 下载图片到本地
 * @param {string} imageUrl - 图片URL
 * @param {string} filename - 文件名（可选，默认使用时间戳）
 */
export function downloadImage(imageUrl, filename = null) {
  const link = document.createElement("a");
  link.href = imageUrl;
  link.download = filename || `ai-generated-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 获取图片的Blob对象，支持多种URL格式和失败重试
 * @param {string} url - 图片URL
 * @returns {Promise<Blob>} 图片的Blob对象
 * @throws {Error} 获取失败时抛出错误
 */
export async function fetchImageBlob(url) {
  // 如果是base64 URL，直接转换为blob
  if (url.startsWith('data:')) {
    try {
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

  // 对于普通HTTP URL
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
  } catch (error) {
    console.warn("直接下载失败, 尝试后台代理下载:", error);
    
    // 如果在Chrome扩展环境中，尝试使用后台代理
    if (typeof chrome !== 'undefined' && chrome.runtime) {
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
        console.error("后台代理下载也失败:", bgError);
      }
    }
    
    throw error;
  }
}

/**
 * 处理图片加载错误，显示错误提示
 * @param {HTMLImageElement} img - 图片元素
 * @param {string} type - 错误类型（用于日志）
 */
export function handleImageError(img, type) {
  console.log(`图片加载失败 (${type}):`, img.src);
  
  // 隐藏图片，显示错误提示
  img.style.display = 'none';

  // 找到对应的错误提示元素
  const container = img.closest('.image-container') || img.closest('.card-image') || img.closest('div');
  const errorDiv = container ? container.querySelector('.image-error, .modal-image-error') : null;

  if (errorDiv) {
    errorDiv.style.display = 'flex';
    errorDiv.style.flexDirection = 'column';
    errorDiv.style.alignItems = 'center';
    errorDiv.style.justifyContent = 'center';

    // 对于双图模式中的错误提示，确保样式正确
    const isDualImage = container.closest('.dual-image');
    if (isDualImage && errorDiv.classList.contains('image-error')) {
      // 双图模式下的特殊处理
      errorDiv.style.position = 'absolute';
      errorDiv.style.top = '0';
      errorDiv.style.left = '0';
      errorDiv.style.right = '0';
      errorDiv.style.bottom = '0';
      errorDiv.style.height = 'auto';
      errorDiv.style.minHeight = '120px';
      errorDiv.style.margin = '0';
      errorDiv.style.zIndex = '10';
      
      // 隐藏图片标签，避免遮挡按钮
      const imageLabel = container.querySelector('.image-label');
      if (imageLabel) {
        imageLabel.style.display = 'none';
      }
    } else if (errorDiv.classList.contains('image-error')) {
      // 单图模式下的处理
      errorDiv.style.height = '150px';
      errorDiv.style.backgroundColor = '#f8f9fa';
      errorDiv.style.border = '2px dashed #dee2e6';
      errorDiv.style.borderRadius = '8px';
      errorDiv.style.color = '#6c757d';
      errorDiv.style.fontSize = '12px';
      errorDiv.style.textAlign = 'center';
    }

    // 存储原始URL以便重试
    errorDiv.dataset.originalSrc = img.src;
    errorDiv.dataset.originalAlt = img.alt;
    
    console.log('显示错误提示');
  } else {
    console.error('未找到错误提示元素');
  }
}

/**
 * 重试加载图片
 * @param {HTMLButtonElement} button - 重试按钮元素
 */
export function retryLoadImage(button) {
  const errorDiv = button.closest('.image-error, .modal-image-error');
  const container = errorDiv.closest('.image-container') || errorDiv.closest('.card-image') || errorDiv.closest('div');
  const img = container.querySelector('img');

  if (errorDiv && img) {
    const originalSrc = errorDiv.dataset.originalSrc;
    const originalAlt = errorDiv.dataset.originalAlt;

    // 显示加载状态
    button.textContent = '加载中...';
    button.disabled = true;

    // 重新设置图片源
    img.onload = () => {
      // 加载成功，隐藏错误提示，显示图片
      errorDiv.style.display = 'none';
      img.style.display = 'block';
      button.textContent = '重试';
      button.disabled = false;
      
      // 如果是双图模式，恢复图片标签的显示
      const isDualImage = container.closest('.dual-image');
      if (isDualImage) {
        const imageLabel = container.querySelector('.image-label');
        if (imageLabel) {
          imageLabel.style.display = 'block';
        }
      }
    };

    img.onerror = () => {
      // 加载仍然失败
      button.textContent = '重试';
      button.disabled = false;

      // 显示更详细的错误信息
      const errorText = errorDiv.querySelector('.error-text');
      if (errorText) {
        errorText.textContent = '图片链接已失效';
      } else {
        // 对于模态框中的错误
        const errorTextEl = errorDiv.querySelector('div div:nth-child(2)');
        if (errorTextEl) {
          errorTextEl.textContent = '图片链接已彻底失效';
        }
      }
    };

    // 添加时间戳避免缓存
    const separator = originalSrc.includes('?') ? '&' : '?';
    img.src = originalSrc + separator + 't=' + Date.now();
  }
}

/**
 * 设置图片错误处理监听器
 * @param {HTMLImageElement} img - 图片元素
 * @param {string} errorType - 错误类型标识
 */
export function setupImageErrorHandling(img, errorType = 'default') {
  if (img.dataset.errorHandlerSetup) return; // 避免重复设置
  
  img.dataset.errorHandlerSetup = 'true';
  img.dataset.errorType = errorType;
  
  img.addEventListener('error', function () {
    console.log('图片错误事件触发:', this.src, this.dataset.errorType);
    handleImageError(this, this.dataset.errorType);
  });
  
  img.addEventListener('load', function () {
    console.log('图片加载成功:', this.src);
  });
  
  // 检查图片是否已经加载失败（对于已经在缓存中的404图片）
  if (img.complete && img.naturalWidth === 0) {
    console.log('检测到图片已经加载失败:', img.src, img.dataset.errorType);
    handleImageError(img, img.dataset.errorType);
  }
}

/**
 * 创建图片错误监听器（用于动态添加的图片）
 * @returns {MutationObserver} 返回观察器实例
 */
export function createImageErrorObserver() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // 检查节点本身是否是图片
          if (node.tagName === 'IMG') {
            setupImageErrorHandling(node);
          }
          // 检查节点内部的图片
          const images = node.querySelectorAll ? node.querySelectorAll('img') : [];
          images.forEach(img => setupImageErrorHandling(img));
        }
      });
    });
  });

  return observer;
}

/**
 * 将图片URL转换为Canvas
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<HTMLCanvasElement>} Canvas元素
 */
export async function imageUrlToCanvas(imageUrl) {
  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = imageUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  return canvas;
}

/**
 * 将Canvas转换为Blob
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @param {string} type - MIME类型，默认为image/png
 * @param {number} quality - 图片质量（0-1），仅对image/jpeg有效
 * @returns {Promise<Blob>} Blob对象
 */
export async function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas转换失败"));
    }, type, quality);
  });
}

/**
 * 压缩图片
 * @param {string} imageUrl - 图片URL
 * @param {number} maxWidth - 最大宽度
 * @param {number} maxHeight - 最大高度
 * @param {number} quality - 图片质量（0-1）
 * @returns {Promise<Blob>} 压缩后的Blob对象
 */
export async function compressImage(imageUrl, maxWidth = 1920, maxHeight = 1080, quality = 0.85) {
  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = imageUrl;
  });

  let width = img.naturalWidth;
  let height = img.naturalHeight;

  // 计算缩放比例
  if (width > maxWidth || height > maxHeight) {
    const ratio = Math.min(maxWidth / width, maxHeight / height);
    width = Math.floor(width * ratio);
    height = Math.floor(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  return canvasToBlob(canvas, 'image/jpeg', quality);
}

/**
 * 获取图片尺寸信息
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<{width: number, height: number, aspectRatio: number}>} 图片尺寸信息
 */
export async function getImageDimensions(imageUrl) {
  const img = new Image();
  img.crossOrigin = "anonymous";

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = imageUrl;
  });

  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    aspectRatio: img.naturalWidth / img.naturalHeight
  };
}

/**
 * 检查图片是否有效
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<boolean>} 图片是否有效
 */
export async function isImageValid(imageUrl) {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imageUrl;
    });

    return img.naturalWidth > 0 && img.naturalHeight > 0;
  } catch (error) {
    return false;
  }
}

/**
 * 预加载图片
 * @param {string[]} imageUrls - 图片URL数组
 * @returns {Promise<void>}
 */
export async function preloadImages(imageUrls) {
  const promises = imageUrls.map(url => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
  });

  await Promise.all(promises);
}
