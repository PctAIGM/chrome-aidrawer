# 图片池存储实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将所有图片（生成图、原图）统一存储为base64格式，使用MD5去重和引用计数机制减少存储空间占用。

**Architecture:** 创建独立的图片池存储模块 `lib/image-store.js`，历史记录只存储MD5引用。修改后台脚本的保存/删除逻辑，修改历史记录页面的渲染逻辑。新增迁移功能和锁定机制。

**Tech Stack:** Chrome Extension Manifest V3, Vanilla JavaScript, Web Crypto API (MD5)

---

## Task 1: 创建图片存储模块

**Files:**
- Create: `lib/image-store.js`

**Step 1: 创建模块基础结构和MD5计算函数**

```javascript
// lib/image-store.js
// AI画图助手 - 图片存储管理模块
// 实现图片池存储、MD5去重、引用计数管理

const STORAGE_KEY = "imagePool";

/**
 * 计算base64数据的MD5哈希值
 * @param {string} base64Data - base64格式的图片数据
 * @returns {Promise<string>} MD5哈希值（十六进制字符串）
 */
export async function calculateImageMd5(base64Data) {
  // 提取纯base64数据（去掉data:image/xxx;base64,前缀）
  const base64Content = base64Data.includes(",")
    ? base64Data.split(",")[1]
    : base64Data;

  // 将base64解码为二进制数据
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // 使用Web Crypto API计算SHA-256（比MD5更安全且原生支持）
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 获取图片池数据
 * @returns {Promise<Object>} 图片池对象
 */
export async function getImagePool() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

/**
 * 保存图片池数据
 * @param {Object} pool - 图片池对象
 */
export async function saveImagePool(pool) {
  await chrome.storage.local.set({ [STORAGE_KEY]: pool });
}

/**
 * 存储图片到池中，如果已存在则增加引用计数
 * @param {string} base64Data - base64格式的图片数据
 * @returns {Promise<string>} 图片的MD5哈希值
 */
export async function storeImage(base64Data) {
  if (!base64Data) return null;

  const md5 = await calculateImageMd5(base64Data);
  const pool = await getImagePool();
  const size = base64Data.length;

  if (pool[md5]) {
    // 图片已存在，增加引用计数
    pool[md5].refCount += 1;
  } else {
    // 新图片，创建记录
    pool[md5] = {
      data: base64Data,
      refCount: 1,
      size: size,
      createdAt: new Date().toISOString(),
    };
  }

  await saveImagePool(pool);
  return md5;
}

/**
 * 从池中获取图片数据
 * @param {string} md5 - 图片的MD5哈希值
 * @returns {Promise<string|null>} base64格式的图片数据，不存在返回null
 */
export async function getImage(md5) {
  if (!md5) return null;

  const pool = await getImagePool();
  return pool[md5]?.data || null;
}

/**
 * 增加图片引用计数
 * @param {string} md5 - 图片的MD5哈希值
 * @returns {Promise<boolean>} 是否成功
 */
export async function incrementRef(md5) {
  if (!md5) return false;

  const pool = await getImagePool();
  if (pool[md5]) {
    pool[md5].refCount += 1;
    await saveImagePool(pool);
    return true;
  }
  return false;
}

/**
 * 减少图片引用计数，如果计数为0则删除图片
 * @param {string} md5 - 图片的MD5哈希值
 * @returns {Promise<boolean>} 图片是否被删除
 */
export async function decrementRef(md5) {
  if (!md5) return false;

  const pool = await getImagePool();
  if (pool[md5]) {
    pool[md5].refCount -= 1;
    
    if (pool[md5].refCount <= 0) {
      delete pool[md5];
      await saveImagePool(pool);
      return true;
    }
    
    await saveImagePool(pool);
  }
  return false;
}

/**
 * 获取存储统计信息
 * @returns {Promise<Object>} 统计信息 { totalImages, totalSize, savedSize }
 */
export async function getStorageStats() {
  const pool = await getImagePool();
  const entries = Object.values(pool);
  
  let totalSize = 0;
  let savedSize = 0;
  
  entries.forEach(entry => {
    totalSize += entry.size;
    // 引用计数大于1表示去重节省的空间
    if (entry.refCount > 1) {
      savedSize += entry.size * (entry.refCount - 1);
    }
  });
  
  return {
    totalImages: entries.length,
    totalSize: totalSize,
    savedSize: savedSize,
    totalRefs: entries.reduce((sum, e) => sum + e.refCount, 0),
  };
}

/**
 * 清理无效引用（引用计数为0或负数的记录）
 * @returns {Promise<number>} 清理的记录数
 */
export async function cleanupInvalidRefs() {
  const pool = await getImagePool();
  let cleaned = 0;
  
  Object.keys(pool).forEach(md5 => {
    if (pool[md5].refCount <= 0) {
      delete pool[md5];
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    await saveImagePool(pool);
  }
  
  return cleaned;
}

/**
 * 重建引用计数（基于历史记录）
 * @returns {Promise<Object>} 重建结果 { success, message }
 */
export async function rebuildRefCount() {
  try {
    // 获取历史记录
    const { history = [] } = await chrome.storage.local.get("history");
    const pool = await getImagePool();
    
    // 重置所有引用计数为0
    Object.keys(pool).forEach(md5 => {
      pool[md5].refCount = 0;
    });
    
    // 遍历历史记录，统计引用
    history.forEach(item => {
      if (item.imageMd5 && pool[item.imageMd5]) {
        pool[item.imageMd5].refCount += 1;
      }
      if (item.originalImageMd5 && pool[item.originalImageMd5]) {
        pool[item.originalImageMd5].refCount += 1;
      }
    });
    
    // 删除引用计数为0的记录
    let removed = 0;
    Object.keys(pool).forEach(md5 => {
      if (pool[md5].refCount <= 0) {
        delete pool[md5];
        removed++;
      }
    });
    
    await saveImagePool(pool);
    
    return {
      success: true,
      message: `重建完成，清理了 ${removed} 个无效引用`,
    };
  } catch (error) {
    return {
      success: false,
      message: error.message,
    };
  }
}
```

