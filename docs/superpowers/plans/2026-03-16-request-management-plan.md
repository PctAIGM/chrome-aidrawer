# 请求管理功能实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 画图助手增加独立的请求管理功能，记录所有 API 请求的完整生命周期。

**Architecture:** 创建独立页面 requests.html，在 background.js 中增加请求记录逻辑，使用 chrome.storage.local 独立存储请求记录，自动清理过期数据。

**Tech Stack:** Vanilla JavaScript, Chrome Extension Manifest V3, Chrome Storage API

**Note:** 由于 Service Worker 不支持 ES6 模块导入，所有请求管理函数直接定义在 background.js 中。

---

## 文件结构

```
新增文件：
├── requests.html              # 请求管理页面
├── requests.js                # 页面逻辑
├── styles/requests.css        # 页面样式

修改文件：
├── background.js              # 增加请求记录逻辑和工具函数
├── manifest.json              # 注册新页面
├── history.html               # 添加跳转链接
├── popup.js                   # 支持 URL 参数预填充
```

---

## Chunk 1: 后台脚本集成

### Task 1.1: 在 background.js 中添加请求记录工具函数

**Files:**
- Modify: `background.js`

- [ ] **Step 1: 在 background.js 文件开头添加请求记录工具函数**

在 `// AI画图助手 - 后台脚本` 注释之后、`const MAX_HISTORY_ITEMS` 常量之前添加：

