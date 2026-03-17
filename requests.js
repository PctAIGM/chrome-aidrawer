// AI画图助手 - 请求管理页面脚本
import { showNotification, escapeHtml, truncateText, formatDate } from './lib/common.js';

let allRequests = [];
let filteredRequests = [];
let currentFilter = "all";
let searchQuery = "";
let currentDetailRequest = null;

// ==================== 密码保护功能 ====================

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
  if (!storedHash) return true;
  const inputHash = await hashPassword(inputPassword);
  return inputHash === storedHash;
}

/**
 * 检查是否需要密码验证
 * @returns {Promise<boolean>} 是否需要密码验证
 */
async function checkPasswordProtection() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const passwordHash = response.historyPasswordHash || "";
    return !!passwordHash;
  } catch (error) {
    console.error("检查密码保护状态失败:", error);
    return false;
  }
}

/**
 * 检查 sessionStorage 中的验证状态
 */
function isSessionVerified() {
  return sessionStorage.getItem("historyPasswordVerified") === "true";
}

/**
 * 设置验证状态
 */
function setSessionVerified() {
  sessionStorage.setItem("historyPasswordVerified", "true");
}

/**
 * 显示密码验证模态框
 */
function showPasswordModal() {
  const modal = document.getElementById("passwordModal");
  const container = document.querySelector(".container");

  if (modal) {
    modal.style.display = "flex";
    if (container) container.style.display = "none";
  }

  setupPasswordModalEventListeners();
}

/**
 * 隐藏密码验证模态框
 */
function hidePasswordModal() {
  const modal = document.getElementById("passwordModal");
  if (modal) {
    modal.style.display = "none";
  }
}

/**
 * 设置密码验证模态框的事件监听器
 */
function setupPasswordModalEventListeners() {
  const oldVerifyPasswordBtn = document.getElementById("verifyPasswordBtn");
  const oldVerifyPasswordInput = document.getElementById("verifyPasswordInput");
  const oldVerifyPasswordToggle = document.getElementById("verifyPasswordToggle");

  const savedInputValue = oldVerifyPasswordInput ? oldVerifyPasswordInput.value : "";

  if (oldVerifyPasswordBtn) {
    const newBtn = oldVerifyPasswordBtn.cloneNode(true);
    oldVerifyPasswordBtn.parentNode.replaceChild(newBtn, oldVerifyPasswordBtn);
  }
  if (oldVerifyPasswordInput) {
    const newInput = oldVerifyPasswordInput.cloneNode(true);
    oldVerifyPasswordInput.parentNode.replaceChild(newInput, oldVerifyPasswordInput);
  }
  if (oldVerifyPasswordToggle) {
    const newToggle = oldVerifyPasswordToggle.cloneNode(true);
    oldVerifyPasswordToggle.parentNode.replaceChild(newToggle, oldVerifyPasswordToggle);
  }

  const verifyPasswordBtn = document.getElementById("verifyPasswordBtn");
  const verifyPasswordInput = document.getElementById("verifyPasswordInput");
  const verifyPasswordToggle = document.getElementById("verifyPasswordToggle");

  if (verifyPasswordInput && savedInputValue) {
    verifyPasswordInput.value = savedInputValue;
  }

  if (verifyPasswordBtn) {
    verifyPasswordBtn.addEventListener("click", (e) => {
      e.preventDefault();
      verifyPasswordAndUnlock();
    });
  }

  if (verifyPasswordInput) {
    verifyPasswordInput.addEventListener("keyup", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        verifyPasswordAndUnlock();
      }
    });
  }

  if (verifyPasswordToggle) {
    verifyPasswordToggle.addEventListener("click", (e) => {
      e.preventDefault();
      if (verifyPasswordInput) {
        if (verifyPasswordInput.type === "password") {
          verifyPasswordInput.type = "text";
          verifyPasswordToggle.textContent = "🙈";
        } else {
          verifyPasswordInput.type = "password";
          verifyPasswordToggle.textContent = "👁️";
        }
      }
    });
  }

  if (verifyPasswordInput) {
    setTimeout(() => {
      verifyPasswordInput.focus();
    }, 0);
  }
}

/**
 * 验证密码并解锁
 */
async function verifyPasswordAndUnlock() {
  const passwordInput = document.getElementById("verifyPasswordInput");
  const password = passwordInput ? passwordInput.value : "";

  if (!password) {
    showVerifyPasswordMessage("请输入密码", "error");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ action: "getSettings" });
    const passwordHash = response.historyPasswordHash || "";
    const isCorrect = await verifyPassword(password, passwordHash);

    if (isCorrect) {
      setSessionVerified();
      hidePasswordModal();
      const container = document.querySelector(".container");
      if (container) container.style.display = "block";

      loadRequests();
      setupEventListeners();
      setupStorageListener();

      showVerifyPasswordMessage("", "");
    } else {
      showVerifyPasswordMessage("密码错误，请重试", "error");
      passwordInput.value = "";
      passwordInput.focus();
    }
  } catch (error) {
    console.error("密码验证失败:", error);
    showVerifyPasswordMessage("验证失败: " + error.message, "error");
  }
}