**Step 2: 提交**

```bash
git add lib/image-store.js
git commit -m "feat: 添加图片存储模块 image-store.js"
```

---

## Task 2: 修改后台脚本 - 保存历史记录

**Files:**
- Modify: `background.js:1219-1242` (saveToHistory 函数)

**Step 1: 导入 image-store 模块并修改 saveToHistory 函数**

在 `background.js` 顶部添加导入（由于是Service Worker，使用动态导入）：

修改 `saveToHistory` 函数：

```javascript
// 导入图片存储模块（在文件顶部或函数内部动态导入）
async function saveToHistory(item) {
  // 动态导入图片存储模块
  const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
  
  const { settings } = await chrome.storage.local.get("settings");
  const maxItems = settings?.maxHistory || MAX_HISTORY_ITEMS;

  // 处理图片URL，转换为MD5引用
  let imageMd5 = null;
  let originalImageMd5 = null;

  // 处理生成图
  if (item.imageUrl) {
    if (item.imageUrl.startsWith("data:")) {
      // 已经是base64，直接存储
      imageMd5 = await imageStore.storeImage(item.imageUrl);
    } else {
      // 外部URL，下载后存储
      try {
        const base64 = await downloadImageAsBase64(item.imageUrl);
        imageMd5 = await imageStore.storeImage(base64);
      } catch (e) {
        console.error("下载生成图失败:", e);
        // 保留原URL作为降级方案
        imageMd5 = item.imageUrl;
      }
    }
  }

  // 处理原图（改图操作）
  if (item.originalImageUrl) {
    if (item.originalImageUrl.startsWith("data:")) {
      originalImageMd5 = await imageStore.storeImage(item.originalImageUrl);
    } else {
      try {
        const base64 = await downloadImageAsBase64(item.originalImageUrl);
        originalImageMd5 = await imageStore.storeImage(base64);
      } catch (e) {
        console.error("下载原图失败:", e);
        originalImageMd5 = item.originalImageUrl;
      }
    }
  }

  // 创建新的历史记录项
  const historyItem = {
    id: item.id,
    prompt: item.prompt,
    imageMd5: imageMd5,
    originalImageMd5: originalImageMd5,
    operationType: item.operationType,
    provider: item.provider,
    createdAt: item.createdAt,
  };

  const stored = await chrome.storage.local.get(["history"]);
  let history = stored.history || [];
  history.unshift(historyItem);
  if (history.length > maxItems) history = history.slice(0, maxItems);

  // 尝试保存，如果配额超出则抛出特定错误供页面处理
  try {
    await chrome.storage.local.set({ history });
  } catch (error) {
    if (error.message && error.message.includes("quota")) {
      console.warn("存储配额不足，需要用户确认清理");
      const quotaError = new Error("QUOTA_EXCEEDED");
      quotaError.historyCount = history.length;
      throw quotaError;
    } else {
      throw error;
    }
  }
}
```

