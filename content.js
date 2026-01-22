// 监听来自后台的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSelection") {
    const selection = window.getSelection().toString().trim();
    sendResponse({ selectionText: selection });
  } else if (message.action === "imageLoading") {
    showMiniStatus("loading", { prompt: message.prompt });
  } else if (message.action === "imageLoadingUpdate") {
    showMiniStatus("loading", {
      prompt: message.prompt,
      status: message.status,
    });
  } else if (message.action === "imageError") {
    showMiniStatus("error", {
      error: message.error,
      prompt: message.prompt,
      debugData: message.debugData,
    });
  } else if (message.action === "imageGenerated") {
    showMiniStatus("success", {
      imageUrl: message.imageUrl,
      prompt: message.prompt,
      debugData: message.debugData,
    });
  } else if (message.action === "showEditDialog") {
    showEditDialog(message.imageUrl, message.providerId, message.providerName);
  }
});

// 在右下角显示小状态窗口
function showMiniStatus(state, data) {
  let container = document.getElementById("ai-draw-mini-status");
  if (!container) {
    container = document.createElement("div");
    container.id = "ai-draw-mini-status";
    container.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 999998;
      background: white; border-radius: 12px; padding: 12px 20px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      display: flex; align-items: center; gap: 12px; font-family: -apple-system, sans-serif;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid #edf2f7; cursor: default;
    `;
    document.body.appendChild(container);
  }

  const spinnerHtml = `<div class="ai-draw-mini-spinner" style="
    width: 20px; height: 20px; border: 2.5px solid #f3f3f3;
    border-top: 2.5px solid #667eea; border-radius: 50%;
    animation: ai-draw-spin 0.8s linear infinite;
  "></div>
  <style>@keyframes ai-draw-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>`;

  if (state === "loading") {
    const statusText = data.status
      ? `AI 正在创作中... (${data.status})`
      : "AI 正在创作中...";
    // 如果是更新状态且容器已存在，只更新文字
    const existingText = container.querySelector(".status-text");
    if (existingText && container.innerHTML.includes("ai-draw-mini-spinner")) {
      existingText.textContent = statusText;
    } else {
      container.innerHTML = `
          ${spinnerHtml}
          <span class="status-text" style="font-size: 14px; color: #4a5568; font-weight: 500;">${statusText}</span>
          <div id="ai-draw-mini-close" style="cursor: pointer; padding: 4px; color: #a0aec0; line-height: 1;">&times;</div>
        `;
    }
  } else if (state === "success") {
    container.style.borderLeft = "4px solid #48bb78";
    container.innerHTML = `
      <span style="font-size: 18px;">✨</span>
      <span style="font-size: 14px; color: #2d3748; font-weight: 500;">生成完成！</span>
      <button id="ai-draw-mini-open" style="
        background: #667eea; color: white; border: none; padding: 6px 14px;
        border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 500;
        transition: background 0.2s;
      ">预览</button>
      <div id="ai-draw-mini-close" style="cursor: pointer; padding: 4px; color: #a0aec0; line-height: 1;">&times;</div>
    `;
    document.getElementById("ai-draw-mini-open").onclick = async () => {
      await showResultModal(data.imageUrl, data.prompt, data.debugData);
      container.remove();
    };
  } else if (state === "error") {
    container.style.borderLeft = "4px solid #f56565";
    container.innerHTML = `
      <span style="font-size: 18px;">⚠️</span>
      <span style="font-size: 14px; color: #2d3748; font-weight: 500;">生成失败</span>
      <button id="ai-draw-mini-show-error" style="
        background: #fef2f2; color: #991b1b; border: 1px solid #fee2e2; padding: 6px 14px;
        border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 500;
      ">详情</button>
      <div id="ai-draw-mini-close" style="cursor: pointer; padding: 4px; color: #a0aec0; line-height: 1;">&times;</div>
    `;
    document.getElementById("ai-draw-mini-show-error").onclick = () => {
      showErrorModal(data.error, data.prompt, data.debugData);
      container.remove();
    };
  }

  const closeBtn = document.getElementById("ai-draw-mini-close");
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      container.remove();
    };
  }
}

// 在当前页面显示加载状态 (保留作为备用或全屏模式)
function showLoadingModal(prompt) {
  // 现在默认使用 showMiniStatus('loading')，如果需要全屏加载可以在这里实现
}

// 在当前页面显示错误状态
function showErrorModal(error, prompt, debugData) {
  const buttons = [{ id: "ai-draw-close", text: "关闭", class: "primary" }];
  if (debugData) {
    buttons.unshift({
      id: "ai-draw-debug",
      text: "🐞 调试",
      class: "secondary",
    });
  }

  createModal({
    title: "⚠️ 生成失败",
    content: `<div style="padding: 10px 0; color: #e53e3e; font-size: 14px; text-align: left; background: #fff5f5; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
      <strong>错误详情:</strong><br>${error}
    </div>`,
    prompt: prompt,
    buttons: buttons,
    debugData: debugData,
  });
}

// 通用模态框创建逻辑
function createModal({ title, content, prompt, buttons, debugData }) {
  // 移除已有的模态框
  const existing = document.getElementById("ai-draw-modal-container");
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.id = "ai-draw-modal-container";
  container.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 999999;
    padding: 20px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: white; padding: 24px; border-radius: 16px;
    max-width: 500px; width: 100%; max-height: 85vh; overflow-y: auto;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    position: relative; text-align: center;
  `;

  let buttonsHtml = buttons
    .map(
      (btn) => `
    <button id="${btn.id}" style="
      padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s;
      ${btn.class === "primary" ? "background: #667eea; color: white; border: none;" : "background: #f3f4f6; color: #333; border: 1px solid #ddd;"}
    " ${btn.title ? `title="${btn.title}"` : ""}>${btn.text}</button>
  `,
    )
    .join("");

  modal.innerHTML = `
    <div style="font-weight: bold; font-size: 20px; margin-bottom: 20px; color: #1a202c;">${title}</div>
    <div style="margin-bottom: 16px;">${content}</div>

    <div id="ai-draw-prompt-container" style="margin-bottom: 24px;">
      <div id="ai-draw-prompt-toggle" style="
        font-size: 13px; color: #667eea; cursor: pointer; margin-bottom: 8px;
        display: flex; align-items: center; justify-content: center; gap: 4px;
      ">
        <span id="ai-draw-prompt-icon">👁️‍🗨️</span> 显示/隐藏提示词
      </div>
      <div id="ai-draw-prompt-text" style="
        font-size: 14px; color: #718096; line-height: 1.5; font-style: italic;
        background: #f8fafc; padding: 12px; border-radius: 8px; display: none;
        text-align: left; word-break: break-all;
      ">
        "${prompt}"
      </div>
    </div>

    <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; position: sticky; bottom: 0; background: white; padding-top: 12px; margin-top: -8px;">
      ${buttonsHtml}
    </div>
  `;

  container.appendChild(modal);
  document.body.appendChild(container);

  // 绑定折叠逻辑
  const toggle = document.getElementById("ai-draw-prompt-toggle");
  const promptText = document.getElementById("ai-draw-prompt-text");
  if (toggle && promptText) {
    toggle.onclick = () => {
      const isHidden = promptText.style.display === "none";
      promptText.style.display = isHidden ? "block" : "none";
      // 自动滚动到按钮区域
      if (isHidden) {
        setTimeout(() => (modal.scrollTop = modal.scrollHeight), 50);
      }
    };
  }

  // 绑定基础关闭事件
  const closeBtn = document.getElementById("ai-draw-close");
  if (closeBtn) closeBtn.onclick = () => container.remove();

  // 绑定调试按钮
  const debugBtn = document.getElementById("ai-draw-debug");
  if (debugBtn && debugData) {
    debugBtn.onclick = () => showDebugModal(debugData);
  }

  // 点击背景关闭
  container.onclick = (e) => {
    if (e.target === container) container.remove();
  };

  return { container, modal };
}

// 在当前页面显示生成结果的模态框
async function showResultModal(imageUrl, prompt, debugData) {
  const { settings } = await chrome.storage.local.get("settings");
  const allowNSFW = !!settings?.allowNSFW;

  const buttons = [
    { id: "ai-draw-copy", text: "复制图片", class: "primary" },
    { id: "ai-draw-download", text: "下载", class: "secondary" },
    { id: "ai-draw-close", text: "关闭", class: "secondary" },
  ];
  
  // 检查是否有上传服务，添加分享按钮
  const uploadServices = settings?.imageUploadServices || [];
  const hasActiveUploadService = uploadServices.some(service => service.isActive);
  if (hasActiveUploadService) {
    buttons.splice(2, 0, { id: "ai-draw-share", text: "🔗", class: "secondary", title: "分享到相册" });
  }
  
  if (debugData) {
    buttons.unshift({
      id: "ai-draw-debug",
      text: "🐞 调试",
      class: "secondary",
    });
  }

  const imgHtml = `
    <div id="ai-draw-image-wrapper" style="position: relative; margin-bottom: 20px; cursor: pointer; overflow: hidden; border-radius: 12px; line-height: 0;">
      <img id="ai-draw-result-img" src="${imageUrl}" style="
        width: 100%; border-radius: 12px; border: 1px solid #edf2f7;
        transition: filter 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        ${!allowNSFW ? "filter: blur(40px);" : ""}
      ">
      ${!allowNSFW
      ? `
        <div id="ai-draw-nsfw-overlay" style="
          position: absolute; top:0; left:0; width:100%; height:100%;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.15); color: white; text-shadow: 0 2px 8px rgba(0,0,0,0.5);
          font-size: 14px; font-weight: 600; pointer-events: none;
          backdrop-filter: blur(4px);
        ">
          <span style="font-size: 32px; margin-bottom: 12px;">🔞</span>
          <div style="background: rgba(0,0,0,0.4); padding: 8px 16px; border-radius: 20px;">点击查看风险内容</div>
        </div>
      `
      : ""
    }
    </div>
  `;

  const { container } = createModal({
    title: "🖼️ 生成成功",
    content: imgHtml,
    prompt: prompt,
    buttons: buttons,
    debugData: debugData,
  });

  // 绑定图片点击揭示逻辑
  const wrapper = document.getElementById("ai-draw-image-wrapper");
  const img = document.getElementById("ai-draw-result-img");
  const overlay = document.getElementById("ai-draw-nsfw-overlay");

  if (wrapper && !allowNSFW) {
    wrapper.onclick = (e) => {
      e.stopPropagation();
      const isBlurred = img.style.filter.includes("blur");
      if (isBlurred) {
        img.style.filter = "none";
        if (overlay) overlay.style.display = "none";
      } else {
        img.style.filter = "blur(40px)";
        if (overlay) overlay.style.display = "flex";
      }
    };
  }

  // 额外按钮绑定
  const copyBtn = document.getElementById("ai-draw-copy");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const btn = copyBtn;
      const originalText = btn.textContent;

      try {
        btn.textContent = "⌛ 正在准备...";

        // 使用现代 ClipboardItem 构造函数，支持直接传入 Promise
        // 这样可以确保在用户点击的“活跃时间”内就触发了写入
        const clipboardPromise = (async () => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = imageUrl;

          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error("图片加载失败"));
          });

          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);

          return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error("转换失败"));
            }, "image/png");
          });
        })();

        // 核心修复：直接传入包含 Promise 的 ClipboardItem
        await navigator.clipboard.write([
          new ClipboardItem({
            "image/png": clipboardPromise,
          }),
        ]);

        btn.textContent = "✅ 已复制";
        setTimeout(() => (btn.textContent = originalText), 2000);
      } catch (e) {
        console.error("复制失败:", e);
        btn.textContent = "❌ 复制失败";
        setTimeout(() => (btn.textContent = originalText), 2000);
        alert(
          "由于浏览器限制，复制图片失败。尝试：\n1. 直接右键点击图片选择“复制图片”\n2. 点击“下载”按钮保存到本地",
        );
      }
    };
  }

  const downloadBtn = document.getElementById("ai-draw-download");
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      // 使用浏览器默认下载功能
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = `ai-generated-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // 显示下载提示
      const btn = downloadBtn;
      const originalText = btn.textContent;
      btn.textContent = "✅ 已下载";
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    };
  }

  // 分享按钮绑定
  const shareBtn = document.getElementById("ai-draw-share");
  if (shareBtn) {
    shareBtn.onclick = () => {
      const btn = shareBtn;
      const originalText = btn.textContent;
      btn.textContent = "⏳";
      btn.disabled = true;

      chrome.runtime.sendMessage({
        action: "uploadImageToAlbum",
        imageUrl: imageUrl,
        prompt: prompt
      }).then((res) => {
        if (res && res.success) {
          btn.textContent = "✅";
          btn.style.background = "#48bb78";
          btn.style.color = "white";
          setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = "";
            btn.style.color = "";
            btn.disabled = false;
          }, 2000);
        } else {
          btn.textContent = "❌";
          btn.style.background = "#f56565";
          btn.style.color = "white";
          setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = "";
            btn.style.color = "";
            btn.disabled = false;
          }, 2000);
        }
      }).catch((error) => {
        console.error('分享失败:', error);
        btn.textContent = "❌";
        btn.style.background = "#f56565";
        btn.style.color = "white";
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = "";
          btn.style.color = "";
          btn.disabled = false;
        }, 2000);
      });
    };
  }
}

// 显示调试信息模态框
function showDebugModal(debugData) {
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.8); z-index: 9999999;
    display: flex; align-items: center; justify-content: center;
    font-family: monospace;
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: #1e1e1e; color: #d4d4d4; padding: 24px; border-radius: 12px;
    max-width: 800px; width: 90%; max-height: 80%; overflow-y: auto;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    position: relative; text-align: left; font-size: 13px; line-height: 1.5;
  `;

  const safeJson = (data) => JSON.stringify(data, null, 2) || "null";

  modal.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #333; padding-bottom: 10px;">
      <span style="font-weight: bold; font-size: 16px; color: #569cd6;">🐞 API 调试信息 (${debugData.providerName || "未知服务商"})</span>
      <button id="ai-debug-close" style="background: transparent; border: 1px solid #444; color: #999; cursor: pointer; padding: 4px 12px; border-radius: 4px;">关闭</button>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="color: #ce9178; margin-bottom: 4px;">// Request Body</div>
      <pre style="background: #252526; padding: 12px; border-radius: 6px; overflow-x: auto;">${safeJson(debugData.request)}</pre>
    </div>

    <div>
      <div style="color: #ce9178; margin-bottom: 4px;">// Response Data</div>
      <pre style="background: #252526; padding: 12px; border-radius: 6px; overflow-x: auto;">${safeJson(debugData.response)}</pre>
    </div>
  `;

  container.appendChild(modal);
  document.body.appendChild(container);

  document.getElementById("ai-debug-close").onclick = () => container.remove();
  container.onclick = (e) => {
    if (e.target === container) container.remove();
  };
}

// 显示改图对话框
function showEditDialog(imageUrl, providerId, providerName) {
  // 移除已有的对话框
  const existing = document.getElementById("ai-draw-edit-modal");
  if (existing) existing.remove();

  const container = document.createElement("div");
  container.id = "ai-draw-edit-modal";
  container.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 999999;
    padding: 20px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
  `;

  const modal = document.createElement("div");
  modal.style.cssText = `
    background: white; padding: 32px; border-radius: 16px;
    max-width: 500px; width: 100%; max-height: 85vh; overflow-y: auto;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
    position: relative;
  `;

  // 根据是否有图片URL决定显示内容
  const imagePreviewHtml = imageUrl 
    ? `
      <div id="ai-edit-image-preview" style="position: relative; margin-bottom: 16px;">
        <img src="${imageUrl}" style="width: 100%; max-height: 180px; object-fit: contain; border-radius: 8px; border: 1px solid #e2e8f0;" alt="预览图片">
        <div style="display: flex; gap: 8px; margin-top: 8px; justify-content: center;">
          <input type="file" id="ai-edit-file-input" accept="image/*" style="display: none;">
          <button id="ai-edit-select-btn" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #e2e8f0; background: #f7fafc; color: #4a5568; font-size: 13px; cursor: pointer;">📁 选择图片</button>
          <button id="ai-edit-reupload-btn" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #667eea; background: #667eea; color: white; font-size: 13px; cursor: pointer;">📤 上传到图床</button>
        </div>
        <div id="ai-edit-upload-status" style="display: none; margin-top: 8px; padding: 8px; border-radius: 6px; font-size: 14px;"></div>
      </div>
    `
    : '';

  const imageSelectHtml = !imageUrl 
    ? `
      <div id="ai-edit-image-select" style="margin-bottom: 16px;">
        <label style="display: block; color: #4a5568; font-size: 14px; font-weight: 500; margin-bottom: 8px;">选择图片</label>
        <div style="display: flex; gap: 12px; align-items: center;">
          <input type="file" id="ai-edit-file-input" accept="image/*" style="flex: 1; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px;">
          <button id="ai-edit-upload-btn" style="padding: 8px 16px; border-radius: 6px; border: none; background: #667eea; color: white; font-size: 14px; cursor: pointer; white-space: nowrap;">上传图片</button>
        </div>
        <div id="ai-edit-upload-status" style="display: none; margin-top: 8px; padding: 8px; border-radius: 6px; font-size: 14px;"></div>
      </div>
    `
    : '';

  modal.innerHTML = `
    <div style="font-weight: bold; font-size: 20px; margin-bottom: 8px; color: #1a202c; display: flex; align-items: center; gap: 8px;">
      ✏️ 改图
    </div>
    <div style="color: #718096; font-size: 14px; margin-bottom: 20px;">
      使用 ${providerName} 编辑图片
    </div>

    ${imagePreviewHtml}
    ${imageSelectHtml}

    <div style="margin-bottom: 16px;">
      <label style="display: block; color: #4a5568; font-size: 14px; font-weight: 500; margin-bottom: 8px;">改图提示词</label>
      <textarea id="ai-edit-prompt" placeholder="例如：将背景改为蓝色、添加一只猫、移除文字等..." style="
        width: 100%; padding: 12px; border: 2px solid #e2e8f0; border-radius: 8px;
        font-size: 14px; font-family: inherit; resize: vertical; min-height: 100px;
        transition: border-color 0.2s; box-sizing: border-box; color: #1a202c;
      "></textarea>
    </div>

    <div id="ai-edit-error" style="display: none; background: #fff5f5; border: 1px solid #feb2b2; color: #c53030; padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px;"></div>

    <div style="display: flex; gap: 12px; justify-content: flex-end;">
      <button id="ai-edit-debug" style="display: none; margin-right: auto; padding: 12px 24px; border-radius: 8px; border: 1px solid #cbd5e0; background: #f7fafc; color: #4a5568; font-size: 14px; font-weight: 500; cursor: pointer;">🐞 调试</button>
      <button id="ai-edit-cancel" style="padding: 12px 24px; border-radius: 8px; border: 1px solid #e2e8f0; background: #f7fafc; color: #4a5568; font-size: 14px; font-weight: 500; cursor: pointer;">取消</button>
      <button id="ai-edit-submit" style="padding: 12px 24px; border-radius: 8px; border: none; background: #667eea; color: white; font-size: 14px; font-weight: 500; cursor: pointer;">开始改图</button>
    </div>
  `;

  container.appendChild(modal);
  document.body.appendChild(container);

  const promptInput = modal.querySelector("#ai-edit-prompt");
  const submitBtn = modal.querySelector("#ai-edit-submit");
  const cancelBtn = modal.querySelector("#ai-edit-cancel");
  const debugBtn = modal.querySelector("#ai-edit-debug");
  const errorDiv = modal.querySelector("#ai-edit-error");
  const fileInput = modal.querySelector("#ai-edit-file-input");
  const uploadBtn = modal.querySelector("#ai-edit-upload-btn");
  const selectBtn = modal.querySelector("#ai-edit-select-btn");
  const reuploadBtn = modal.querySelector("#ai-edit-reupload-btn");
  const uploadStatus = modal.querySelector("#ai-edit-upload-status");

  let debugData = null;
  let messageHandler = null;
  let currentImageUrl = imageUrl; // 当前使用的图片URL

  // 聚焦输入框
  setTimeout(() => promptInput.focus(), 100);

  // 阻止modal内部点击事件冒泡
  modal.onclick = (e) => {
    e.stopPropagation();
  };

  // 图片上传功能（初次上传）
  if (uploadBtn && fileInput) {
    uploadBtn.onclick = () => handleLocalImageUpload();
  }

  // 选择本地图片功能
  if (selectBtn && fileInput) {
    selectBtn.onclick = () => {
      fileInput.click();
    };
    
    fileInput.onchange = () => {
      if (fileInput.files[0]) {
        handleLocalImageUpload();
      }
    };
  }

  // 上传当前图片到图床功能
  if (reuploadBtn) {
    reuploadBtn.onclick = () => handleCurrentImageUpload();
  }

  // 处理本地图片上传
  async function handleLocalImageUpload() {
    const file = fileInput.files[0];
    if (!file) {
      showUploadStatus('请先选择图片文件', 'error');
      return;
    }

    if (!file.type.startsWith('image/')) {
      showUploadStatus('请选择图片文件', 'error');
      return;
    }

    const activeBtn = uploadBtn || selectBtn;
    const originalText = activeBtn.textContent;
    activeBtn.disabled = true;
    activeBtn.textContent = '上传中...';
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
        
        // 更新预览图片
        updateImagePreview(currentImageUrl);
        
        showUploadStatus('图片上传成功！', 'success');
      } else {
        throw new Error(result.error || '上传失败');
      }
    } catch (error) {
      console.error('图片上传失败:', error);
      showUploadStatus('上传失败: ' + error.message, 'error');
    } finally {
      activeBtn.disabled = false;
      activeBtn.textContent = originalText;
    }
  }

  // 处理当前图片上传到图床
  async function handleCurrentImageUpload() {
    if (!currentImageUrl) {
      showUploadStatus('没有可上传的图片', 'error');
      return;
    }

    const originalText = reuploadBtn.textContent;
    reuploadBtn.disabled = true;
    reuploadBtn.textContent = '上传中...';
    hideUploadStatus();

    try {
      // 获取当前图片的base64数据
      let imageData;
      
      if (currentImageUrl.startsWith('data:')) {
        // 如果已经是base64格式，直接使用
        imageData = currentImageUrl;
      } else {
        // 如果是URL，需要先下载转换为base64
        const response = await fetch(currentImageUrl);
        const blob = await response.blob();
        imageData = await blobToBase64(blob);
      }
      
      const result = await chrome.runtime.sendMessage({
        action: 'uploadImage',
        imageData: imageData,
        fileName: 'current-image.png'
      });

      if (result.success) {
        currentImageUrl = result.imageUrl;
        
        // 更新预览图片
        updateImagePreview(currentImageUrl);
        
        showUploadStatus('图片已上传到图床！', 'success');
      } else {
        throw new Error(result.error || '上传失败');
      }
    } catch (error) {
      console.error('图片上传失败:', error);
      showUploadStatus('上传失败: ' + error.message, 'error');
    } finally {
      reuploadBtn.disabled = false;
      reuploadBtn.textContent = originalText;
    }
  }

  // 更新图片预览
  function updateImagePreview(newImageUrl) {
    if (imageUrl) {
      // 如果原来有图片，更新预览区域
      const previewDiv = modal.querySelector('#ai-edit-image-preview');
      if (previewDiv) {
        const img = previewDiv.querySelector('img');
        if (img) {
          img.src = newImageUrl;
        }
      }
    } else {
      // 如果原来没有图片，创建预览区域并替换文件选择区域
      const imageSelectDiv = modal.querySelector('#ai-edit-image-select');
      if (imageSelectDiv) {
        imageSelectDiv.innerHTML = `
          <div style="position: relative;">
            <img src="${newImageUrl}" style="width: 100%; max-height: 180px; object-fit: contain; border-radius: 8px; border: 1px solid #e2e8f0;" alt="预览图片">
            <div style="display: flex; gap: 8px; margin-top: 8px; justify-content: center;">
              <input type="file" id="ai-edit-file-input-new" accept="image/*" style="display: none;">
              <button id="ai-edit-select-btn-new" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #e2e8f0; background: #f7fafc; color: #4a5568; font-size: 13px; cursor: pointer;">📁 选择图片</button>
              <button id="ai-edit-reupload-btn-new" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #667eea; background: #667eea; color: white; font-size: 13px; cursor: pointer;">📤 上传到图床</button>
            </div>
          </div>
        `;
        
        // 重新绑定新的按钮
        const newFileInput = modal.querySelector('#ai-edit-file-input-new');
        const newSelectBtn = modal.querySelector('#ai-edit-select-btn-new');
        const newReuploadBtn = modal.querySelector('#ai-edit-reupload-btn-new');
        
        if (newSelectBtn && newFileInput) {
          newSelectBtn.onclick = () => {
            newFileInput.click();
          };
          
          newFileInput.onchange = () => {
            if (newFileInput.files[0]) {
              // 更新全局fileInput引用
              fileInput.files = newFileInput.files;
              handleLocalImageUpload();
            }
          };
        }
        
        if (newReuploadBtn) {
          newReuploadBtn.onclick = () => handleCurrentImageUpload();
        }
      }
    }
  }

  // 显示上传状态
  function showUploadStatus(message, type = 'info') {
    if (uploadStatus) {
      uploadStatus.textContent = message;
      uploadStatus.className = type === 'error' ? 'error-status' : 'success-status';
      uploadStatus.style.cssText = `
        display: block; margin-top: 8px; padding: 8px; border-radius: 6px; font-size: 14px;
        ${type === 'error' 
          ? 'background: #fff5f5; border: 1px solid #feb2b2; color: #c53030;'
          : 'background: #f0fff4; border: 1px solid #9ae6b4; color: #2f855a;'
        }
      `;
    }
  }

  // 隐藏上传状态
  function hideUploadStatus() {
    if (uploadStatus) {
      uploadStatus.style.display = 'none';
    }
  }

  // 提交
  submitBtn.onclick = async () => {
    const prompt = promptInput.value.trim();

    errorDiv.style.display = "none";
    debugBtn.style.display = "none";
    debugData = null;

    if (!prompt) {
      errorDiv.textContent = "请输入改图提示词";
      errorDiv.style.display = "block";
      return;
    }

    if (!currentImageUrl) {
      errorDiv.textContent = "请先选择并上传图片";
      errorDiv.style.display = "block";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "处理中...";

    const timeout = setTimeout(() => {
      errorDiv.textContent = "改图请求超时，请检查网络连接或服务商配置";
      errorDiv.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "开始改图";
    }, 60000);

    // 监听改图结果
    messageHandler = (request) => {
      if (request.action === "imageGenerated") {
        clearTimeout(timeout);
        if (request.debugData) debugData = request.debugData;
        submitBtn.textContent = "改图成功！";
        setTimeout(() => container.remove(), 500);
      } else if (request.action === "imageError") {
        clearTimeout(timeout);
        if (request.debugData) {
          debugData = request.debugData;
          debugBtn.style.display = "inline-block";
        }
        errorDiv.textContent = request.error || "改图失败";
        errorDiv.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "开始改图";
      }
    };

    chrome.runtime.onMessage.addListener(messageHandler);

    try {
      await chrome.runtime.sendMessage({
        action: "editImage",
        prompt: prompt,
        imageUrl: currentImageUrl,
        providerId: providerId,
      });
    } catch (error) {
      clearTimeout(timeout);
      errorDiv.textContent = "发送请求失败: " + error.message;
      errorDiv.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "开始改图";
      if (messageHandler) {
        chrome.runtime.onMessage.removeListener(messageHandler);
      }
    }
  };

  // 调试
  debugBtn.onclick = () => {
    if (debugData) {
      showDebugModal(debugData);
    }
  };

  // 取消
  cancelBtn.onclick = () => {
    if (messageHandler) {
      chrome.runtime.onMessage.removeListener(messageHandler);
    }
    container.remove();
  };

  // 回车提交
  promptInput.onkeydown = (e) => {
    if (e.key === "Enter" && e.ctrlKey) {
      submitBtn.click();
    }
  };

  // 点击背景关闭
  container.onclick = (e) => {
    if (e.target === container) {
      if (messageHandler) {
        chrome.runtime.onMessage.removeListener(messageHandler);
      }
      container.remove();
    }
  };
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

// 将blob转换为base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
