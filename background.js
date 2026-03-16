// AI画图助手 - 后台脚本

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
 */
async function handleStorageQuotaExceeded() {
  try {
    const { requests = [] } = await chrome.storage.local.get("requests");
    if (requests.length <= 50) return;
    const reduced = requests.slice(0, 50);
    await chrome.storage.local.set({ requests: reduced });
    console.log(`存储配额超限，已清理 ${requests.length - 50} 条旧记录`);
  } catch (error) {
    console.error("处理存储配额超限失败:", error);
  }
}

// ==================== 原有代码 ====================

const MAX_HISTORY_ITEMS = 100;
const DEFAULT_SETTINGS = {
  providers: [],
  maxHistory: 100,
  useNotifications: true,
  imagesPerRow: 4,
  allowNSFW: false,
  // 图片上传服务配置
  imageUploadServices: [], // 上传服务列表
};

// 存储右键点击的图片信息
let contextImageUrl = null;

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

// 动态生成右键菜单
// 动态生成右键菜单
let isUpdatingMenu = false;
async function updateContextMenu() {
  if (isUpdatingMenu) return;
  isUpdatingMenu = true;

  try {
    await new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        resolve();
      });
    });

    const { settings } = await chrome.storage.local.get("settings");
    const providers = settings?.providers || [];

    // 区分画图和改图服务商
    const generateProviders = providers.filter(
      (p) => !p.serviceType || p.serviceType === "generate",
    );
    const editProviders = providers.filter((p) => p.serviceType === "edit");

    const createItem = (options) => {
      chrome.contextMenus.create(options, () => {
        if (chrome.runtime.lastError) {
          // 忽略重复ID错误，这种情况通常发生在快速重载时
          console.log("Context menu warning:", chrome.runtime.lastError.message);
        }
      });
    };

    // 主菜单
    createItem({
      id: "ai-draw-main",
      title: "🎨 AI画图助手",
      contexts: ["selection", "image"],
    });

    // 画图子菜单
    if (generateProviders.length === 0) {
      createItem({
        id: "ai-draw-no-provider",
        parentId: "ai-draw-main",
        title: "⚠️ 请先配置画图服务商",
        contexts: ["selection"],
      });
    } else {
      generateProviders.forEach((p) => {
        createItem({
          id: `generate-with-${p.id}`,
          parentId: "ai-draw-main",
          title: `使用 ${p.name} 生成`,
          contexts: ["selection"],
        });
      });
    }

    // 改图子菜单 - 在图片上右键或选中文字时显示
    if (editProviders.length > 0) {
      createItem({
        id: "ai-draw-edit-sep",
        parentId: "ai-draw-main",
        type: "separator",
        contexts: ["image", "selection"],
      });

      editProviders.forEach((p) => {
        createItem({
          id: `edit-with-${p.id}`,
          parentId: "ai-draw-main",
          title: `✏️ 用 ${p.name} 改图`,
          contexts: ["image", "selection"],
        });
      });
    }

    createItem({
      id: "ai-draw-sep",
      parentId: "ai-draw-main",
      type: "separator",
      contexts: ["selection", "image"],
    });

    createItem({
      id: "ai-draw-history",
      parentId: "ai-draw-main",
      title: "📚 查看画图历史",
      contexts: ["selection", "page", "image"],
    });

    createItem({
      id: "ai-draw-requests",
      parentId: "ai-draw-main",
      title: "📋 请求管理",
      contexts: ["selection", "page", "image"],
    });

    createItem({
      id: "ai-draw-settings",
      parentId: "ai-draw-main",
      title: "⚙️ API设置",
      contexts: ["selection", "page", "image"],
    });

  } finally {
    isUpdatingMenu = false;
  }
}

// 监听菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId.startsWith("generate-with-")) {
    const providerId = info.menuItemId.replace("generate-with-", "");
    const { settings } = await chrome.storage.local.get("settings");
    const provider = settings.providers.find((p) => p.id === providerId);
    if (provider && info.selectionText) {
      handleGenerateImage(info.selectionText, "", provider, tab.id);
    }
  } else if (info.menuItemId.startsWith("edit-with-")) {
    console.log("Edit menu clicked:", info.menuItemId, "srcUrl:", info.srcUrl);
    const providerId = info.menuItemId.replace("edit-with-", "");
    const { settings } = await chrome.storage.local.get("settings");
    const provider = settings.providers.find((p) => p.id === providerId);
    console.log("Found provider:", provider);
    if (provider) {
      // 检查是否有图片URL或配置了上传服务
      const uploadServices = settings?.imageUploadServices || [];
      const hasUploadService = uploadServices.some(service => service.isActive);

      if (info.srcUrl) {
        // 有右键图片，检查是否有上传服务
        const uploadServices = settings?.imageUploadServices || [];
        const hasUploadService = uploadServices.some(service => service.isActive);

        let warningMessage = null;

        // 检查图片URL类型，给出相应提示
        if (info.srcUrl.startsWith("data:")) {
          // Base64图片，通常可以直接使用
          warningMessage = null;
        } else if (info.srcUrl.includes("blob:") || info.srcUrl.includes("localhost") || info.srcUrl.includes("127.0.0.1")) {
          // 本地或blob URL，可能有访问限制
          warningMessage = hasUploadService
            ? "该图片可能有访问限制，如果改图失败请点击\"上传到图床\"按钮"
            : "该图片可能有访问限制，建议配置图片上传服务以获得更好的兼容性";
        } else {
          // 普通网络图片，根据是否有上传服务给出不同提示
          const domain = new URL(info.srcUrl).hostname;
          warningMessage = hasUploadService
            ? `来自 ${domain} 的图片可能有跨域限制，如果改图失败请点击\"上传到图床\"按钮`
            : `来自 ${domain} 的图片可能有跨域限制，建议配置图片上传服务以获得更好的兼容性`;
        }

        chrome.tabs
          .sendMessage(tab.id, {
            action: "showEditDialog",
            imageUrl: info.srcUrl,
            providerId: providerId,
            providerName: provider.name,
            warning: warningMessage,
          })
          .then(() => {
            console.log("showEditDialog message sent successfully");
          })
          .catch((err) => {
            // 静默处理：某些页面（如 Chrome 内部页面）无法注入 content script
            if (err.message && err.message.includes("Receiving end does not exist")) {
              console.log("无法在此页面使用改图功能（可能是特殊页面）");
            } else {
              console.log("消息发送失败:", err.message);
            }
          });
      } else if (hasUploadService) {
        // 没有右键图片但有上传服务，显示文件选择对话框
        chrome.tabs
          .sendMessage(tab.id, {
            action: "showEditDialog",
            imageUrl: null,
            providerId: providerId,
            providerName: provider.name,
          })
          .catch((err) => {
            // 静默处理
            if (!err.message || !err.message.includes("Receiving end does not exist")) {
              console.log("消息发送失败:", err.message);
            }
          });
      } else {
        // 既没有图片也没有上传服务
        showNotification("请先配置图片上传服务或右键点击图片使用改图功能", "error");
      }
    }
  } else if (info.menuItemId === "ai-draw-history") {
    chrome.tabs.create({ url: "history.html" });
  } else if (info.menuItemId === "ai-draw-requests") {
    chrome.tabs.create({ url: "requests.html" });
  } else if (
    info.menuItemId === "ai-draw-settings" ||
    info.menuItemId === "ai-draw-no-provider"
  ) {
    chrome.tabs.create({ url: "options.html" });
  }
});

// 监听扩展内部消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSettings") {
    chrome.storage.local.get("settings").then((res) => {
      sendResponse(res.settings || DEFAULT_SETTINGS);
    });
    return true;
  } else if (message.action === "saveSettings") {
    chrome.storage.local.set({ settings: message.settings }).then(() => {
      updateContextMenu();
      sendResponse({ success: true });
    });
    return true;
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

  }
});