**Step 2: 在 manifest.json 中添加 image-store.js 到 web_accessible_resources**

```json
"web_accessible_resources": [
  {
    "resources": ["lib/image-store.js"],
    "matches": ["<all_urls>"]
  }
]
```

**Step 3: 提交**

```bash
git add background.js manifest.json
git commit -m "feat: 修改saveToHistory使用图片池存储"
```

---

## Task 3: 修改后台脚本 - 删除历史记录

**Files:**
- Modify: `background.js:1765-1775` (deleteHistoryItem 消息处理)

**Step 1: 修改 deleteHistoryItem 处理逻辑**

```javascript
if (message.action === "deleteHistoryItem") {
  (async () => {
    // 动态导入图片存储模块
    const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
    
    const stored = await chrome.storage.local.get(["history"]);
    let history = stored.history || [];
    
    // 找到要删除的记录
    const itemToDelete = history.find((item) => item.id === message.id);
    
    if (itemToDelete) {
      // 减少图片引用计数
      if (itemToDelete.imageMd5) {
        await imageStore.decrementRef(itemToDelete.imageMd5);
      }
      if (itemToDelete.originalImageMd5) {
        await imageStore.decrementRef(itemToDelete.originalImageMd5);
      }
    }
    
    // 从历史记录中删除
    history = history.filter((item) => item.id !== message.id);
    await chrome.storage.local.set({ history });
    sendResponse({ success: true });
  })();
  return true;
}
```

**Step 2: 修改 clearHistory 处理逻辑**

```javascript
if (message.action === "clearHistory") {
  (async () => {
    try {
      // 动态导入图片存储模块
      const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
      
      // 清空历史记录
      await chrome.storage.local.set({ history: [] });
      
      // 清空图片池
      await chrome.storage.local.set({ imagePool: {} });
      
      console.log("已清空所有历史记录和图片池");
      sendResponse({ success: true });
    } catch (e) {
      console.error("清空历史记录失败:", e);
      sendResponse({ success: false, error: e.message });
    }
  })();
  return true;
}
```

**Step 3: 修改 clearHalfHistory 处理逻辑**

```javascript
if (message.action === "clearHalfHistory") {
  (async () => {
    try {
      // 动态导入图片存储模块
      const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
      
      const { settings } = await chrome.storage.local.get("settings");
      const stored = await chrome.storage.local.get(["history"]);
      let history = stored.history || [];
      const maxItems = settings?.maxHistory || MAX_HISTORY_ITEMS;
      
      // 清理一半
      const reducedHistory = history.slice(0, Math.floor(maxItems / 2));
      
      // 对被删除的记录减少引用计数
      const removedItems = history.slice(Math.floor(maxItems / 2));
      for (const item of removedItems) {
        if (item.imageMd5) {
          await imageStore.decrementRef(item.imageMd5);
        }
        if (item.originalImageMd5) {
          await imageStore.decrementRef(item.originalImageMd5);
        }
      }
      
      await chrome.storage.local.set({ history: reducedHistory });
      console.log("已清理历史记录，剩余:", reducedHistory.length);
      sendResponse({ success: true, remaining: reducedHistory.length });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();
  return true;
}
```

**Step 4: 提交**

```bash
git add background.js
git commit -m "feat: 修改删除历史记录逻辑，支持引用计数"
```

---

## Task 4: 修改历史记录页面 - 图片渲染

**Files:**
- Modify: `history.js:376-515` (createHistoryCard 函数)

**Step 1: 添加获取图片的辅助函数**

在 `history.js` 文件中添加：

```javascript
// 获取图片URL（从图片池或使用原始值）
async function getImageUrl(md5OrUrl) {
  if (!md5OrUrl) return null;
  
  // 如果是base64数据，直接返回
  if (md5OrUrl.startsWith("data:")) {
    return md5OrUrl;
  }
  
  // 如果是http/https URL，直接返回
  if (md5OrUrl.startsWith("http")) {
    return md5OrUrl;
  }
  
  // 否则认为是MD5，从图片池获取
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getImageByMd5",
      md5: md5OrUrl,
    });
    return response?.imageUrl || null;
  } catch (e) {
    console.error("获取图片失败:", e);
    return null;
  }
}
```