```javascript
// ==================== 请求记录工具函数 ====================

/**
 * 创建请求记录
 */
function createRequestRecord(params) {
  const { prompt, negativePrompt, provider, imageUrl, operationType, endpoint } = params;
  
  return {
    id: `req_${Date.now()}`,
    status: "pending",
    request: {
      prompt: prompt || "",
      negativePrompt: negativePrompt || "",
      operationType: operationType || "generate",
      providerId: provider?.id || "",
      providerName: provider?.name || "未知",
      imageUrl: imageUrl || null,
    },
    response: {
      imageUrl: null,
      responseData: null,
      error: null,
    },
    debug: {
      requestBody: null,
      requestHeaders: {},
      responseData: null,
      endpoint: endpoint || "",
    },
    timing: {
      startedAt: new Date().toISOString(),
      completedAt: null,
      duration: null,
    },
  };
}

/**
 * 脱敏请求头
 */
function sanitizeRequestHeaders(headers) {
  const sanitized = { ...headers };
  const sensitiveKeys = ["Authorization", "authorization", "X-API-Key", "api-key"];
  for (const key of sensitiveKeys) {
    if (sanitized[key]) {
      const value = String(sanitized[key]);
      if (value.length > 20) {
        sanitized[key] = value.substring(0, 20) + "...[已脱敏]";
      }
    }
  }
  return sanitized;
}

/**
 * 清理孤立的 pending 请求
 */
async function cleanupOrphanedRequests() {
  try {
    const { requests = [] } = await chrome.storage.local.get("requests");
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let updated = false;
    const cleaned = requests.map(r => {
      if (r.status === "pending" && new Date(r.timing.startedAt) < oneHourAgo) {
        updated = true;
        return {
          ...r,
          status: "failed",
          response: { ...r.response, error: "请求中断（可能是浏览器关闭或扩展更新）" },
          timing: { ...r.timing, completedAt: new Date().toISOString() },
        };
      }
      return r;
    });
    if (updated) {
      await chrome.storage.local.set({ requests: cleaned });
    }
  } catch (error) {
    console.error("清理孤立请求失败:", error);
  }
}

/**
 * 处理存储配额超限
 * 当存储失败时，清理最早的记录，保留最近 50 条作为最低保障
 */
async function handleStorageQuotaExceeded() {
  try {
    const { requests = [] } = await chrome.storage.local.get("requests");
    if (requests.length <= 50) return; // 最低保障，不清理
    
    // 保留最近的 50 条记录
    const reduced = requests.slice(0, 50);
    await chrome.storage.local.set({ requests: reduced });
    console.log(`存储配额超限，已清理 ${requests.length - 50} 条旧记录`);
  } catch (error) {
    console.error("处理存储配额超限失败:", error);
  }
}

/**
 * 保存请求记录（带配额处理）
 */
async function saveRequestRecord(record) {
  try {
    const { requests = [] } = await chrome.storage.local.get("requests");
    requests.unshift(record);
    await chrome.storage.local.set({ requests });
  } catch (error) {
    if (error.message && error.message.includes("quota")) {
      console.warn("请求记录存储配额超限，尝试清理...");
      await handleStorageQuotaExceeded();
      // 重试保存
      try {
        const { requests = [] } = await chrome.storage.local.get("requests");
        requests.unshift(record);
        await chrome.storage.local.set({ requests });
      } catch (retryError) {
        console.error("重试保存失败:", retryError);
      }
    } else {
      console.error("保存请求记录失败:", error);
    }
  }
}

/**
 * 更新请求记录
 */
async function updateRequestRecord(id, updates) {
  try {
    const { requests = [] } = await chrome.storage.local.get("requests");
    const index = requests.findIndex(r => r.id === id);
    if (index !== -1) {
      requests[index] = { ...requests[index], ...updates };
      await chrome.storage.local.set({ requests });
    }
  } catch (error) {
    console.error("更新请求记录失败:", error);
  }
}

/**
 * 删除请求记录
 */
async function deleteRequestRecord(id) {
  const { requests = [] } = await chrome.storage.local.get("requests");
  const filtered = requests.filter(r => r.id !== id);
  await chrome.storage.local.set({ requests: filtered });
}

/**
 * 清理过期请求记录
 */
async function cleanupOldRequests() {
  try {
    const { settings } = await chrome.storage.local.get("settings");
    const retentionDays = settings?.requestRetentionDays || 7;
    const { requests = [] } = await chrome.storage.local.get("requests");
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const filtered = requests.filter(r => new Date(r.timing.startedAt) >= cutoffDate);
    await chrome.storage.local.set({ requests: filtered });
  } catch (error) {
    console.error("清理过期请求记录失败:", error);
  }
}

/**
 * 清理孤立的 pending 请求
 */
async function cleanupOrphanedRequests() {
  try {
    const { requests = [] } = await chrome.storage.local.get("requests");
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let updated = false;
    const cleaned = requests.map(r => {
      if (r.status === "pending" && new Date(r.timing.startedAt) < oneHourAgo) {
        updated = true;
        return {
          ...r,
          status: "failed",
          response: { ...r.response, error: "请求中断（可能是浏览器关闭或扩展更新）" },
          timing: { ...r.timing, completedAt: new Date().toISOString() },
        };
      }
      return r;
    });
    if (updated) {
      await chrome.storage.local.set({ requests: cleaned });
    }
  } catch (error) {
    console.error("清理孤立请求失败:", error);
  }
}

/**
 * 处理存储配额超限
 * 当存储失败时，清理最早的记录，保留最近 50 条作为最低保障
 */
async function handleStorageQuotaExceeded() {
  try {
    const { requests = [] } = await chrome.storage.local.get("requests");
    if (requests.length <= 50) return; // 最低保障，不清理
    
    // 保留最近的 50 条记录
    const reduced = requests.slice(0, 50);
    await chrome.storage.local.set({ requests: reduced });
    console.log(`存储配额超限，已清理 ${requests.length - 50} 条旧记录`);
  } catch (error) {
    console.error("处理存储配额超限失败:", error);
  }
}

// ==================== 原有代码 ====================
```

- [ ] **Step 2: 在 chrome.runtime.onInstalled 中添加清理逻辑**

找到 `chrome.runtime.onInstalled.addListener` 部分（约第 18 行），修改为：