/**
 * 显示密码验证消息
 */
function showVerifyPasswordMessage(message, type = "info") {
  const el = document.getElementById("verifyPasswordMessage");
  if (!el) return;
  el.textContent = message;
  el.className = "password-message " + type;
}

document.addEventListener("DOMContentLoaded", () => {
  // 先检查是否已在当前会话中验证过
  if (isSessionVerified()) {
    loadRequests();
    setupEventListeners();
    setupStorageListener();
    return;
  }

  checkPasswordProtection().then((needsPassword) => {
    if (needsPassword) {
      showPasswordModal();
    } else {
      loadRequests();
      setupEventListeners();
      setupStorageListener();
    }
  });
});

// 监听存储变化，实时更新
function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && changes.requests) {
      loadRequests();
    }
  });
}

// 加载请求记录
async function loadRequests() {
  const loading = document.querySelector(".loading");
  if (loading) loading.style.display = "block";

  try {
    const response = await chrome.runtime.sendMessage({ action: "getRequests" });
    allRequests = response.requests || [];
    applyFilters();
  } catch (error) {
    console.error("加载请求记录失败:", error);
    showEmptyState();
  } finally {
    if (loading) loading.style.display = "none";
  }
}

// 应用筛选和搜索
function applyFilters() {
  let result = [...allRequests];

  // 状态筛选
  if (currentFilter !== "all") {
    result = result.filter(r => r.status === currentFilter);
  }

  // 搜索
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    result = result.filter(r =>
      r.request.prompt.toLowerCase().includes(query) ||
      r.request.providerName.toLowerCase().includes(query)
    );
  }

  filteredRequests = result;
  renderRequestList();
}

// 渲染请求列表
function renderRequestList() {
  const list = document.getElementById("requestList");
  const emptyState = document.getElementById("emptyState");
  const countEl = document.getElementById("requestCount");

  if (countEl) countEl.textContent = `${filteredRequests.length} 条记录`;

  if (filteredRequests.length === 0) {
    showEmptyState();
    return;
  }

  if (list) {
    list.style.display = "flex";
    list.innerHTML = "";

    filteredRequests.forEach(request => {
      const card = createRequestCard(request);
      list.appendChild(card);
    });
  }

  if (emptyState) emptyState.style.display = "none";
}

// 创建请求卡片
function createRequestCard(request) {
  const card = document.createElement("div");
  card.className = "request-card";
  card.dataset.id = request.id;

  const statusIcon = {
    pending: "🔵",
    success: "🟢",
    failed: "🔴",
  }[request.status];

  const statusText = {
    pending: "进行中",
    success: "成功",
    failed: "失败",
  }[request.status];

  const opTypeText = request.request.operationType === "edit" ? "✏️ 改图" : "🎨 生成";

  const duration = request.timing.duration
    ? formatDuration(request.timing.duration)
    : "-";

  let errorHtml = "";
  if (request.status === "failed" && request.response.error) {
    errorHtml = `
      <div class="request-error">
        ⚠️ ${escapeHtml(request.response.error)}
      </div>
    `;
  }

  card.innerHTML = `
    <div class="request-header">
      <span class="request-status ${request.status}">
        ${statusIcon} ${statusText}
      </span>
      <span class="request-meta">
        <span class="operation-tag ${request.request.operationType === "edit" ? "edit" : "generate"}">
          ${opTypeText}
        </span>
        <span class="provider-tag">${escapeHtml(request.request.providerName)}</span>
      </span>
      <span class="request-duration">${duration}</span>
      <span class="request-time">${formatDate(request.timing.startedAt)}</span>
    </div>
    <div class="request-prompt">${escapeHtml(truncateText(request.request.prompt, 100))}</div>
    ${errorHtml}
    <div class="request-actions">
      <button class="btn secondary detail-btn">查看详情</button>
      ${request.status === "failed" ? '<button class="btn primary retry-btn">重试</button>' : ""}
      <button class="btn danger delete-btn">删除</button>
    </div>
  `;

  // 事件绑定
  card.querySelector(".detail-btn").addEventListener("click", () => openDetailModal(request));
  
  const retryBtn = card.querySelector(".retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      retryRequest(request);
    });
  }

  card.querySelector(".delete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteRequest(request.id);
  });

  return card;
}

// 显示空状态
function showEmptyState() {
  const list = document.getElementById("requestList");
  const emptyState = document.getElementById("emptyState");
  
  if (list) list.style.display = "none";
  if (emptyState) emptyState.style.display = "flex";
}