**Step 2: 在 background.js 中添加获取图片的消息处理**

```javascript
if (message.action === "getImageByMd5") {
  (async () => {
    try {
      const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
      const imageUrl = await imageStore.getImage(message.md5);
      sendResponse({ success: true, imageUrl: imageUrl });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();
  return true;
}
```

**Step 3: 修改 createHistoryCard 函数使用异步图片加载**

```javascript
async function createHistoryCard(item, allowNSFW) {
  const card = document.createElement("div");
  card.className = "history-card";
  if (!allowNSFW) card.classList.add("nsfw-blur");
  card.dataset.id = item.id;

  const isEdit = item.operationType === "edit" && (item.originalImageMd5 || item.originalImageUrl);
  const isSelected = selectedItems.has(item.id);

  // 获取图片URL
  const imageUrl = await getImageUrl(item.imageMd5 || item.imageUrl);
  const originalImageUrl = isEdit ? await getImageUrl(item.originalImageMd5 || item.originalImageUrl) : null;

  const nsfwOverlayHtml = !allowNSFW
    ? '<div class="nsfw-overlay"><span class="nsfw-icon">🔞</span>点击查看</div>'
    : "";

  let imageHtml;
  if (isEdit) {
    imageHtml = `
      <div class="card-image dual-image">
        <div class="image-container original">
          <img src="${originalImageUrl || ''}" alt="原图" loading="lazy" data-error-type="original" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
          <div class="image-error" style="display: none;">
            <div class="error-icon">🖼️</div>
            <div class="error-text">原图已失效</div>
            <button class="retry-btn" data-retry-type="card">重试</button>
          </div>
          <span class="image-label">原图</span>
        </div>
        <div class="arrow">→</div>
        <div class="image-container result">
          <img src="${imageUrl || ''}" alt="改图结果" loading="lazy" data-error-type="result" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
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
        <img src="${imageUrl || ''}" alt="${escapeHtml(item.prompt)}" loading="lazy" data-error-type="single" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <div class="image-error" style="display: none;">
          <div class="error-icon">🖼️</div>
          <div class="error-text">图片已失效</div>
          <button class="retry-btn" data-retry-type="card">重试</button>
        </div>
        ${nsfwOverlayHtml}
      </div>
    `;
  }

  // ... 其余代码保持不变
}
```

**Step 4: 修改 renderGallery 函数以支持异步**

```javascript
async function renderGallery() {
  const gallery = document.getElementById("gallery");
  const emptyState = document.getElementById("emptyState");
  const historyCount = document.getElementById("historyCount");

  if (historyCount) historyCount.textContent = `${filteredData.length} 条记录`;

  selectedItems.clear();
  updateExportButton();
  updateSelectAllCheckbox();

  if (filteredData.length === 0) {
    showEmptyState();
    return;
  }

  if (gallery) {
    gallery.innerHTML = "";

    const settings = await chrome.runtime.sendMessage({ action: "getSettings" });
    const imagesPerRow = settings.imagesPerRow || 4;
    const allowNSFW = localNSFWSetting !== null ? localNSFWSetting : !!settings.allowNSFW;

    gallery.style.display = "grid";
    gallery.style.gridTemplateColumns = `repeat(${imagesPerRow}, 1fr)`;

    if (emptyState) emptyState.style.display = "none";

    // 使用异步创建卡片
    for (const item of filteredData) {
      const card = await createHistoryCard(item, allowNSFW);
      gallery.appendChild(card);
    }
  }
}
```

**Step 5: 提交**

```bash
git add history.js background.js
git commit -m "feat: 修改历史记录页面使用图片池加载图片"
```

---

## Task 5: 添加迁移状态管理

**Files:**
- Modify: `background.js`

**Step 1: 添加迁移状态相关消息处理**