```javascript
// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["settings"]);
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  updateContextMenu();
  
  // 清理孤立请求和过期请求
  cleanupOrphanedRequests();
  cleanupOldRequests();
});
```

- [ ] **Step 3: 修改 handleGenerateImage 函数添加请求记录**

找到 `handleGenerateImage` 函数，在函数体开头添加请求记录创建。修改后的函数开头部分如下：

```javascript
// 处理图片生成
async function handleGenerateImage(
  prompt,
  negativePrompt,
  provider,
  tabId,
  imageUrl = null,
  operationType = "generate",
) {
  const opText = operationType === "edit" ? "改图" : "生成图片";

  // 如果没有 tabId，尝试获取当前活动标签页
  if (!tabId) {
    try {
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      tabId = activeTab?.id;
    } catch (e) {
      console.log("获取活动标签页失败:", e);
    }
  }

  // 创建请求记录
  const requestRecord = createRequestRecord({
    prompt,
    negativePrompt,
    provider,
    imageUrl,
    operationType,
    endpoint: provider?.endpoint,
  });
  
  // 保存初始状态
  await saveRequestRecord(requestRecord);
  const recordId = requestRecord.id;
  const startTime = Date.now();

  showNotification(`正在使用 ${provider.name} ${opText}...`);
  // ... 后续代码保持不变
```

然后在 `handleGenerateImage` 函数的成功分支中，在 `showNotification(`${opText}成功！`);` 之后添加：

```javascript
      showNotification(`${opText}成功！`);
      
      // 更新请求记录为成功
      const duration = Date.now() - startTime;
      await updateRequestRecord(recordId, {
        status: "success",
        response: {
          imageUrl: result.imageUrl,
          responseData: responseData,
        },
        debug: {
          requestBody: requestBody,
          requestHeaders: sanitizeRequestHeaders(config.customHeaders || {}),
          responseData: responseData,
          endpoint: provider.endpoint,
        },
        timing: {
          completedAt: new Date().toISOString(),
          duration: duration,
        },
      });
```

在失败分支中，在 `showNotification(`${opText}失败: ` + error.message, "error");` 之后添加：

```javascript
    showNotification(`${opText}失败: ` + error.message, "error");
    
    // 更新请求记录为失败
    const duration = Date.now() - startTime;
    await updateRequestRecord(recordId, {
      status: "failed",
      response: {
        error: error.message,
      },
      debug: error.debugData || {
        requestBody: null,
        requestHeaders: {},
        responseData: null,
        endpoint: provider?.endpoint || "",
      },
      timing: {
        completedAt: new Date().toISOString(),
        duration: duration,
      },
    });
```

在函数末尾（`catch` 块结束后）添加：

```javascript
  // 每次请求后清理过期记录
  cleanupOldRequests();
}
```

- [ ] **Step 4: 添加消息处理接口**

在 `chrome.runtime.onMessage.addListener` 中添加请求管理相关的消息处理。找到现有的消息监听器，在 `if (message.action === "saveSettings")` 的 `return true;` 之后添加：

```javascript
  } else if (message.action === "getRequests") {
    // 获取请求记录
    chrome.storage.local.get("requests").then((res) => {
      sendResponse({ requests: res.requests || [] });
    });
    return true;
  } else if (message.action === "deleteRequest") {
    // 删除单条请求记录
    deleteRequestRecord(message.id).then(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (message.action === "clearRequests") {
    // 清空所有请求记录
    chrome.storage.local.set({ requests: [] }).then(() => {
      sendResponse({ success: true });
    });
    return true;
```

- [ ] **Step 5: 添加右键菜单入口**

在 `updateContextMenu` 函数中，找到创建"查看画图历史"菜单项的代码，在其后添加：

```javascript
    createItem({
      id: "ai-draw-requests",
      parentId: "ai-draw-main",
      title: "📋 请求管理",
      contexts: ["selection", "page", "image"],
    });
```