// 向标签页发送消息的通用辅助函数
// 首先尝试直接发消息（content.js 已加载时成功），
// 失败时尝试注入 content.js 后重试，
// 若注入也失败则使用内联函数兜底
async function sendMessageToTab(tabId, message, fallbackFunc, fallbackArgs) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.log("消息发送失败，尝试注入 content.js:", err.message);
    try {
      // 注入 content.js 到页面
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["content.js"],
      });
      // 注入成功后重新发送消息
      await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      console.log("注入 content.js 失败，使用内联函数兜底:", e.message);
      // 最终兜底：注入内联函数
      if (fallbackFunc) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: fallbackFunc,
            args: fallbackArgs || [],
          });
        } catch (e2) {
          console.log("内联函数注入也失败:", e2.message);
        }
      }
    }
  }
}

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

  // 发送加载状态到页面
  if (tabId) {
    sendMessageToTab(
      tabId,
      { action: "imageLoading", prompt: prompt, elapsed: 0 },
      showInjectedLoadingStatus,
      [prompt, 0]
    );
  }

  console.log(`开始${opText}:`, {
    prompt,
    providerName: provider.name,
    imageUrl,
  });

  try {
    const config = {
      endpoint: provider.endpoint,
      apiKey: provider.key,
      responsePath: provider.responsePath,
      customHeaders: provider.customHeaders || {},
      customParams: provider.customParams || {},
      operationType: operationType,
      imageUrl: imageUrl,
      negativePrompt: negativePrompt,
      // 异步模式参数
      asyncMode: provider.asyncMode,
      jobIdPath: provider.jobIdPath,
      pollUrl: provider.pollUrl,
      statusPath: provider.statusPath,
      successValue: provider.successValue,
      pollInterval: provider.pollInterval,
      // multipart模式参数
      useMultipart: provider.useMultipart,
      imageFieldName: provider.imageFieldName,
    };

    const { requestBody, responseData, result } = await generateWithCustomAPI(
      prompt,
      config,
    );

    if (result.success && result.imageUrl) {
      const historyItem = {
        id: Date.now(),
        prompt: prompt,
        imageUrl: result.imageUrl,
        originalImageUrl: operationType === "edit" ? imageUrl : undefined,
        operationType: operationType,
        provider: provider.name,
        createdAt: new Date().toISOString(),
      };

      // 保存历史记录（失败不影响主流程）
      try {
        await saveToHistory(historyItem);
      } catch (saveError) {
        console.warn("保存历史记录失败:", saveError.message);
        // 如果是配额超出错误，发送消息给页面让用户确认
        if (saveError.message === "QUOTA_EXCEEDED") {
          if (tabId) {
            chrome.tabs
              .sendMessage(tabId, {
                action: "quotaExceeded",
                historyCount: saveError.historyCount,
              })
              .catch(() => { });
          }
          // 也尝试通过 scripting API 注入确认对话框
          try {
            const [activeTab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            if (activeTab && activeTab.id) {
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id },
                func: showQuotaExceededDialog,
                args: [saveError.historyCount],
              });
            }
          } catch (e) {
            console.log("注入配额确认对话框失败:", e.message);
          }
        }
      }
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

      // 同时也发送给扩展内部（如 Popup）
      chrome.runtime
        .sendMessage({
          action: "imageGenerated",
          imageUrl: result.imageUrl,
          prompt: prompt,
          debugData: {
            providerName: provider.name,
            request: requestBody,
            response: responseData,
          },
        })
        .catch(() => { }); // Popup 可能已关闭，忽略错误

      // 发送消息给 content.js 来在当前页面显示图片
      if (tabId) {
        const { settings: s } = await chrome.storage.local.get("settings");
        const allowNSFW = !!s?.allowNSFW;
        sendMessageToTab(
          tabId,
          {
            action: "imageGenerated",
            imageUrl: result.imageUrl,
            prompt: prompt,
            debugData: {
              providerName: provider.name,
              request: requestBody,
              response: responseData,
            },
          },
          showInjectedSuccessStatus,
          [result.imageUrl, prompt, allowNSFW]
        );
      }
    }
  } catch (error) {
    // console.info(`${opText}失败:`, error);
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

    // 发送给扩展内部（如 Popup）
    chrome.runtime
      .sendMessage({
        action: "imageError",
        error: error.message,
        prompt: prompt,
        debugData: error.debugData || { providerName: provider.name },
      })
      .catch(() => { });

    if (tabId) {
      sendMessageToTab(
        tabId,
        {
          action: "imageError",
          error: error.message,
          prompt: prompt,
          debugData: error.debugData || { providerName: provider.name },
        },
        showInjectedErrorStatus,
        [error.message, prompt]
      );
    }
  }
  
  // 每次请求后清理过期记录
  cleanupOldRequests();
}