```javascript
// 迁移状态相关
if (message.action === "getMigrationStatus") {
  chrome.storage.local.get("migrationStatus").then((result) => {
    sendResponse(result.migrationStatus || { status: "none" });
  });
  return true;
}

if (message.action === "startMigration") {
  (async () => {
    try {
      const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
      
      // 设置迁移状态
      await chrome.storage.local.set({
        migrationStatus: {
          status: "in_progress",
          startedAt: new Date().toISOString(),
          completedAt: null,
          totalRecords: 0,
          processedRecords: 0,
          error: null,
        },
      });

      // 获取历史记录
      const { history = [] } = await chrome.storage.local.get("history");
      const totalRecords = history.length;

      await chrome.storage.local.set({
        migrationStatus: {
          status: "in_progress",
          startedAt: new Date().toISOString(),
          completedAt: null,
          totalRecords: totalRecords,
          processedRecords: 0,
          error: null,
        },
      });

      let processedRecords = 0;

      // 遍历历史记录进行迁移
      for (let i = 0; i < history.length; i++) {
        const item = history[i];

        // 迁移生成图
        if (item.imageUrl && !item.imageMd5) {
          if (item.imageUrl.startsWith("data:")) {
            item.imageMd5 = await imageStore.storeImage(item.imageUrl);
            delete item.imageUrl;
          } else if (item.imageUrl.startsWith("http")) {
            try {
              const base64 = await downloadImageAsBase64(item.imageUrl);
              item.imageMd5 = await imageStore.storeImage(base64);
              delete item.imageUrl;
            } catch (e) {
              console.warn("迁移图片失败:", e);
              // 保留原URL
              item.imageMd5 = item.imageUrl;
            }
          }
        }

        // 迁移原图
        if (item.originalImageUrl && !item.originalImageMd5) {
          if (item.originalImageUrl.startsWith("data:")) {
            item.originalImageMd5 = await imageStore.storeImage(item.originalImageUrl);
            delete item.originalImageUrl;
          } else if (item.originalImageUrl.startsWith("http")) {
            try {
              const base64 = await downloadImageAsBase64(item.originalImageUrl);
              item.originalImageMd5 = await imageStore.storeImage(base64);
              delete item.originalImageUrl;
            } catch (e) {
              console.warn("迁移原图失败:", e);
              item.originalImageMd5 = item.originalImageUrl;
            }
          }
        }

        processedRecords++;

        // 更新进度（每10条更新一次）
        if (processedRecords % 10 === 0 || processedRecords === totalRecords) {
          const currentStatus = await chrome.storage.local.get("migrationStatus");
          await chrome.storage.local.set({
            migrationStatus: {
              ...currentStatus.migrationStatus,
              processedRecords: processedRecords,
            },
          });
        }
      }

      // 保存迁移后的历史记录
      await chrome.storage.local.set({ history });

      // 更新迁移状态为完成
      await chrome.storage.local.set({
        migrationStatus: {
          status: "completed",
          startedAt: (await chrome.storage.local.get("migrationStatus")).migrationStatus.startedAt,
          completedAt: new Date().toISOString(),
          totalRecords: totalRecords,
          processedRecords: processedRecords,
          error: null,
        },
      });

      sendResponse({ success: true, processedRecords });
    } catch (e) {
      // 更新迁移状态为失败
      const currentStatus = await chrome.storage.local.get("migrationStatus");
      await chrome.storage.local.set({
        migrationStatus: {
          ...currentStatus.migrationStatus,
          status: "failed",
          error: e.message,
        },
      });
      sendResponse({ success: false, error: e.message });
    }
  })();
  return true;
}

if (message.action === "checkMigrationRequired") {
  (async () => {
    const { history = [] } = await chrome.storage.local.get("history");
    const hasOldFormat = history.some(
      (item) => item.imageUrl?.startsWith("data:") || item.originalImageUrl?.startsWith("data:")
    );
    sendResponse({ required: hasOldFormat });
  })();
  return true;
}
```

**Step 2: 提交**

```bash
git add background.js
git commit -m "feat: 添加迁移状态管理消息处理"
```

---

## Task 6: 添加迁移锁定机制

**Files:**
- Modify: `background.js` (handleGenerateImage 函数)
- Modify: `background.js` (消息处理中的 generateImage 和 editImage)

**Step 1: 创建迁移检查函数**

```javascript
// 检查是否可以执行操作（迁移未进行中）
async function canPerformAction() {
  const { migrationStatus } = await chrome.storage.local.get("migrationStatus");
  return !migrationStatus || migrationStatus.status !== "in_progress";
}

// 获取迁移状态消息
function getMigrationBlockMessage(migrationStatus) {
  if (migrationStatus?.status === "in_progress") {
    const progress = migrationStatus.totalRecords > 0
      ? ` (${migrationStatus.processedRecords}/${migrationStatus.totalRecords})`
      : "";
    return `正在迁移历史记录${progress}，请稍候...`;
  }
  if (migrationStatus?.status === "failed") {
    return "迁移失败，请在设置页面重试";
  }
  return "请等待迁移完成";
}
```