在 `chrome.contextMenus.onClicked.addListener` 中，找到处理 `ai-draw-history` 的代码，在其后添加：

```javascript
  } else if (info.menuItemId === "ai-draw-requests") {
    chrome.tabs.create({ url: "requests.html" });
```

- [ ] **Step 6: 提交后台脚本修改**

```bash
git add background.js
git commit -m "feat: 在后台脚本中集成请求记录功能"
```

---

## Chunk 2: 请求管理页面

### Task 2.1: 创建请求管理页面 HTML

**Files:**
- Create: `requests.html`

- [ ] **Step 1: 创建 requests.html**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI画图助手 - 请求管理</title>
    <link rel="stylesheet" href="styles/common.css" />
    <link rel="stylesheet" href="styles/requests.css" />
  </head>

  <body>
    <div class="container">
      <header>
        <div class="header-content">
          <div class="header-left">
            <h1>AI画图助手</h1>
            <p class="subtitle">请求管理</p>
          </div>
          <div class="header-right">
            <span id="requestCount">0 条记录</span>
          </div>
        </div>
      </header>

      <main>
        <div class="toolbar">
          <div class="filter-tabs">
            <button class="filter-tab active" data-status="all">全部</button>
            <button class="filter-tab" data-status="pending">
              <span class="status-dot pending"></span>进行中
            </button>
            <button class="filter-tab" data-status="success">
              <span class="status-dot success"></span>成功
            </button>
            <button class="filter-tab" data-status="failed">
              <span class="status-dot failed"></span>失败
            </button>
          </div>
          <div class="search-box">
            <input
              type="text"
              id="searchInput"
              placeholder="搜索提示词或服务商..."
            />
          </div>
          <div class="toolbar-actions">
            <button id="refreshBtn" class="btn secondary">刷新</button>
            <button id="clearAllBtn" class="btn danger">清空全部</button>
            <a href="history.html" class="btn secondary">历史记录</a>
          </div>
        </div>

        <div id="requestList" class="request-list">
          <div class="loading">加载中...</div>
        </div>

        <div id="emptyState" class="empty-state" style="display: none">
          <div class="empty-icon">📋</div>
          <p>暂无请求记录</p>
          <p class="hint">
            所有 API 请求都会记录在这里，包括成功和失败的请求
          </p>
        </div>
      </main>
    </div>

    <!-- 请求详情模态框 -->
    <div id="detailModal" class="modal">
      <div class="modal-content detail-modal">
        <span class="modal-close">&times;</span>
        <div class="detail-header">
          <span id="detailStatus" class="status-badge"></span>
          <span id="detailOperationType"></span>
          <span id="detailProvider"></span>
          <span id="detailDuration"></span>
        </div>
        
        <div class="detail-sections">
          <div class="detail-section">
            <h3>📋 请求参数</h3>
            <div id="detailRequest" class="detail-content"></div>
          </div>
          
          <div class="detail-section">
            <h3>⏱️ 耗时统计</h3>
            <div id="detailTiming" class="detail-content"></div>
          </div>
          
          <div class="detail-section">
            <h3>📤 请求详情</h3>
            <div id="detailDebugRequest" class="detail-content code-block"></div>
          </div>
          
          <div class="detail-section">
            <h3>📥 响应详情</h3>
            <div id="detailDebugResponse" class="detail-content code-block"></div>
          </div>
        </div>
        
        <div class="detail-actions">
          <button id="copyDebugBtn" class="btn secondary">复制调试信息</button>
          <button id="exportJsonBtn" class="btn secondary">导出JSON</button>
          <button id="retryBtn" class="btn primary" style="display: none;">重试</button>
          <button id="closeDetailBtn" class="btn secondary">关闭</button>
        </div>
      </div>
    </div>

    <script type="module" src="requests.js"></script>
  </body>