// 格式化耗时
function formatDuration(ms) {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

// 打开详情模态框
function openDetailModal(request) {
  currentDetailRequest = request;
  const modal = document.getElementById("detailModal");
  
  // 状态
  const statusBadge = document.getElementById("detailStatus");
  const statusText = { pending: "进行中", success: "成功", failed: "失败" }[request.status];
  statusBadge.textContent = statusText;
  statusBadge.className = `status-badge ${request.status}`;

  // 操作类型
  document.getElementById("detailOperationType").textContent = 
    request.request.operationType === "edit" ? "✏️ 改图" : "🎨 生成";

  // 服务商
  document.getElementById("detailProvider").textContent = request.request.providerName;

  // 耗时
  document.getElementById("detailDuration").textContent = formatDuration(request.timing.duration);

  // 请求参数
  document.getElementById("detailRequest").innerHTML = `
    <div><strong>提示词：</strong>${escapeHtml(request.request.prompt)}</div>
    ${request.request.negativePrompt ? `<div><strong>反向提示词：</strong>${escapeHtml(request.request.negativePrompt)}</div>` : ""}
    ${request.request.imageUrl ? `<div><strong>原图：</strong><a href="${request.request.imageUrl}" target="_blank">查看</a></div>` : ""}
  `;

  // 耗时统计
  document.getElementById("detailTiming").innerHTML = `
    <div><strong>开始时间：</strong>${formatDate(request.timing.startedAt)}</div>
    <div><strong>完成时间：</strong>${request.timing.completedAt ? formatDate(request.timing.completedAt) : "-"}</div>
    <div><strong>总耗时：</strong>${formatDuration(request.timing.duration)}</div>
  `;

  // 请求详情
  const debugRequest = request.debug.requestBody || {};
  document.getElementById("detailDebugRequest").textContent = 
    JSON.stringify(debugRequest, null, 2);

  // 响应详情
  let debugResponse = {};
  if (request.status === "success") {
    debugResponse = request.debug.responseData || {};
  } else if (request.status === "failed") {
    debugResponse = { error: request.response.error };
  }
  document.getElementById("detailDebugResponse").textContent = 
    JSON.stringify(debugResponse, null, 2);

  // 重试按钮
  const retryBtn = document.getElementById("retryBtn");
  retryBtn.style.display = request.status === "failed" ? "inline-flex" : "none";

  modal.style.display = "flex";
}

// 关闭详情模态框
function closeDetailModal() {
  document.getElementById("detailModal").style.display = "none";
  currentDetailRequest = null;
}

// 重试请求
function retryRequest(request) {
  const params = new URLSearchParams({
    prompt: request.request.prompt,
    negativePrompt: request.request.negativePrompt || "",
    providerId: request.request.providerId,
    operationType: request.request.operationType,
  });
  chrome.tabs.create({ url: `popup.html?${params.toString()}` });
}

// 删除请求
async function deleteRequest(id) {
  if (!confirm("确定要删除这条请求记录吗？")) return;

  try {
    await chrome.runtime.sendMessage({ action: "deleteRequest", id });
    showNotification("删除成功", "success");
  } catch (error) {
    console.error("删除失败:", error);
    showNotification("删除失败", "error");
  }
}

// 清空所有请求
async function clearAllRequests() {
  if (!confirm("确定要清空所有请求记录吗？此操作不可恢复。")) return;

  try {
    await chrome.runtime.sendMessage({ action: "clearRequests" });
    showNotification("已清空所有记录", "success");
  } catch (error) {
    console.error("清空失败:", error);
    showNotification("清空失败", "error");
  }
}

// 复制调试信息
async function copyDebugInfo() {
  if (!currentDetailRequest) return;

  const debugInfo = {
    id: currentDetailRequest.id,
    status: currentDetailRequest.status,
    request: currentDetailRequest.request,
    debug: currentDetailRequest.debug,
    timing: currentDetailRequest.timing,
  };

  try {
    await navigator.clipboard.writeText(JSON.stringify(debugInfo, null, 2));
    showNotification("调试信息已复制", "success");
  } catch (error) {
    showNotification("复制失败", "error");
  }
}

// 导出 JSON
function exportJson() {
  if (!currentDetailRequest) return;

  const dataStr = JSON.stringify(currentDetailRequest, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.href = url;
  link.download = `request-${currentDetailRequest.id}.json`;
  link.click();
  
  URL.revokeObjectURL(url);
}

// 设置事件监听
function setupEventListeners() {
  // 筛选标签
  document.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.status;
      applyFilters();
    });
  });

  // 搜索
  document.getElementById("searchInput").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    applyFilters();
  });

  // 刷新
  document.getElementById("refreshBtn").addEventListener("click", loadRequests);

  // 清空全部
  document.getElementById("clearAllBtn").addEventListener("click", clearAllRequests);

  // 模态框关闭
  document.querySelector(".modal-close").addEventListener("click", closeDetailModal);
  document.getElementById("closeDetailBtn").addEventListener("click", closeDetailModal);
  
  window.addEventListener("click", (e) => {
    if (e.target.id === "detailModal") {
      closeDetailModal();
    }
  });

  // 详情操作
  document.getElementById("copyDebugBtn").addEventListener("click", copyDebugInfo);
  document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
  document.getElementById("retryBtn").addEventListener("click", () => {
    if (currentDetailRequest) {
      retryRequest(currentDetailRequest);
    }
  });
}