**Step 2: 修改 handleGenerateImage 函数添加迁移检查**

在函数开头添加：

```javascript
async function handleGenerateImage(
  prompt,
  negativePrompt,
  provider,
  tabId,
  imageUrl = null,
  operationType = "generate",
) {
  // 检查迁移状态
  if (!(await canPerformAction())) {
    const { migrationStatus } = await chrome.storage.local.get("migrationStatus");
    const blockMessage = getMigrationBlockMessage(migrationStatus);
    showNotification(blockMessage, "error");
    
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: "imageError",
        error: blockMessage,
        prompt: prompt,
      }).catch(() => {});
    }
    return;
  }

  // ... 原有代码
}
```

**Step 3: 提交**

```bash
git add background.js
git commit -m "feat: 添加迁移锁定机制"
```

---

## Task 7: 修改设置页面 - 添加迁移UI

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `styles/options.css`

**Step 1: 在 options.html 添加迁移管理区域**

```html
<!-- 存储管理 -->
<div class="settings-section">
  <h3>📦 存储管理</h3>
  
  <div id="storageStats" class="storage-stats">
    <p>正在加载存储信息...</p>
  </div>
  
  <div id="migrationSection" class="migration-section" style="display: none;">
    <div class="migration-warning">
      ⚠️ 检测到旧格式历史记录，需要迁移到新格式才能继续使用画图功能
    </div>
    <button id="startMigrationBtn" class="btn btn-primary">开始迁移</button>
  </div>
  
  <div id="migrationProgress" class="migration-progress" style="display: none;">
    <p>正在迁移历史记录...</p>
    <div class="progress-bar">
      <div id="progressFill" class="progress-fill" style="width: 0%"></div>
    </div>
    <p id="progressText">0/0</p>
  </div>
  
  <div class="storage-actions">
    <button id="cleanupRefsBtn" class="btn btn-secondary">清理无效引用</button>
    <button id="rebuildRefsBtn" class="btn btn-secondary">重建引用计数</button>
  </div>
</div>
```

**Step 2: 在 options.css 添加样式**

```css
/* 存储管理 */
.storage-stats {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.storage-stats p {
  margin: 4px 0;
  color: #4a5568;
}

.migration-section {
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.migration-warning {
  color: #856404;
  margin-bottom: 12px;
}

.migration-progress {
  background: #e3f2fd;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.progress-bar {
  background: #bbdefb;
  border-radius: 4px;
  height: 8px;
  overflow: hidden;
  margin: 8px 0;
}

.progress-fill {
  background: #2196f3;
  height: 100%;
  transition: width 0.3s ease;
}

.storage-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
```

**Step 3: 在 options.js 添加迁移逻辑**