</html>
```

- [ ] **Step 2: 提交 HTML 文件**

```bash
git add requests.html
git commit -m "feat: 添加请求管理页面 HTML"
```

### Task 2.2: 创建请求管理页面样式

**Files:**
- Create: `styles/requests.css`

- [ ] **Step 1: 创建 requests.css**

```css
/* AI画图助手 - 请求管理页面样式 */

/* ==================== 页面布局 ==================== */
.container {
  max-width: 1000px;
}

header {
  margin-bottom: 24px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h1 {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.subtitle {
  font-size: 14px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.header-right {
  font-size: 14px;
  color: var(--text-secondary);
}

/* ==================== 工具栏 ==================== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.filter-tabs {
  display: flex;
  gap: 8px;
}

.filter-tab {
  padding: 8px 16px;
  border: 1px solid var(--border-color-medium);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: var(--transition);
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-tab:hover {
  border-color: var(--accent-color);
  background: var(--accent-light);
}

.filter-tab.active {
  background: var(--accent-color);
  color: white;
  border-color: var(--accent-color);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.pending {
  background: #667eea;
  animation: pulse 1.5s infinite;
}

.status-dot.success {
  background: #48bb78;
}

.status-dot.failed {
  background: #f56565;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.search-box {
  flex: 1;
  min-width: 200px;
  max-width: 300px;
}

.search-box input {
  width: 100%;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

/* ==================== 请求列表 ==================== */
.request-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.request-card {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-color);
  padding: 16px;
  transition: var(--transition);
}

.request-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--border-color-strong);
}

.request-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.request-status {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.request-status.pending {
  color: #667eea;
}

.request-status.success {
  color: #48bb78;
}

.request-status.failed {
  color: #f56565;
}

.request-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.request-meta .provider-tag {
  font-size: 11px;
}

.request-duration {
  font-size: 12px;
  color: var(--text-tertiary);
}

.request-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-tertiary);
}