async function generateWithCustomAPI(prompt, config) {
  const {
    endpoint,
    apiKey,
    responsePath,
    customHeaders,
    customParams,
    operationType,
    imageUrl,
    asyncMode,
    jobIdPath,
    pollUrl,
    statusPath,
    successValue,
    pollInterval,
    useMultipart, // 新增：是否使用multipart/form-data格式
    imageFieldName, // 新增：图片字段名
    negativePrompt, // 新增：反向提示词
  } = config;

  let requestBody = {};
  let isMultipartRequest = false;
  let formData = null;

  // 检查是否需要使用multipart格式（改图且配置了useMultipart）
  if (operationType === "edit" && imageUrl && useMultipart) {
    isMultipartRequest = true;
    formData = new FormData();

    console.log("使用multipart/form-data格式上传图片");

    try {
      // 将图片URL转换为Blob
      let imageBlob;
      if (imageUrl.startsWith('data:')) {
        // Base64图片
        const response = await fetch(imageUrl);
        imageBlob = await response.blob();
      } else {
        // 普通URL图片
        const response = await fetch(imageUrl);
        if (!response.ok) {
          const err = new Error(`无法下载图片: HTTP ${response.status}。这可能是由于网站的安全策略限制，建议使用图片上传功能或选择本地图片文件。`);
          err.debugData = {
            providerName: config.name,
            request: `fetch(${imageUrl})`,
            response: { status: response.status, statusText: response.statusText },
          };
          throw err;
        }
        imageBlob = await response.blob();
      }

      // 添加图片文件到FormData
      formData.append(imageFieldName || 'image', imageBlob, 'image.png');

      // 添加提示词
      formData.append('prompt', prompt);

      // 处理其他自定义参数
      for (const [key, value] of Object.entries(customParams || {})) {
        let finalValue;

        if (value && typeof value === "object" && value.fieldType) {
          if (value.fieldType === "prompt") {
            // 提示词已经添加过了，跳过
            continue;
          } else if (value.fieldType === "imageUrl") {
            // 图片已经添加过了，跳过
            continue;
          } else if (value.fieldType === "negativePrompt") {
            // 反向提示词字段
            finalValue = negativePrompt !== undefined && negativePrompt !== "" ? negativePrompt : value.value;
          } else {
            finalValue = value.value;
          }
        } else {
          finalValue = value;
        }

        // 处理随机数
        if (finalValue === "__RANDOM__") {
          finalValue = Math.floor(Math.random() * 2147483647);
        }

        if (finalValue !== undefined && finalValue !== null && finalValue !== '') {
          formData.append(key, String(finalValue));
        }
      }

      // 默认参数
      if (!customParams?.n && !customParams?.N) {
        formData.append('n', '1');
      }

    } catch (error) {
      console.error("准备multipart请求失败:", error);

      // 检查是否是网络相关错误
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        // 可能是CORS或网络连接问题
        const enhancedError = new Error("无法访问图片，可能是由于网站的跨域安全策略限制。建议使用图片上传功能或选择本地图片文件。");
        enhancedError.debugData = {
          providerName: config.name,
          request: { imageUrl: imageUrl?.substring(0, 100) + "...", operationType },
          response: null,
          originalError: error.message,
        };
        throw enhancedError;
      }

      // 如果错误已经有 debugData，直接抛出；否则添加 debugData
      if (!error.debugData) {
        error.debugData = {
          providerName: config.name,
          request: { imageUrl: imageUrl?.substring(0, 100) + "...", operationType },
          response: null,
        };
      }
      throw error;
    }
  } else {
    // 使用JSON格式（原有逻辑）
    // 处理自定义参数，支持字段类型映射和嵌套键 (如 input.prompt)
    for (const [key, value] of Object.entries(customParams || {})) {
      let finalValue;
      // 检查是否是新格式（带fieldType）
      if (value && typeof value === "object" && value.fieldType) {
        if (value.fieldType === "prompt") {
          // 提示词字段
          finalValue = prompt;
        } else if (value.fieldType === "imageUrl" && imageUrl) {
          // 图片URL字段（仅改图时）
          finalValue = imageUrl;
        } else if (value.fieldType === "negativePrompt") {
          // 反向提示词字段
          finalValue = negativePrompt !== undefined && negativePrompt !== "" ? negativePrompt : value.value;
        } else {
          // 其他情况使用value的值
          finalValue = value.value;
        }
      } else {
        // 旧格式或普通值
        finalValue = value;
      }

      // 处理随机数类型：__RANDOM__ 标记替换为实际随机数
      if (finalValue === "__RANDOM__") {
        finalValue = Math.floor(Math.random() * 2147483647); // 0 到 2^31-1 的随机整数
      }

      // 使用 setValueByPath 支持嵌套 (如 "input.prompt" -> {input: {prompt: "..."}})
      if (finalValue !== undefined && finalValue !== null && finalValue !== '') {
        setValueByPath(requestBody, key, finalValue);
      }
    }

    // 如果没有配置提示词字段，使用默认的prompt字段
    const hasPromptField = Object.values(customParams || {}).some(
      (v) => v && typeof v === "object" && v.fieldType === "prompt",
    );
    if (!hasPromptField) {
      requestBody.prompt = prompt;
    }

    // 默认添加 n:1 （如果还没有）
    if (!requestBody.n && !requestBody.N) {
      requestBody.n = 1;
    }
  }

  const headers = {
    ...customHeaders,
  };

  // 根据请求类型设置Content-Type
  if (!isMultipartRequest) {
    headers["Content-Type"] = "application/json";
  }
  // 注意：multipart/form-data的Content-Type会由浏览器自动设置，包含boundary

  if (apiKey) {
    const sanitizedKey = sanitizeHeaderValue(apiKey);
    const authHeader = sanitizedKey.toLowerCase().startsWith("bearer ")
      ? sanitizedKey
      : `Bearer ${sanitizedKey}`;

    if (!headers["Authorization"] && !headers["authorization"]) {
      headers["Authorization"] = authHeader;
    }
  }

  console.log("发送API请求到:", endpoint);
  console.log("请求格式:", isMultipartRequest ? "multipart/form-data" : "application/json");
  if (isMultipartRequest) {
    console.log("FormData字段:", Array.from(formData.keys()));
  } else {
    console.log("请求体:", requestBody);
  }

  let responseData = null;
  const startTime = Date.now(); // 记录开始时间

  // 辅助函数：发送状态更新
  async function sendStatusUpdate(status) {
    try {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        chrome.tabs.sendMessage(activeTab.id, {
          action: "imageLoadingUpdate",
          prompt: prompt,
          status: status,
          elapsed: elapsed,
        }).catch(() => { });
      }
    } catch (e) { }
  }

  // 发送状态更新：请求发送中
  await sendStatusUpdate("请求发送中");

  // 1. 发送初始请求
  const fetchOptions = {
    method: "POST",
    headers: headers,
    body: isMultipartRequest ? formData : JSON.stringify(requestBody),
  };

  const response = await fetch(endpoint, fetchOptions);

  // 发送状态更新：等待响应
  await sendStatusUpdate("等待响应");

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      responseData = await response.json();
      errorMsg =
        responseData.message ||
        responseData.detail ||
        responseData.error?.message ||
        JSON.stringify(responseData);
    } catch (e) { }
    const err = new Error(errorMsg);
    err.debugData = {
      providerName: config.name,
      request: isMultipartRequest ? "FormData (multipart)" : requestBody,
      response: responseData,
    };
    throw err;
  }

  responseData = await response.json();

  // 2. 如果是异步模式，进入轮询流程
  if (asyncMode) {
    console.log("进入异步轮询模式...");
    // 发送状态更新：等待异步返回
    await sendStatusUpdate("等待异步返回");
    const jobId = getValueByPath(responseData, jobIdPath);
    if (!jobId) {
      const err = new Error(`无法获取任务ID，路径: ${jobIdPath}`);
      err.debugData = {
        providerName: config.name,
        request: isMultipartRequest ? "FormData (multipart)" : requestBody,
        response: responseData,
      };
      throw err;
    }

    const actualPollUrl = pollUrl.replace("{id}", jobId);
    const intervalMs = (pollInterval || 2) * 1000;
    const maxAttempts = 60; // 防止无限循环，最大轮询次数
    let attempts = 0;
    let lastPollData = null;
    let lastStatus = null;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      attempts++;

      console.log(`轮询第 ${attempts} 次: ${actualPollUrl}`);
      const pollResponse = await fetch(actualPollUrl, { headers: { Authorization: headers.Authorization } });
      if (!pollResponse.ok) continue; // 忽略临时错误

      const pollData = await pollResponse.json();
      lastPollData = pollData;
      console.log("轮询响应数据:", pollData); // 方便调试

      let status = getValueByPath(pollData, statusPath);
      lastStatus = status;
      console.log(`提取状态 (${statusPath}):`, status);

      if (status === undefined || status === null) {
        status = "未知状态(路径错误?)";
      }

      console.log(`当前状态: ${status}`);

      // 4. 发送进度通知
      try {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (activeTab) {
          chrome.tabs
            .sendMessage(activeTab.id, {
              action: "imageLoadingUpdate",
              prompt: prompt,
              status: `${status} (轮询 ${attempts}/${maxAttempts})`,
              elapsed: elapsed,
            })
            .catch(() => { });
        }
      } catch (e) {
        console.log("发送进度消息失败:", e);
      }

      // 检查成功
      if (
        status === successValue ||
        new RegExp(successValue).test(String(status))
      ) {
        responseData = pollData; // 更新最终响应数据
        break;
      }

      // 检查失败 (可选，简单起见如果状态含有 fail/error 字样则报错)
      if (/fail|error/i.test(String(status))) {
        const err = new Error(`任务失败，状态: ${status}`);
        err.debugData = {
          providerName: config.name,
          request: isMultipartRequest ? "FormData (multipart)" : requestBody,
          response: { jobId, lastStatus, lastPollData, attempts },
        };
        throw err;
      }
    }

    if (attempts >= maxAttempts) {
      const err = new Error("轮询超时");
      err.debugData = {
        providerName: config.name,
        request: isMultipartRequest ? "FormData (multipart)" : requestBody,
        response: { jobId, lastStatus, lastPollData, attempts, maxAttempts },
      };
      throw err;
    }
  }

  // 3. 提取图片
  let finalImageUrl = extractImageUrl(responseData, responsePath);

  if (!finalImageUrl) {
    const err = new Error("API响应中未找到图片字段");
    err.debugData = {
      providerName: config.name,
      request: isMultipartRequest ? "FormData (multipart)" : requestBody,
      response: responseData,
    };
    throw err;
  }

  // 发送状态更新：结果已接收
  await sendStatusUpdate("结果已接收");

  if (finalImageUrl.startsWith("http")) {
    // 发送状态更新：图片下载中
    await sendStatusUpdate("图片下载中");
    finalImageUrl = await downloadImageAsBase64(finalImageUrl);
  }

  return {
    requestBody: isMultipartRequest ? "FormData (multipart)" : requestBody,
    responseData,
    result: { success: true, imageUrl: finalImageUrl },
  };
}

function extractImageUrl(data, customPath) {
  if (customPath) {
    const url = getValueByPath(data, customPath);
    if (url) return url;
  }

  if (data.data && data.data[0]) {
    return (
      data.data[0].url ||
      (data.data[0].b64_json
        ? `data:image/png;base64,${data.data[0].b64_json}`
        : null)
    );
  }
  if (data.artifacts && data.artifacts[0])
    return `data:image/png;base64,${data.artifacts[0].base64}`;
  if (data.output)
    return Array.isArray(data.output) ? data.output[0] : data.output;
  if (data.url) return data.url;
  if (data.image) return data.image;
  return null;
}

function getValueByPath(obj, path) {
  if (!path) return null;
  const parts = path
    .replace(/\[(\w+)\]/g, ".$1")
    .replace(/^\./, "")
    .split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null) return null;
    current = current[part];
  }
  return current;
}