```javascript
// 存储管理相关
async function initStorageManagement() {
  const storageStats = document.getElementById("storageStats");
  const migrationSection = document.getElementById("migrationSection");
  const migrationProgress = document.getElementById("migrationProgress");
  const startMigrationBtn = document.getElementById("startMigrationBtn");
  const cleanupRefsBtn = document.getElementById("cleanupRefsBtn");
  const rebuildRefsBtn = document.getElementById("rebuildRefsBtn");

  // 检查迁移状态
  const migrationStatus = await chrome.runtime.sendMessage({ action: "getMigrationStatus" });
  
  if (migrationStatus?.status === "in_progress") {
    // 迁移进行中，显示进度
    migrationSection.style.display = "none";
    migrationProgress.style.display = "block";
    updateMigrationProgress();
  } else if (migrationStatus?.status === "completed") {
    // 已完成迁移，显示存储统计
    migrationSection.style.display = "none";
    await updateStorageStats();
  } else {
    // 检查是否需要迁移
    const checkResult = await chrome.runtime.sendMessage({ action: "checkMigrationRequired" });
    if (checkResult.required) {
      migrationSection.style.display = "block";
      storageStats.innerHTML = "<p>检测到旧格式数据，需要迁移</p>";
    } else {
      // 新用户或无需迁移
      await chrome.storage.local.set({ migrationStatus: { status: "completed" } });
      await updateStorageStats();
    }
  }

  // 开始迁移按钮
  if (startMigrationBtn) {
    startMigrationBtn.addEventListener("click", async () => {
      startMigrationBtn.disabled = true;
      startMigrationBtn.textContent = "迁移中...";
      
      const result = await chrome.runtime.sendMessage({ action: "startMigration" });
      
      if (result.success) {
        showNotification(`迁移完成，共处理 ${result.processedRecords} 条记录`, "success");
        migrationSection.style.display = "none";
        await updateStorageStats();
      } else {
        showNotification("迁移失败: " + result.error, "error");
        startMigrationBtn.disabled = false;
        startMigrationBtn.textContent = "开始迁移";
      }
    });
  }

  // 清理无效引用
  if (cleanupRefsBtn) {
    cleanupRefsBtn.addEventListener("click", async () => {
      cleanupRefsBtn.disabled = true;
      // 需要在 background.js 中添加此消息处理
      const result = await chrome.runtime.sendMessage({ action: "cleanupInvalidRefs" });
      if (result.success) {
        showNotification(`清理了 ${result.cleaned} 个无效引用`, "success");
        await updateStorageStats();
      }
      cleanupRefsBtn.disabled = false;
    });
  }

  // 重建引用计数
  if (rebuildRefsBtn) {
    rebuildRefsBtn.addEventListener("click", async () => {
      rebuildRefsBtn.disabled = true;
      const result = await chrome.runtime.sendMessage({ action: "rebuildRefCount" });
      if (result.success) {
        showNotification(result.message, "success");
        await updateStorageStats();
      } else {
        showNotification("重建失败: " + result.message, "error");
      }
      rebuildRefsBtn.disabled = false;
    });
  }
}

async function updateStorageStats() {
  const storageStats = document.getElementById("storageStats");
  const result = await chrome.runtime.sendMessage({ action: "getStorageStats" });
  
  if (result.success) {
    const stats = result.stats;
    const totalSizeMB = (stats.totalSize / 1024 / 1024).toFixed(2);
    const savedSizeMB = (stats.savedSize / 1024 / 1024).toFixed(2);
    
    storageStats.innerHTML = `
      <p><strong>图片数量:</strong> ${stats.totalImages} 张</p>
      <p><strong>总引用数:</strong> ${stats.totalRefs} 次</p>
      <p><strong>占用空间:</strong> ${totalSizeMB} MB</p>
      <p><strong>去重节省:</strong> ${savedSizeMB} MB</p>
    `;
  }
}

async function updateMigrationProgress() {
  const progressFill = document.getElementById("progressFill");
  const progressText = document.getElementById("progressText");
  const migrationProgress = document.getElementById("migrationProgress");
  
  const update = async () => {
    const status = await chrome.runtime.sendMessage({ action: "getMigrationStatus" });
    
    if (status?.status === "in_progress") {
      const percent = status.totalRecords > 0
        ? Math.round((status.processedRecords / status.totalRecords) * 100)
        : 0;
      
      if (progressFill) progressFill.style.width = percent + "%";
      if (progressText) progressText.textContent = `${status.processedRecords}/${status.totalRecords}`;
      
      // 继续轮询
      setTimeout(update, 1000);
    } else if (status?.status === "completed") {
      migrationProgress.style.display = "none";
      await updateStorageStats();
      showNotification("迁移完成！", "success");
    } else if (status?.status === "failed") {
      migrationProgress.style.display = "none";
      showNotification("迁移失败: " + status.error, "error");
    }
  };
  
  update();
}
```

**Step 4: 在 background.js 添加 getStorageStats 和 cleanupInvalidRefs 消息处理**

```javascript
if (message.action === "getStorageStats") {
  (async () => {
    try {
      const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
      const stats = await imageStore.getStorageStats();
      sendResponse({ success: true, stats });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();
  return true;
}

if (message.action === "cleanupInvalidRefs") {
  (async () => {
    try {
      const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
      const cleaned = await imageStore.cleanupInvalidRefs();
      sendResponse({ success: true, cleaned });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();
  return true;
}

if (message.action === "rebuildRefCount") {
  (async () => {
    try {
      const imageStore = await import(chrome.runtime.getURL("lib/image-store.js"));
      const result = await imageStore.rebuildRefCount();
      sendResponse(result);
    } catch (e) {
      sendResponse({ success: false, message: e.message });
    }
  })();
  return true;
}
```

**Step 5: 在 DOMContentLoaded 中调用初始化**