.request-prompt {
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.request-error {
  background: #fff5f5;
  border: 1px solid #feb2b2;
  border-radius: var(--radius-md);
  padding: 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #c53030;
}

.request-actions {
  display: flex;
  gap: 8px;
}

.request-actions .btn {
  font-size: 12px;
  padding: 6px 12px;
}

/* ==================== 空状态 ==================== */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-state p {
  font-size: 16px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.empty-state .hint {
  font-size: 14px;
  color: var(--text-tertiary);
}

/* ==================== 详情模态框 ==================== */
.detail-modal {
  max-width: 800px;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
}

.status-badge {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: var(--radius-round);
}

.status-badge.pending {
  background: #ebf4ff;
  color: #667eea;
}

.status-badge.success {
  background: #f0fff4;
  color: #48bb78;
}

.status-badge.failed {
  background: #fff5f5;
  color: #f56565;
}

.detail-sections {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-bottom: 20px;
}

.detail-section h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.detail-content {
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  padding: 12px;
  border-radius: var(--radius-md);
  line-height: 1.6;
}

.detail-content.code-block {
  font-family: "Monaco", "Menlo", "Ubuntu Mono", monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow-y: auto;
}

.detail-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

/* ==================== 加载状态 ==================== */
.loading {
  text-align: center;
  padding: 40px;
  color: var(--text-tertiary);
}

/* ==================== 响应式 ==================== */
@media (max-width: 768px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  
  .filter-tabs {
    overflow-x: auto;
    padding-bottom: 4px;
  }
  
  .search-box {
    max-width: none;
  }
  
  .toolbar-actions {
    flex-wrap: wrap;
  }
  
  .detail-header {
    flex-wrap: wrap;
  }
  
  .detail-actions {
    flex-wrap: wrap;
  }
}
```

- [ ] **Step 2: 提交样式文件**

```bash
git add styles/requests.css
git commit -m "feat: 添加请求管理页面样式"
```

### Task 2.3: 创建请求管理页面脚本

**Files:**
- Create: `requests.js`

- [ ] **Step 1: 创建 requests.js**

```javascript
// AI画图助手 - 请求管理页面脚本
import { showNotification, escapeHtml, truncateText, formatDate } from './lib/common.js';

let allRequests = [];
let filteredRequests = [];
let currentFilter = "all";
let searchQuery = "";
let currentDetailRequest = null;

document.addEventListener("DOMContentLoaded", () => {
  loadRequests();
  setupEventListeners();
  setupStorageListener();
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
```

- [ ] **Step 2: 提交脚本文件**

```bash
git add requests.js
git commit -m "feat: 添加请求管理页面脚本"
```

---

## Chunk 3: 集成与完善

### Task 3.1: 更新 manifest.json

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: 添加 requests.html 到 web_accessible_resources**

找到 `manifest.json` 的 `web_accessible_resources` 部分，修改为：

```json
"web_accessible_resources": [
  {
    "resources": ["lib/common.js", "lib/image-utils.js", "requests.html"],
    "matches": ["<all_urls>"]
  }
],
```

- [ ] **Step 2: 提交 manifest.json**

```bash
git add manifest.json
git commit -m "feat: 在 manifest 中注册请求管理页面"
```

### Task 3.2: 更新历史记录页面添加跳转链接

**Files:**
- Modify: `history.html`

- [ ] **Step 1: 在历史记录页面添加请求管理链接**

找到 `history.html` 的 `<div class="header-right">` 部分，修改为：

```html
<div class="header-right">
  <a href="requests.html" class="btn secondary small" style="margin-right: 12px;">📋 请求管理</a>
  <span id="historyCount">0 条记录</span>
</div>
```

- [ ] **Step 2: 提交历史记录页面修改**

```bash
git add history.html
git commit -m "feat: 在历史记录页面添加请求管理链接"
```

### Task 3.3: 更新 popup.js 支持参数预填充

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: 在 popup.js 的 loadSettings 函数中添加 URL 参数解析**

找到 `loadSettings` 函数，修改函数开头部分：

```javascript
async function loadSettings() {
  try {
    // 解析 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const prefillPrompt = urlParams.get("prompt");
    const prefillNegativePrompt = urlParams.get("negativePrompt");
    const prefillProviderId = urlParams.get("providerId");
    
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
```

- [ ] **Step 2: 提交 popup.js 修改**

```bash
git add popup.js
git commit -m "feat: popup 支持从 URL 参数预填充"
```

---

## 最终验证

### Task 4.1: 手动测试清单

- [ ] **Step 1: 加载扩展**
  1. 打开 `chrome://extensions/`
  2. 启用开发者模式
  3. 点击"加载已解压的扩展程序"
  4. 选择项目文件夹

- [ ] **Step 2: 测试请求记录创建**
  1. 在任意页面选中文本
  2. 右键菜单选择 AI 画图
  3. 等待生成完成
  4. 打开请求管理页面，验证请求已记录

- [ ] **Step 3: 测试状态筛选**
  1. 发起一个失败的请求（使用错误的 API Key）
  2. 在请求管理页面切换筛选标签
  3. 验证筛选功能正常

- [ ] **Step 4: 测试详情查看**
  1. 点击"查看详情"按钮
  2. 验证请求参数、耗时统计、请求/响应详情显示正确
  3. 测试复制调试信息功能
  4. 测试导出 JSON 功能

- [ ] **Step 5: 测试重试功能**
  1. 找一个失败的请求
  2. 点击"重试"按钮
  3. 验证 popup 打开并预填充参数

- [ ] **Step 6: 测试自动清理**
  1. 修改系统时间或手动修改请求记录的时间戳
  2. 验证过期请求被自动清理

- [ ] **Step 7: 测试孤立请求清理**
  1. 发起一个请求后在完成前关闭浏览器
  2. 重新打开浏览器
  3. 验证孤立的 pending 请求被标记为失败

---

**计划完成。可以开始执行实现。**