function setValueByPath(obj, path, value) {
  if (!path) return;
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (
      !(part in current) ||
      typeof current[part] !== "object" ||
      current[part] === null
    ) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

async function downloadImageAsBase64(url) {
  console.log("downloadImageAsBase64 开始下载:", url);
  try {
    // 从 URL 中提取 origin 作为 Referer
    let referer = '';
    try {
      const urlObj = new URL(url);
      referer = urlObj.origin + '/';
      console.log("提取的 Referer:", referer);
    } catch (e) {
      console.warn("无法解析 URL:", e);
    }

    const headers = {
      'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // 添加 Referer（如果成功提取）
    if (referer) {
      headers['Referer'] = referer;
    }

    const response = await fetch(url, { headers });

    console.log("下载响应:", {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type')
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');

    // 检查是否真的是图片
    if (!contentType || !contentType.startsWith('image/')) {
      console.error("响应不是图片类型:", contentType);
      throw new Error(`服务器返回的不是图片，而是: ${contentType || '未知类型'}`);
    }

    const blob = await response.blob();
    console.log("Blob 创建成功:", {
      size: blob.size,
      type: blob.type
    });

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        console.log("图片转换为 base64 成功，长度:", reader.result.length);
        resolve(reader.result);
      };
      reader.onerror = () => {
        console.error("FileReader 转换失败");
        reject(new Error("图片转换失败"));
      };
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("下载图片失败:", error);
    throw new Error("下载图片失败: " + error.message);
  }
}

async function getCurrentProvider() {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings || !settings.providers || settings.providers.length === 0)
    return null;
  return settings.providers.find((p) => p.isCurrent) || settings.providers[0];
}

async function saveToHistory(item) {
  const { settings } = await chrome.storage.local.get("settings");
  const maxItems = settings?.maxHistory || MAX_HISTORY_ITEMS;

  const stored = await chrome.storage.local.get(["history"]);
  let history = stored.history || [];
  history.unshift(item);
  if (history.length > maxItems) history = history.slice(0, maxItems);

  // 尝试保存，如果配额超出则抛出特定错误供页面处理
  try {
    await chrome.storage.local.set({ history });
  } catch (error) {
    if (error.message && error.message.includes("quota")) {
      console.warn("存储配额不足，需要用户确认清理");
      // 抛出特定错误，让页面显示确认对话框
      const quotaError = new Error("QUOTA_EXCEEDED");
      quotaError.historyCount = history.length;
      throw quotaError;
    } else {
      throw error;
    }
  }
}

// 注入到页面的配额超出确认对话框
function showQuotaExceededDialog(historyCount) {
  // 移除已有的对话框
  const existing = document.getElementById("ai-draw-quota-dialog");
  if (existing) existing.remove();

  const dialog = document.createElement("div");
  dialog.id = "ai-draw-quota-dialog";
  dialog.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 2147483647;
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  dialog.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 12px; max-width: 400px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
      <h3 style="margin: 0 0 12px; color: #1a202c; font-size: 18px;">存储空间不足</h3>
      <p style="color: #4a5568; margin: 0 0 8px; font-size: 14px;">
        当前有 <strong>${historyCount}</strong> 条历史记录，Chrome 存储配额已满。
      </p>
      <p style="color: #718096; margin: 0 0 20px; font-size: 13px;">
        图片已成功生成，但无法保存到历史记录。<br>
        是否清理一半的旧记录以腾出空间？
      </p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="ai-quota-cancel" style="
          padding: 10px 20px; border-radius: 6px; border: 1px solid #e2e8f0;
          background: #f7fafc; color: #4a5568; cursor: pointer; font-weight: 500;
        ">暂不清理</button>
        <button id="ai-quota-confirm" style="
          padding: 10px 20px; border-radius: 6px; border: none;
          background: #e53e3e; color: white; cursor: pointer; font-weight: 500;
        ">清理旧记录</button>
      </div>
    </div>
  `;

  document.body.appendChild(dialog);

  document.getElementById("ai-quota-cancel").onclick = () => dialog.remove();
  document.getElementById("ai-quota-confirm").onclick = async () => {
    try {
      await chrome.runtime.sendMessage({ action: "clearHalfHistory" });
      dialog.remove();
      // 显示成功提示
      alert("已清理旧记录，请重新生成图片以保存到历史记录。");
    } catch (e) {
      alert("清理失败: " + e.message);
    }
  };

  dialog.onclick = (e) => {
    if (e.target === dialog) dialog.remove();
  };
}

async function showNotification(message, type = "info") {
  const { settings } = await chrome.storage.local.get("settings");

  // 如果禁用了系统通知，只打印日志
  if (settings && settings.useNotifications === false) {
    console.log("系统通知已禁用:", message);
    return;
  }

  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "AI画图助手",
    message: message,
  });
}

// 注入到页面的加载状态函数
function showInjectedLoadingStatus(prompt, elapsed = 0) {
  let container = document.getElementById("ai-draw-mini-status");
  if (!container) {
    container = document.createElement("div");
    container.id = "ai-draw-mini-status";
    container.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      background: white; border-radius: 12px; padding: 12px 20px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      display: flex; align-items: center; gap: 12px; font-family: -apple-system, sans-serif;
      border: 1px solid #edf2f7;
    `;
    document.body.appendChild(container);
  }

  // 添加动画样式
  if (!document.getElementById("ai-draw-spin-style")) {
    const style = document.createElement("style");
    style.id = "ai-draw-spin-style";
    style.textContent = `@keyframes ai-draw-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
    document.head.appendChild(style);
  }

  const elapsedText = elapsed > 0 ? ` (${elapsed}s)` : "";
  container.innerHTML = `
    <div style="width: 20px; height: 20px; border: 2.5px solid #f3f3f3; border-top: 2.5px solid #667eea; border-radius: 50%; animation: ai-draw-spin 0.8s linear infinite;"></div>
    <span style="font-size: 14px; color: #4a5568; font-weight: 500;">AI 正在创作中...${elapsedText}</span>
    <div id="ai-draw-mini-close" style="cursor: pointer; padding: 4px; color: #a0aec0; line-height: 1;">&times;</div>
  `;

  document.getElementById("ai-draw-mini-close").onclick = () =>
    container.remove();
}

// 注入到页面的成功状态函数
function showInjectedSuccessStatus(imageUrl, prompt, allowNSFW = false) {
  let container = document.getElementById("ai-draw-mini-status");
  if (!container) {
    container = document.createElement("div");
    container.id = "ai-draw-mini-status";
    container.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      background: white; border-radius: 12px; padding: 12px 20px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      display: flex; align-items: center; gap: 12px; font-family: -apple-system, sans-serif;
      border: 1px solid #edf2f7;
    `;
    document.body.appendChild(container);
  }

  container.style.borderLeft = "4px solid #48bb78";
  container.innerHTML = `
    <span style="font-size: 18px;">✨</span>
    <span style="font-size: 14px; color: #2d3748; font-weight: 500;">生成完成！</span>
    <button id="ai-draw-mini-open" style="
      background: #667eea; color: white; border: none; padding: 6px 14px;
      border-radius: 6px; font-size: 13px; cursor: pointer; font-weight: 500;
    ">查看图片</button>
    <div id="ai-draw-mini-close" style="cursor: pointer; padding: 4px; color: #a0aec0; line-height: 1;">&times;</div>
  `;

  document.getElementById("ai-draw-mini-open").onclick = () => {
    container.remove();

    // 直接在页面中创建图片预览模态框（因为注入脚本无法使用 chrome.tabs API）
    const modalOverlay = document.createElement("div");
    modalOverlay.id = "ai-draw-injected-modal";
    modalOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); z-index: 2147483647;
      padding: 20px; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
      background: white; padding: 24px; border-radius: 16px;
      max-width: 600px; width: 90%; max-height: 90vh;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      position: relative; text-align: center; display: flex; flex-direction: column;
      overflow: hidden;
    `;

    modal.innerHTML = `
      <div style="font-weight: bold; font-size: 20px; margin-bottom: 20px; color: #1a202c; flex-shrink: 0;">🖼️ 生成成功</div>
      <div style="flex: 1; overflow-y: auto; margin-bottom: 16px; min-height: 0;">
        <div id="ai-draw-injected-img-wrapper" style="position: relative; margin-bottom: 20px; cursor: pointer; border-radius: 12px; line-height: 0; display: flex; justify-content: center; max-height: 60vh; overflow: hidden;">
          <img id="ai-draw-injected-img" src="${imageUrl}" style="
            max-width: 100%; max-height: 60vh; width: auto; height: auto;
            border-radius: 12px; border: 1px solid #edf2f7; object-fit: contain;
            transition: filter 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            ${!allowNSFW ? 'filter: blur(40px);' : ''}
          ">
          ${!allowNSFW ? `
            <div id="ai-draw-injected-nsfw" style="
              position: absolute; top:0; left:0; width:100%; height:100%;
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              background: rgba(0,0,0,0.15); color: white; text-shadow: 0 2px 8px rgba(0,0,0,0.5);
              font-size: 14px; font-weight: 600; pointer-events: none; backdrop-filter: blur(4px);
            ">
              <span style="font-size: 32px; margin-bottom: 12px;">🔞</span>
              <div style="background: rgba(0,0,0,0.4); padding: 8px 16px; border-radius: 20px;">点击查看风险内容</div>
            </div>
          ` : ''}
        </div>

        <div style="margin-bottom: 24px;">
          <div id="ai-draw-injected-prompt-toggle" style="
            font-size: 13px; color: #667eea; cursor: pointer; margin-bottom: 8px;
            display: flex; align-items: center; justify-content: center; gap: 4px;
          ">
            <span>👁️‍🗨️</span> 显示/隐藏提示词
          </div>
          <div id="ai-draw-injected-prompt-text" style="
            font-size: 14px; color: #718096; line-height: 1.5; font-style: italic;
            background: #f8fafc; padding: 12px; border-radius: 8px; display: none;
            text-align: left; word-break: break-all;
          ">
            "${prompt}"
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; flex-shrink: 0; border-top: 1px solid #f1f5f9; padding-top: 16px; margin-top: 8px;">
        <button id="ai-draw-injected-copy" style="padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s; background: #667eea; color: white; border: none;">复制图片</button>
        <button id="ai-draw-injected-download" style="padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s; background: #f3f4f6; color: #333; border: 1px solid #ddd;">下载</button>
        <button id="ai-draw-injected-share" style="display: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s; background: #f3f4f6; color: #333; border: 1px solid #ddd;" title="分享到相册">🔗</button>
        <button id="ai-draw-injected-close" style="padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 500; transition: all 0.2s; background: #f3f4f6; color: #333; border: 1px solid #ddd;">关闭</button>
      </div>
    `;

    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);

    // 提示词折叠/展开
    const promptToggle = document.getElementById("ai-draw-injected-prompt-toggle");
    const promptText = document.getElementById("ai-draw-injected-prompt-text");
    if (promptToggle && promptText) {
      promptToggle.onclick = () => {
        const isHidden = promptText.style.display === "none";
        promptText.style.display = isHidden ? "block" : "none";
        if (isHidden) {
          const contentArea = modal.querySelector('div[style*="flex: 1"]');
          if (contentArea) {
            setTimeout(() => (contentArea.scrollTop = contentArea.scrollHeight), 50);
          }
        }
      };
    }

    // 图片点击逻辑（NSFW揭示 + 全屏预览）
    const imgWrapper = document.getElementById("ai-draw-injected-img-wrapper");
    const img = document.getElementById("ai-draw-injected-img");
    const nsfwOverlay = document.getElementById("ai-draw-injected-nsfw");
    if (imgWrapper) {
      imgWrapper.onclick = (e) => {
        e.stopPropagation();
        if (!allowNSFW && img.style.filter.includes("blur")) {
          // 首次点击：移除模糊
          img.style.filter = "none";
          if (nsfwOverlay) nsfwOverlay.style.display = "none";
        } else {
          // 已揭示或无NSFW：全屏展示
          const existing = document.getElementById("ai-draw-fullscreen");
          if (existing) existing.remove();

          const fsOverlay = document.createElement("div");
          fsOverlay.id = "ai-draw-fullscreen";
          fsOverlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.92); z-index: 2147483647;
            display: flex; align-items: center; justify-content: center;
            cursor: zoom-out; padding: 20px; box-sizing: border-box;
          `;

          const fsImg = document.createElement("img");
          fsImg.src = imageUrl;
          fsImg.style.cssText = `
            max-width: 95vw; max-height: 95vh; object-fit: contain;
            border-radius: 8px; transition: transform 0.3s ease;
            cursor: default; user-select: none;
          `;

          let scale = 1;
          fsImg.addEventListener("wheel", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            scale += ev.deltaY > 0 ? -0.1 : 0.1;
            scale = Math.max(0.3, Math.min(5, scale));
            fsImg.style.transform = `scale(${scale})`;
          }, { passive: false });

          fsImg.addEventListener("dblclick", (ev) => {
            ev.stopPropagation();
            scale = 1;
            fsImg.style.transform = "scale(1)";
          });

          fsImg.onclick = (ev) => ev.stopPropagation();
          fsOverlay.onclick = () => fsOverlay.remove();

          const onKey = (ev) => {
            if (ev.key === "Escape") {
              fsOverlay.remove();
              document.removeEventListener("keydown", onKey);
            }
          };
          document.addEventListener("keydown", onKey);

          const hint = document.createElement("div");
          hint.style.cssText = `
            position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
            color: rgba(255,255,255,0.6); font-size: 13px;
            font-family: -apple-system, sans-serif; pointer-events: none;
          `;
          hint.textContent = "点击空白关闭 · 滚轮缩放 · 双击重置";

          fsOverlay.appendChild(fsImg);
          fsOverlay.appendChild(hint);
          document.body.appendChild(fsOverlay);
        }
      };
    }

    // 复制图片按钮
    const copyBtn = document.getElementById("ai-draw-injected-copy");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const originalText = copyBtn.textContent;
        try {
          copyBtn.textContent = "⌛ 正在准备...";
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
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": clipboardPromise }),
          ]);
          copyBtn.textContent = "✅ 已复制";
          setTimeout(() => (copyBtn.textContent = originalText), 2000);
        } catch (e) {
          console.error("复制失败:", e);
          copyBtn.textContent = "❌ 复制失败";
          setTimeout(() => (copyBtn.textContent = originalText), 2000);
          alert("由于浏览器限制，复制图片失败。尝试：\n1. 直接右键点击图片选择\"复制图片\"\n2. 点击\"下载\"按钮保存到本地");
        }
      };
    }

    // 下载按钮
    const downloadBtn = document.getElementById("ai-draw-injected-download");
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const link = document.createElement("a");
        link.href = imageUrl;
        link.download = `ai-generated-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        const originalText = downloadBtn.textContent;
        downloadBtn.textContent = "✅ 已下载";
        setTimeout(() => (downloadBtn.textContent = originalText), 2000);
      };
    }

    // 分享按钮（需要 chrome.runtime.sendMessage，在注入脚本中可用）
    const shareBtn = document.getElementById("ai-draw-injected-share");
    if (shareBtn && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      // 检查是否有激活的上传服务
      chrome.storage.local.get("settings", (result) => {
        const settings = result.settings;
        const uploadServices = settings?.imageUploadServices || [];
        const hasActiveUploadService = uploadServices.some(s => s.isActive);
        if (hasActiveUploadService) {
          shareBtn.style.display = "";
        }
      });

      shareBtn.onclick = () => {
        const originalText = shareBtn.textContent;
        shareBtn.textContent = "⏳";
        shareBtn.disabled = true;
        chrome.runtime.sendMessage({
          action: "uploadImageToAlbum",
          imageUrl: imageUrl,
          prompt: prompt
        }, (res) => {
          if (res && res.success) {
            shareBtn.textContent = "✅";
            shareBtn.style.background = "#48bb78";
            shareBtn.style.color = "white";
            setTimeout(() => {
              shareBtn.textContent = originalText;
              shareBtn.style.background = "";
              shareBtn.style.color = "";
              shareBtn.disabled = false;
            }, 2000);
          } else {
            shareBtn.textContent = "❌";
            shareBtn.style.background = "#f56565";
            shareBtn.style.color = "white";
            setTimeout(() => {
              shareBtn.textContent = originalText;
              shareBtn.style.background = "";
              shareBtn.style.color = "";
              shareBtn.disabled = false;
            }, 2000);
          }
        });
      };
    }

    // 关闭按钮
    document.getElementById("ai-draw-injected-close").onclick = () => modalOverlay.remove();

    // 点击背景关闭
    modalOverlay.onclick = (e) => {
      if (e.target === modalOverlay) modalOverlay.remove();
    };
  };

  document.getElementById("ai-draw-mini-close").onclick = () =>
    container.remove();
}

// 注入到页面的错误状态函数
function showInjectedErrorStatus(errorMsg, prompt) {
  let container = document.getElementById("ai-draw-mini-status");
  if (!container) {
    container = document.createElement("div");
    container.id = "ai-draw-mini-status";
    container.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      background: white; border-radius: 12px; padding: 12px 20px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      display: flex; align-items: center; gap: 12px; font-family: -apple-system, sans-serif;
      border: 1px solid #edf2f7;
    `;
    document.body.appendChild(container);
  }

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
    alert("生成失败：" + errorMsg);
  };

  document.getElementById("ai-draw-mini-close").onclick = () =>
    container.remove();
}