```javascript
document.addEventListener("DOMContentLoaded", async () => {
  // ... 现有代码
  
  // 初始化存储管理
  await initStorageManagement();
});
```

**Step 6: 提交**

```bash
git add options.html options.js styles/options.css background.js
git commit -m "feat: 添加设置页面迁移管理UI"
```

---

## Task 8: 兼容性处理 - 读取时支持新旧格式

**Files:**
- Modify: `history.js`

**Step 1: 修改 getImageUrl 函数支持新旧格式**

```javascript
// 获取图片URL（从图片池或使用原始值，兼容新旧格式）
async function getImageUrl(md5OrUrl) {
  if (!md5OrUrl) return null;
  
  // 如果是base64数据（旧格式），直接返回
  if (md5OrUrl.startsWith("data:")) {
    return md5OrUrl;
  }
  
  // 如果是http/https URL，直接返回
  if (md5OrUrl.startsWith("http")) {
    return md5OrUrl;
  }
  
  // 否则认为是MD5，从图片池获取
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getImageByMd5",
      md5: md5OrUrl,
    });
    
    if (response?.success && response?.imageUrl) {
      return response.imageUrl;
    }
    
    // 如果从池中获取失败，可能是旧格式的URL被误判
    // 尝试作为URL直接返回
    return null;
  } catch (e) {
    console.error("获取图片失败:", e);
    return null;
  }
}
```

**Step 2: 提交**

```bash
git add history.js
git commit -m "feat: 添加新旧格式兼容处理"
```

---

## Task 9: 新用户初始化

**Files:**
- Modify: `background.js` (onInstalled 监听器)

**Step 1: 修改扩展安装时的初始化逻辑**

```javascript
chrome.runtime.onInstalled.addListener(async (details) => {
  // 原有设置初始化
  const stored = await chrome.storage.local.get(["settings"]);
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  
  // 新用户初始化迁移状态为已完成
  if (details.reason === "install") {
    await chrome.storage.local.set({
      migrationStatus: { status: "completed" },
      imagePool: {},
    });
    console.log("新用户初始化完成");
  }
  
  // 现有用户的迁移检查
  if (details.reason === "update") {
    const { migrationStatus } = await chrome.storage.local.get("migrationStatus");
    if (!migrationStatus) {
      // 检查是否有旧格式数据
      const { history = [] } = await chrome.storage.local.get("history");
      const hasOldFormat = history.some(
        (item) => item.imageUrl?.startsWith("data:") || item.originalImageUrl?.startsWith("data:")
      );
      
      if (!hasOldFormat && history.length === 0) {
        // 无历史记录，直接设置为已完成
        await chrome.storage.local.set({ migrationStatus: { status: "completed" } });
      }
      // 有旧格式数据的用户会在设置页面看到迁移提示
    }
  }
  
  updateContextMenu();
  cleanupOrphanedRequests();
  cleanupOldRequests();
});
```

**Step 2: 提交**

```bash
git add background.js
git commit -m "feat: 新用户初始化迁移状态"
```

---

## Task 10: 测试与验证

**测试清单：**

1. **新用户测试**
   - 安装扩展 → 检查 migrationStatus 是否为 completed
   - 生成图片 → 检查 history 中是否使用 imageMd5
   - 检查 imagePool 中是否有对应记录

2. **旧用户迁移测试**
   - 准备旧格式历史记录（imageUrl 为 base64）
   - 打开设置页面 → 检查是否显示迁移提示
   - 点击迁移 → 检查进度显示
   - 迁移完成后 → 检查历史记录是否正常显示

3. **引用计数测试**
   - 删除历史记录 → 检查引用计数是否减少
   - 删除到引用计数为0 → 检查图片是否从池中删除
   - 相同图片多次保存 → 检查是否只存一份

4. **迁移锁定测试**
   - 迁移进行中 → 尝试生成图片 → 检查是否被阻止

5. **边界情况测试**
   - 存储配额超限
   - 网络图片下载失败
   - 空历史记录迁移

---

## 实现顺序建议

1. Task 1: 创建图片存储模块
2. Task 2-3: 修改后台脚本（保存/删除）
3. Task 4: 修改历史记录页面渲染
4. Task 5-6: 添加迁移功能和锁定机制
5. Task 7: 添加设置页面UI
6. Task 8-9: 兼容性和初始化
7. Task 10: 测试验证