// 确保Header值只包含 ISO-8859-1 字符
function sanitizeHeaderValue(value) {
  if (!value) return "";
  // 移除所有非 ISO-8859-1 字符 (严格来说 HTTP header 最好只用 ASCII)
  // 我们这里先 trim 并移除所有非 ASCII 控制字符和不可见字符
  return value.trim().replace(/[^\x20-\x7E]/g, "");
}

// 消息监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSettings") {
    chrome.storage.local
      .get(["settings"])
      .then((result) => sendResponse(result.settings || DEFAULT_SETTINGS));
    return true;
  }
  if (message.action === "saveSettings") {
    chrome.storage.local.set({ settings: message.settings }).then(() => {
      updateContextMenu();
      sendResponse({ success: true });
    });
    return true;
  }
  if (message.action === "updateContextMenu") {
    updateContextMenu();
    sendResponse({ success: true });
    return true;
  }
  if (message.action === "testConnection") {
    testProvider(message.settings).then((result) => sendResponse(result));
    return true;
  }
  if (message.action === "getHistory") {
    chrome.storage.local
      .get(["history"])
      .then((stored) => sendResponse({ history: stored.history || [] }));
    return true;
  }
  if (message.action === "clearHistory") {
    (async () => {
      try {
        await chrome.storage.local.set({ history: [] });
        console.log("已清空所有历史记录");
        sendResponse({ success: true });
      } catch (e) {
        console.error("清空历史记录失败:", e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.action === "clearHalfHistory") {
    (async () => {
      try {
        const { settings } = await chrome.storage.local.get("settings");
        const stored = await chrome.storage.local.get(["history"]);
        let history = stored.history || [];
        const maxItems = settings?.maxHistory || MAX_HISTORY_ITEMS;
        // 清理一半
        const reducedHistory = history.slice(0, Math.floor(maxItems / 2));
        await chrome.storage.local.set({ history: reducedHistory });
        console.log("已清理历史记录，剩余:", reducedHistory.length);
        sendResponse({ success: true, remaining: reducedHistory.length });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.action === "deleteHistoryItem") {
    (async () => {
      const stored = await chrome.storage.local.get(["history"]);
      let history = (stored.history || []).filter(
        (item) => item.id !== message.id,
      );
      await chrome.storage.local.set({ history });
      sendResponse({ success: true });
    })();
    return true;
  }
  if (message.action === "generateImage") {
    (async () => {
      const provider = await getCurrentProvider();
      if (!provider) return;

      let tabId = sender.tab?.id;
      // 如果没有 tabId (如来自 popup)，尝试获取当前活动窗口的活动标签页
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        tabId = activeTab?.id;
      }

      await handleGenerateImage(message.prompt, message.negativePrompt, provider, tabId);
      sendResponse({ success: true });
    })();
    return true;
  }
  if (message.action === "useProvider") {
    (async () => {
      const { settings } = await chrome.storage.local.get("settings");
      if (settings) {
        settings.providers = settings.providers.map((p) => ({
          ...p,
          isCurrent: p.id === message.id,
        }));
        await chrome.storage.local.set({ settings });
        sendResponse(settings.providers.find((p) => p.id === message.id));
      }
    })();
    return true;
  }
  if (message.action === "editImage") {
    (async () => {
      try {
        const { settings } = await chrome.storage.local.get("settings");
        const provider = settings.providers.find(
          (p) => p.id === message.providerId,
        );
        if (!provider) {
          sendResponse({ success: false, error: "服务商不存在" });
          return;
        }

        const [activeTab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tabId = activeTab?.id;

        let imageUrl = message.imageUrl;

        // 如果是使用本地文件的multipart请求
        if (message.useLocalFile && message.imageData) {
          // 直接使用base64数据作为imageUrl
          imageUrl = message.imageData;
          console.log("使用本地文件数据进行改图，文件名:", message.fileName);
        }

        await handleGenerateImage(
          message.prompt,
          message.negativePrompt,
          provider,
          tabId,
          imageUrl,
          "edit",
        );
        sendResponse({ success: true });
      } catch (error) {
        console.error("改图请求处理失败:", error);
        // handleGenerateImage 内部已经处理了错误通知
        // 这里只需要确保 sendResponse 被调用
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  if (message.action === "getContextImage") {
    sendResponse({ imageUrl: contextImageUrl });
    contextImageUrl = null; // 清除
    return true;
  }
  if (message.action === "fetchBlobBase64") {
    (async () => {
      try {
        const response = await fetch(message.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          sendResponse({ success: true, base64: reader.result });
        };
        reader.onerror = () => {
          sendResponse({ success: false, error: "Failed to read blob" });
        };
      } catch (e) {
        sendResponse({ success: false, error: e.toString() });
      }
    })();
    return true;
  }
  // ==================== 图片下载和转换功能 ====================
  if (message.action === "downloadAndConvertImage") {
    console.log("收到图片下载请求:", {
      action: message.action,
      imageUrl: message.imageUrl ? message.imageUrl.substring(0, 100) + "..." : "none"
    });
    (async () => {
      try {
        console.log("开始下载图片:", message.imageUrl);
        const base64 = await downloadImageAsBase64(message.imageUrl);
        console.log("图片下载成功，base64 长度:", base64.length);
        sendResponse({ success: true, base64: base64 });
      } catch (e) {
        console.error("图片下载失败:", e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  // ==================== 图片上传功能 ====================
  if (message.action === "uploadImage") {
    console.log("收到上传图片请求:", {
      action: message.action,
      fileName: message.fileName,
      imageDataLength: message.imageData ? message.imageData.length : 0,
      imageDataType: message.imageData ? (message.imageData.startsWith('data:') ? 'base64' : 'unknown') : 'none'
    });
    (async () => {
      try {
        const { settings } = await chrome.storage.local.get("settings");
        console.log("开始调用 uploadImageToService...");
        const result = await uploadImageToService(message.imageData, message.fileName, settings);
        console.log("uploadImageToService 成功返回:", result);
        sendResponse(result);
      } catch (e) {
        console.error("uploadImageToService 失败:", e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.action === "uploadImageToAlbum") {
    (async () => {
      try {
        const { settings } = await chrome.storage.local.get("settings");
        const result = await uploadImageToAlbum(message.imageUrl, message.prompt, settings);
        sendResponse(result);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.action === "testImageUpload") {
    (async () => {
      try {
        const result = await testImageUploadService(message.config, message.testImageBlob);
        sendResponse(result);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  // ==================== WebDAV 同步功能 ====================
  if (message.action === "webdavTest") {
    (async () => {
      try {
        const result = await webdavRequest(message.config, "PROPFIND");
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.action === "webdavUpload") {
    (async () => {
      try {
        await webdavUploadFile(message.config, message.data);
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.action === "webdavDownload") {
    (async () => {
      try {
        const data = await webdavDownloadFile(message.config);
        sendResponse({ success: true, data: data });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "draw-image") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab) return;

    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "getSelection",
      });
      const prompt = response?.selectionText;

      if (prompt) {
        const provider = await getCurrentProvider();
        if (provider) {
          handleGenerateImage(prompt, "", provider, tab.id);
        }
      } else {
        showNotification("请先选中网页上的文字再使用快捷键生成");
      }
    } catch (err) {
      console.log("快捷键执行失败 (可能页面未就绪):", err);
    }
  }
});

async function testProvider(settings) {
  try {
    const { endpoint, apiKey, customHeaders, customParams } = settings;
    if (!endpoint) return { success: false, error: "缺少端点" };

    const headers = {
      "Content-Type": "application/json",
      ...customHeaders,
    };

    if (apiKey) {
      const sanitizedKey = sanitizeHeaderValue(apiKey);
      const authHeader = sanitizedKey.toLowerCase().startsWith("bearer ")
        ? sanitizedKey
        : `Bearer ${sanitizedKey}`;

      if (!headers["Authorization"] && !headers["authorization"]) {
        headers["Authorization"] = authHeader;
      }
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ prompt: "test", n: 1, ...customParams }),
    });
    if (!response.ok)
      return { success: false, error: `HTTP ${response.status}` };
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ==================== WebDAV 辅助函数 ====================

/**
 * 构造 WebDAV URL（确保路径以 / 结尾）
 */
function buildWebDAVUrl(baseUrl, filename) {
  let url = baseUrl;
  if (!url.endsWith("/")) {
    url += "/";
  }
  // 移除重复的斜杠
  url += filename.replace(/\/+/g, "/");
  return url;
}

/**
 * 通用 WebDAV 请求函数
 */
async function webdavRequest(config, method, data = null) {
  const { url, username, password } = config;
  const targetUrl = buildWebDAVUrl(url, config.filename || "ai-drawer-config.json");

  const headers = {
    "Content-Type": "application/json",
  };

  // 添加 Basic Auth（如果有凭证）
  if (username && password) {
    headers["Authorization"] = "Basic " + btoa(username + ":" + password);
  }

  const options = {
    method: method,
    headers: headers,
  };

  if (data) {
    options.body = data;
    if (method === "PUT") {
      headers["Content-Type"] = "application/json";
    }
  }

  const response = await fetch(targetUrl, options);

  // WebDAV 需要 201 Created 或 204 No Content 表示成功
  if (!response.ok && response.status !== 201 && response.status !== 204) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorText = await response.text();
      if (errorText) {
        errorMsg = errorText.slice(0, 200);
      }
    } catch (e) { }
    throw new Error(errorMsg);
  }

  return { ok: response.ok, status: response.status };
}

/**
 * 上传文件到 WebDAV
 */
async function webdavUploadFile(config, data) {
  const { url, username, password } = config;
  const targetUrl = buildWebDAVUrl(url, config.filename || "ai-drawer-config.json");

  const headers = {
    "Content-Type": "application/json",
  };

  // 添加 Basic Auth
  if (username && password) {
    headers["Authorization"] = "Basic " + btoa(username + ":" + password);
  }

  const response = await fetch(targetUrl, {
    method: "PUT",
    headers: headers,
    body: data,
  });

  if (!response.ok && response.status !== 201) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorText = await response.text();
      if (errorText) {
        errorMsg = errorText.slice(0, 200);
      }
    } catch (e) { }
    throw new Error("上传失败: " + errorMsg);
  }
}

/**
 * 从 WebDAV 下载文件
 */
async function webdavDownloadFile(config) {
  const { url, username, password } = config;
  const targetUrl = buildWebDAVUrl(url, config.filename || "ai-drawer-config.json");

  const headers = {};

  // 添加 Basic Auth
  if (username && password) {
    headers["Authorization"] = "Basic " + btoa(username + ":" + password);
  }

  const response = await fetch(targetUrl, {
    method: "GET",
    headers: headers,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("文件不存在");
    }
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorText = await response.text();
      if (errorText) {
        errorMsg = errorText.slice(0, 200);
      }
    } catch (e) { }
    throw new Error("下载失败: " + errorMsg);
  }

  return await response.text();
}
// ==================== 图片上传服务功能 ====================

/**
 * 上传图片到配置的上传服务
 */
async function uploadImageToService(imageData, fileName, settings) {
  console.log("uploadImageToService 开始执行:", {
    imageData: imageData ? `${imageData.substring(0, 50)}...` : 'null',
    fileName: fileName,
    settingsExists: !!settings
  });

  // 获取激活的上传服务
  const uploadServices = settings.imageUploadServices || [];
  const activeService = uploadServices.find(service => service.isActive);

  console.log("上传服务检查:", {
    总服务数: uploadServices.length,
    激活服务: activeService ? activeService.name : '无',
    服务列表: uploadServices.map(s => ({ name: s.name, active: s.isActive }))
  });

  if (!activeService) {
    console.error("未找到激活的上传服务");
    throw new Error("未配置或激活图片上传服务");
  }

  const {
    url: imageUploadUrl,
    key: imageUploadKey,
    authType: imageUploadAuthType,
    headerName: imageUploadHeaderName,
    responsePath: imageUploadResponsePath,
    fieldName: imageUploadFieldName,
    format: imageUploadFormat,
    customParams: imageUploadCustomParams
  } = activeService;

  console.log("上传服务配置:", {
    url: imageUploadUrl,
    authType: imageUploadAuthType,
    fieldName: imageUploadFieldName,
    format: imageUploadFormat,
    hasKey: !!imageUploadKey
  });

  // 将base64转换为blob
  console.log("开始转换 base64 为 blob...");
  try {
    // 从 base64 字符串中提取 MIME 类型
    let mimeType = 'image/png'; // 默认类型
    if (imageData.startsWith('data:')) {
      const matches = imageData.match(/^data:([^;]+);/);
      if (matches && matches[1]) {
        mimeType = matches[1];
        console.log("从 base64 中提取到 MIME 类型:", mimeType);
      }
    }

    const response = await fetch(imageData);
    let blob = await response.blob();

    // 如果 blob 的 type 为空或不正确，创建一个新的 blob 并指定正确的类型
    if (!blob.type || blob.type === 'application/octet-stream') {
      console.log("Blob type 不正确，重新创建 blob 并指定 MIME 类型:", mimeType);
      blob = new Blob([blob], { type: mimeType });
    }

    console.log("base64 转换成功:", {
      blobSize: blob.size,
      blobType: blob.type
    });

    // 创建FormData
    const formData = new FormData();

    // 根据 MIME 类型确定文件扩展名
    let fileExtension = 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      fileExtension = 'jpg';
    } else if (mimeType.includes('gif')) {
      fileExtension = 'gif';
    } else if (mimeType.includes('webp')) {
      fileExtension = 'webp';
    }

    const finalFileName = fileName || `image.${fileExtension}`;
    formData.append(imageUploadFieldName || 'source', blob, finalFileName);
    console.log("FormData 创建成功，添加了图片文件:", finalFileName);

    // 构建请求头
    const headers = {};

    // 根据认证方式设置认证信息
    if (imageUploadKey) {
      const authType = imageUploadAuthType || 'header';
      const headerName = imageUploadHeaderName || 'X-API-Key';

      switch (authType) {
        case 'header':
          headers[headerName] = imageUploadKey;
          console.log(`添加认证头: ${headerName}`);
          break;
        case 'bearer':
          headers["Authorization"] = `Bearer ${imageUploadKey}`;
          console.log("添加 Bearer 认证");
          break;
        case 'param':
          // 参数认证：将key添加到FormData中
          formData.append('key', imageUploadKey);
          console.log("添加 key 参数到 FormData");
          break;
      }
    }

    // 如果指定了响应格式，添加到FormData
    const format = imageUploadFormat || 'json';
    if (format !== 'json') {
      formData.append('format', format);
      console.log(`添加格式参数: ${format}`);
    }

    // 添加自定义参数（只使用"临时上传"和"通用"参数）
    if (imageUploadCustomParams && typeof imageUploadCustomParams === 'object') {
      Object.entries(imageUploadCustomParams).forEach(([key, paramConfig]) => {
        if (key && paramConfig !== undefined && paramConfig !== null && paramConfig !== '') {
          let value, usage;

          // 检查是否是新格式（包含usage信息）
          if (paramConfig && typeof paramConfig === "object" && paramConfig.value !== undefined) {
            value = paramConfig.value;
            usage = paramConfig.usage || "common";
          } else {
            // 旧格式兼容
            value = paramConfig;
            usage = "common";
          }

          // 只使用"临时上传"和"通用"参数
          if (usage === "temp" || usage === "common") {
            if (value !== '') {
              formData.append(key, String(value));
              console.log(`添加临时上传参数: ${key} = ${value} (${usage})`);
            }
          } else {
            console.log(`跳过参数 ${key} (仅用于${usage})`);
          }
        }
      });
    }

    console.log("开始上传图片:", {
      服务名称: activeService.name,
      上传端点: imageUploadUrl,
      认证方式: imageUploadAuthType,
      文件字段名: imageUploadFieldName,
      文件名: fileName,
      文件大小: imageData ? Math.round(imageData.length / 1024) + 'KB' : '未知'
    });

    const uploadResponse = await fetch(imageUploadUrl, {
      method: "POST",
      headers: headers,
      body: formData,
    });

    console.log("上传请求完成:", {
      status: uploadResponse.status,
      statusText: uploadResponse.statusText,
      ok: uploadResponse.ok
    });

    if (!uploadResponse.ok) {
      let errorMsg = `HTTP ${uploadResponse.status}`;
      try {
        const errorData = await uploadResponse.json();
        console.log("上传失败，错误响应:", errorData);
        errorMsg = errorData.message || errorData.error || errorData.status_txt || errorData.msg || errorData.detail;
        if (!errorMsg) {
          // 如果没有找到标准错误字段，尝试获取更多信息
          const errorKeys = Object.keys(errorData);
          if (errorKeys.length > 0) {
            errorMsg = `服务器返回错误: ${JSON.stringify(errorData)}`;
          } else {
            errorMsg = `HTTP ${uploadResponse.status} - 未知错误`;
          }
        }
      } catch (e) {
        console.log("无法解析错误响应为 JSON，尝试文本:", e);
        try {
          const errorText = await uploadResponse.text();
          console.log("错误响应文本:", errorText);
          errorMsg = errorText || `HTTP ${uploadResponse.status}`;
        } catch (e2) {
          console.log("无法解析错误响应为文本:", e2);
          errorMsg = `HTTP ${uploadResponse.status} - 无法解析错误信息`;
        }
      }
      console.error("上传失败，最终错误信息:", errorMsg);
      throw new Error("上传失败: " + errorMsg);
    }

    let imageUrl;

    if (format === 'txt') {
      // 纯文本响应，直接作为URL
      imageUrl = await uploadResponse.text();
      imageUrl = imageUrl.trim();
      console.log("文本格式响应，图片URL:", imageUrl);
    } else {
      // JSON响应，按路径提取
      const responseData = await uploadResponse.json();
      console.log("上传响应:", responseData);

      // 提取图片URL
      imageUrl = getValueByPath(responseData, imageUploadResponsePath || 'image.url');

      if (!imageUrl) {
        // 如果按配置路径找不到，尝试常见的路径
        const commonPaths = ['image.url', 'data.url', 'url', 'link', 'image.image.url'];
        for (const path of commonPaths) {
          imageUrl = getValueByPath(responseData, path);
          if (imageUrl) {
            console.log(`在路径 ${path} 找到图片URL:`, imageUrl);
            break;
          }
        }
      } else {
        console.log(`在配置路径 ${imageUploadResponsePath} 找到图片URL:`, imageUrl);
      }
    }

    if (!imageUrl) {
      console.error("无法提取图片URL，响应路径:", imageUploadResponsePath);
      throw new Error(`无法从响应中提取图片URL，路径: ${imageUploadResponsePath}`);
    }

    console.log("上传成功，返回结果:", { success: true, imageUrl: imageUrl });
    return { success: true, imageUrl: imageUrl };

  } catch (error) {
    console.error("uploadImageToService 执行过程中出错:", error);
    throw error;
  }
}

/**
 * 上传图片到相册（会过滤过期参数）
 */
async function uploadImageToAlbum(imageUrl, prompt, settings) {
  // 获取激活的上传服务
  const uploadServices = settings.imageUploadServices || [];
  const activeService = uploadServices.find(service => service.isActive);

  if (!activeService) {
    throw new Error("未配置或激活图片上传服务");
  }

  const {
    url: imageUploadUrl,
    key: imageUploadKey,
    authType: imageUploadAuthType,
    headerName: imageUploadHeaderName,
    responsePath: imageUploadResponsePath,
    fieldName: imageUploadFieldName,
    format: imageUploadFormat,
    customParams: imageUploadCustomParams
  } = activeService;

  // 将图片URL转换为blob
  let blob;
  if (imageUrl.startsWith('data:')) {
    // Base64图片
    const response = await fetch(imageUrl);
    blob = await response.blob();
  } else {
    // 普通URL图片
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`无法下载图片: HTTP ${response.status}。这可能是由于网站的安全策略限制。`);
      }
      blob = await response.blob();
    } catch (fetchError) {
      if (fetchError.name === 'TypeError' && fetchError.message.includes('fetch')) {
        throw new Error("无法访问图片，可能是由于网站的跨域安全策略限制");
      }
      throw fetchError;
    }
  }

  // 创建FormData
  const formData = new FormData();
  formData.append(imageUploadFieldName || 'source', blob, 'album-image.png');

  // 构建请求头
  const headers = {};

  // 根据认证方式设置认证信息
  if (imageUploadKey) {
    const authType = imageUploadAuthType || 'header';
    const headerName = imageUploadHeaderName || 'X-API-Key';

    switch (authType) {
      case 'header':
        headers[headerName] = imageUploadKey;
        break;
      case 'bearer':
        headers["Authorization"] = `Bearer ${imageUploadKey}`;
        break;
      case 'param':
        // 参数认证：将key添加到FormData中
        formData.append('key', imageUploadKey);
        break;
    }
  }

  // 如果指定了响应格式，添加到FormData
  const format = imageUploadFormat || 'json';
  if (format !== 'json') {
    formData.append('format', format);
  }

  // 添加自定义参数（按使用场景筛选）
  if (imageUploadCustomParams && typeof imageUploadCustomParams === 'object') {
    Object.entries(imageUploadCustomParams).forEach(([key, paramConfig]) => {
      if (key && paramConfig !== undefined && paramConfig !== null && paramConfig !== '') {
        let value, usage;

        // 检查是否是新格式（包含usage信息）
        if (paramConfig && typeof paramConfig === "object" && paramConfig.value !== undefined) {
          value = paramConfig.value;
          usage = paramConfig.usage || "common";
        } else {
          // 旧格式兼容
          value = paramConfig;
          usage = "common";
        }

        // 只使用"上传到相册"和"通用"参数
        if (usage === "album" || usage === "common") {
          if (value !== '') {
            formData.append(key, String(value));
            console.log(`添加相册上传参数: ${key} = ${value} (${usage})`);
          }
        } else {
          console.log(`跳过参数 ${key} (仅用于${usage})`);
        }
      }
    });
  }

  console.log("开始上传图片到相册:", {
    服务名称: activeService.name,
    上传端点: imageUploadUrl,
    提示词: prompt
  });

  const uploadResponse = await fetch(imageUploadUrl, {
    method: "POST",
    headers: headers,
    body: formData,
  });

  if (!uploadResponse.ok) {
    let errorMsg = `HTTP ${uploadResponse.status}`;
    try {
      const errorData = await uploadResponse.json();
      errorMsg = errorData.message || errorData.error || errorData.status_txt || errorData.msg || errorData.detail;
      if (!errorMsg) {
        const errorKeys = Object.keys(errorData);
        if (errorKeys.length > 0) {
          errorMsg = `服务器返回错误: ${JSON.stringify(errorData)}`;
        } else {
          errorMsg = `HTTP ${uploadResponse.status} - 未知错误`;
        }
      }
    } catch (e) {
      try {
        const errorText = await uploadResponse.text();
        errorMsg = errorText || `HTTP ${uploadResponse.status}`;
      } catch (e2) {
        errorMsg = `HTTP ${uploadResponse.status} - 无法解析错误信息`;
      }
    }
    throw new Error("上传到相册失败: " + errorMsg);
  }

  let albumImageUrl;

  if (format === 'txt') {
    // 纯文本响应，直接作为URL
    albumImageUrl = await uploadResponse.text();
    albumImageUrl = albumImageUrl.trim();
  } else {
    // JSON响应，按路径提取
    const responseData = await uploadResponse.json();
    console.log("相册上传响应:", responseData);

    // 提取图片URL
    albumImageUrl = getValueByPath(responseData, imageUploadResponsePath || 'image.url');

    if (!albumImageUrl) {
      // 如果按配置路径找不到，尝试常见的路径
      const commonPaths = ['image.url', 'data.url', 'url', 'link', 'image.image.url'];
      for (const path of commonPaths) {
        albumImageUrl = getValueByPath(responseData, path);
        if (albumImageUrl) {
          console.log(`在路径 ${path} 找到相册图片URL:`, albumImageUrl);
          break;
        }
      }
    }
  }

  if (!albumImageUrl) {
    throw new Error(`无法从响应中提取相册图片URL，路径: ${imageUploadResponsePath}`);
  }

  return { success: true, imageUrl: albumImageUrl };
}

/**
 * 测试图片上传服务
 */
async function testImageUploadService(config, testImageBlob) {
  const {
    uploadUrl,
    uploadKey,
    authType,
    headerName,
    responsePath,
    fieldName,
    format,
    customParams
  } = config;

  if (!uploadUrl) {
    throw new Error("请输入上传服务端点");
  }

  // 将base64转换为blob
  const response = await fetch(testImageBlob);
  const blob = await response.blob();

  // 创建FormData
  const formData = new FormData();
  formData.append(fieldName || 'source', blob, 'test.png');

  // 构建请求头
  const headers = {};

  // 根据认证方式设置认证信息
  if (uploadKey) {
    const auth = authType || 'header';
    const header = headerName || 'X-API-Key';

    switch (auth) {
      case 'header':
        headers[header] = uploadKey;
        break;
      case 'bearer':
        headers["Authorization"] = `Bearer ${uploadKey}`;
        break;
      case 'param':
        // 参数认证：将key添加到FormData中
        formData.append('key', uploadKey);
        break;
    }
  }

  // 如果指定了响应格式，添加到FormData
  const responseFormat = format || 'json';
  if (responseFormat !== 'json') {
    formData.append('format', responseFormat);
  }

  // 添加自定义参数
  if (customParams && typeof customParams === 'object') {
    Object.entries(customParams).forEach(([key, paramConfig]) => {
      if (key && paramConfig !== undefined && paramConfig !== null && paramConfig !== '') {
        let value;

        // 检查是否是新格式（包含usage信息）
        if (paramConfig && typeof paramConfig === "object" && paramConfig.value !== undefined) {
          value = paramConfig.value;
        } else {
          // 旧格式兼容
          value = paramConfig;
        }

        if (value !== '') {
          formData.append(key, String(value));
          console.log(`测试时添加自定义参数: ${key} = ${value}`);
        }
      }
    });
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: headers,
    body: formData,
  });

  if (!uploadResponse.ok) {
    let errorMsg = `HTTP ${uploadResponse.status}`;
    try {
      const errorData = await uploadResponse.json();
      errorMsg = errorData.message || errorData.error || errorData.status_txt || errorData.msg || errorData.detail;
      if (!errorMsg) {
        // 如果没有找到标准错误字段，尝试获取更多信息
        const errorKeys = Object.keys(errorData);
        if (errorKeys.length > 0) {
          errorMsg = `服务器返回错误: ${JSON.stringify(errorData)}`;
        } else {
          errorMsg = `HTTP ${uploadResponse.status} - 未知错误`;
        }
      }
    } catch (e) {
      try {
        const errorText = await uploadResponse.text();
        errorMsg = errorText || `HTTP ${uploadResponse.status}`;
      } catch (e2) {
        errorMsg = `HTTP ${uploadResponse.status} - 无法解析错误信息`;
      }
    }
    throw new Error(errorMsg);
  }

  let imageUrl;

  if (responseFormat === 'txt') {
    // 纯文本响应
    imageUrl = await uploadResponse.text();
    imageUrl = imageUrl.trim();
  } else {
    // JSON响应
    const responseData = await uploadResponse.json();

    // 尝试提取图片URL以验证响应格式
    imageUrl = getValueByPath(responseData, responsePath || 'image.url');

    if (!imageUrl) {
      // 如果按配置路径找不到，尝试常见的路径
      const commonPaths = ['image.url', 'data.url', 'url', 'link', 'image.image.url'];
      for (const path of commonPaths) {
        imageUrl = getValueByPath(responseData, path);
        if (imageUrl) {
          console.log(`测试：在路径 ${path} 找到图片URL`);
          break;
        }
      }
    }

    if (!imageUrl) {
      console.warn("测试成功但无法提取图片URL，请检查响应路径配置");
      console.log("响应数据:", responseData);
    }
  }

  return { success: true, imageUrl: imageUrl };
}