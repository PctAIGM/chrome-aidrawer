// AI画图助手 - 后台脚本

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
      handleGenerateImage(info.selectionText, provider, tab.id);
    }
  } else if (info.menuItemId.startsWith("edit-with-")) {
    const providerId = info.menuItemId.replace("edit-with-", "");
    const { settings } = await chrome.storage.local.get("settings");
    const provider = settings.providers.find((p) => p.id === providerId);
    if (provider) {
      // 检查是否有图片URL或配置了上传服务
      const uploadServices = settings?.imageUploadServices || [];
      const hasUploadService = uploadServices.some(service => service.isActive);
      
      if (info.srcUrl) {
        // 有右键图片，直接使用
        chrome.tabs
          .sendMessage(tab.id, {
            action: "showEditDialog",
            imageUrl: info.srcUrl,
            providerId: providerId,
            providerName: provider.name,
          })
          .catch((err) => console.log("页面未就绪，消息未发送:", err));
      } else if (hasUploadService) {
        // 没有右键图片但有上传服务，显示文件选择对话框
        chrome.tabs
          .sendMessage(tab.id, {
            action: "showEditDialog",
            imageUrl: null,
            providerId: providerId,
            providerName: provider.name,
          })
          .catch((err) => console.log("页面未就绪，消息未发送:", err));
      } else {
        // 既没有图片也没有上传服务
        showNotification("请先配置图片上传服务或右键点击图片使用改图功能", "error");
      }
    }
  } else if (info.menuItemId === "ai-draw-history") {
    chrome.tabs.create({ url: "history.html" });
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

  } else if (message.action === "saveImage") {
    // 处理来自页面或其他地方的手动保存请求
    chrome.storage.local.get("settings").then((res) => {
      const settings = res.settings || DEFAULT_SETTINGS;
      saveImageToLocal(
        message.imageUrl,
        message.prompt,
        message.savePath || settings.savePath,
      )
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
    });
    return true;
  }
});

// 处理图片生成
async function handleGenerateImage(
  prompt,
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

  showNotification(`正在使用 ${provider.name} ${opText}...`);

  // 发送加载状态到页面
  if (tabId) {
    chrome.tabs
      .sendMessage(tabId, {
        action: "imageLoading",
        prompt: prompt,
      })
      .catch(async (err) => {
        console.log("消息发送失败，尝试注入脚本:", err.message);
        // 如果消息发送失败，尝试使用 scripting API
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: showInjectedLoadingStatus,
            args: [prompt],
          });
        } catch (e) {
          console.log("脚本注入也失败:", e.message);
        }
      });
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
      // 异步模式参数
      asyncMode: provider.asyncMode,
      jobIdPath: provider.jobIdPath,
      pollUrl: provider.pollUrl,
      statusPath: provider.statusPath,
      successValue: provider.successValue,
      pollInterval: provider.pollInterval,
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
        chrome.tabs
          .sendMessage(tabId, {
            action: "imageGenerated",
            imageUrl: result.imageUrl,
            prompt: prompt,
            debugData: {
              providerName: provider.name,
              request: requestBody,
              response: responseData,
            },
          })
          .catch(async (err) => {
            console.log("消息发送失败，尝试注入脚本:", err.message);
            try {
              const { settings: s } =
                await chrome.storage.local.get("settings");
              const allowNSFW = !!s?.allowNSFW;
              await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: showInjectedSuccessStatus,
                args: [result.imageUrl, prompt, allowNSFW],
              });
            } catch (e) {
              console.log("脚本注入也失败:", e.message);
            }
          });
      }
    }
  } catch (error) {
    // console.info(`${opText}失败:`, error);
    showNotification(`${opText}失败: ` + error.message, "error");

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
      chrome.tabs
        .sendMessage(tabId, {
          action: "imageError",
          error: error.message,
          prompt: prompt,
          debugData: error.debugData || { providerName: provider.name },
        })
        .catch(async (err) => {
          console.log("消息发送失败，尝试注入脚本:", err.message);
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: showInjectedErrorStatus,
              args: [error.message, prompt],
            });
          } catch (e) {
            console.log("脚本注入也失败:", e.message);
          }
        });
    }
  }
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
  } = config;

  const requestBody = {};

  // 处理自定义参数，支持字段类型映射和嵌套键 (如 input.prompt)
  for (const [key, value] of Object.entries(customParams)) {
    let finalValue;
    // 检查是否是新格式（带fieldType）
    if (value && typeof value === "object" && value.fieldType) {
      if (value.fieldType === "prompt") {
        // 提示词字段
        finalValue = prompt;
      } else if (value.fieldType === "imageUrl" && imageUrl) {
        // 图片URL字段（仅改图时）
        finalValue = imageUrl;
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
    setValueByPath(requestBody, key, finalValue);
  }

  // 如果没有配置提示词字段，使用默认的prompt字段
  const hasPromptField = Object.values(customParams).some(
    (v) => v && typeof v === "object" && v.fieldType === "prompt",
  );
  if (!hasPromptField) {
    requestBody.prompt = prompt;
  }

  // 默认添加 n:1 （如果还没有）
  if (!requestBody.n && !requestBody.N) {
    requestBody.n = 1;
  }

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

  console.log("发送API请求到:", endpoint);
  console.log("请求体:", requestBody);

  let responseData = null;

  // 1. 发送初始请求
  const response = await fetch(endpoint, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      responseData = await response.json();
      errorMsg =
        responseData.message ||
        responseData.detail ||
        JSON.stringify(responseData);
    } catch (e) { }
    const err = new Error(errorMsg);
    err.debugData = {
      providerName: config.name,
      request: requestBody,
      response: responseData,
    };
    throw err;
  }

  responseData = await response.json();

  // 2. 如果是异步模式，进入轮询流程
  if (asyncMode) {
    console.log("进入异步轮询模式...");
    const jobId = getValueByPath(responseData, jobIdPath);
    if (!jobId) {
      throw new Error(`无法获取任务ID，路径: ${jobIdPath}`);
    }

    const actualPollUrl = pollUrl.replace("{id}", jobId);
    const intervalMs = (pollInterval || 2) * 1000;
    const maxAttempts = 60; // 防止无限循环，最大轮询次数
    let attempts = 0;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      attempts++;

      console.log(`轮询第 ${attempts} 次: ${actualPollUrl}`);
      const pollResponse = await fetch(actualPollUrl, { headers });
      if (!pollResponse.ok) continue; // 忽略临时错误

      const pollData = await pollResponse.json();
      console.log("轮询响应数据:", pollData); // 方便调试

      let status = getValueByPath(pollData, statusPath);
      console.log(`提取状态 (${statusPath}):`, status);

      if (status === undefined || status === null) {
        status = "未知状态(路径错误?)";
      }

      console.log(`当前状态: ${status}`);

      // 4. 发送进度通知
      try {
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
        throw new Error(`任务失败，状态: ${status}`);
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error("轮询超时");
    }
  }

  // 3. 提取图片
  let finalImageUrl = extractImageUrl(responseData, responsePath);

  if (!finalImageUrl) {
    const err = new Error("API响应中未找到图片字段");
    err.debugData = {
      providerName: config.name,
      request: requestBody,
      response: responseData,
    };
    throw err;
  }

  if (finalImageUrl.startsWith("http")) {
    finalImageUrl = await downloadImageAsBase64(finalImageUrl);
  }

  return {
    requestBody,
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
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片转换失败"));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("下载图片失败，保留原链接:", error);
    return url;
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

  // 如果开启了自动保存图片到本地
  if (settings?.autoSaveImages && item.imageUrl) {
    try {
      console.log("检测到自动保存开启, savePath:", settings.savePath);
      await saveImageToLocal(item.imageUrl, item.prompt, settings.savePath);
    } catch (e) {
      console.error("自动保存图片到本地失败:", e.message, e);
    }
  } else {
    console.log("自动保存未开启或无图片URL", {
      autoSaveImages: settings?.autoSaveImages,
      hasImageUrl: !!item.imageUrl,
    });
  }

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

// 保存图片到本地下载目录
async function saveImageToLocal(imageUrl, prompt, savePath) {
  console.log("开始保存图片到本地...", {
    prompt,
    savePath,
    imageUrlLength: imageUrl?.length,
  });

  // 生成文件名：时间戳 + 随机ID（避免中文和特殊字符导致的问题）
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const randomId = Math.random().toString(36).substring(2, 8);
  const filename = `ai_${timestamp}_${randomId}.png`;

  // 构建完整路径
  // 注意：chrome.downloads.download 的 filename 只能是相对于浏览器下载目录的相对路径
  // 不能使用绝对路径（如 C:\xxx 或 /home/xxx）
  let fullPath = filename;
  if (savePath) {
    let cleanPath = savePath
      .replace(/\\/g, "/") // 反斜杠转正斜杠
      .replace(/^\/+|\/+$/g, "") // 移除首尾斜杠
      .replace(/[<>:"|?*]/g, "") // 移除Windows非法字符
      .replace(/\/+/g, "/"); // 多个斜杠合并

    // 检测并移除绝对路径（如 C:/xxx, D:/xxx, /home/xxx）
    // Windows 盘符模式：X:/
    if (/^[A-Za-z]:/.test(cleanPath)) {
      console.warn(
        "检测到绝对路径，将忽略盘符部分。请在设置中使用相对路径（如 AI-Images）",
      );
      // 移除盘符部分，只保留最后一个目录名作为子目录
      const parts = cleanPath
        .split("/")
        .filter((p) => p && !/^[A-Za-z]:$/.test(p));
      cleanPath = parts.length > 0 ? parts[parts.length - 1] : "";
    }

    if (cleanPath) {
      fullPath = `${cleanPath}/${filename}`;
    }
  }

  console.log("=== 图片保存调试信息 ===");
  console.log("原始 savePath:", savePath);
  console.log("生成的 filename:", filename);
  console.log("最终 fullPath:", fullPath);
  console.log("图片URL类型:", imageUrl?.startsWith("data:") ? "base64" : "url");

  // chrome.downloads.download 可以直接使用 data URL
  // 不需要转换为 blob URL（Service Worker 中不支持 URL.createObjectURL）
  try {
    // 如果支持 shelf 权限，则隐藏下载栏
    if (chrome.downloads.setShelfEnabled) {
      chrome.downloads.setShelfEnabled(false);
    }

    const downloadId = await chrome.downloads.download({
      url: imageUrl,
      filename: fullPath,
      saveAs: false, // 不弹出保存对话框（需要用户在Chrome设置中关闭"下载前询问"）
      conflictAction: "uniquify", // 文件名冲突时自动重命名，避免覆盖提示
    });
    console.log("下载已启动, downloadId:", downloadId);

    // 监听下载完成状态
    return new Promise((resolve, reject) => {
      const listener = (delta) => {
        if (delta.id === downloadId) {
          if (delta.state) {
            if (delta.state.current === "complete") {
              console.log("图片下载完成:", fullPath);
              chrome.downloads.onChanged.removeListener(listener);
              // 恢复下载栏（如果需要）
              if (chrome.downloads.setShelfEnabled) {
                setTimeout(() => chrome.downloads.setShelfEnabled(true), 1000);
              }
              resolve();
            } else if (delta.state.current === "interrupted") {
              console.error("图片下载被中断");
              chrome.downloads.onChanged.removeListener(listener);
              if (chrome.downloads.setShelfEnabled) {
                chrome.downloads.setShelfEnabled(true);
              }
              reject(new Error("下载被中断"));
            }
          }
          if (delta.error) {
            console.error("图片下载错误:", delta.error.current);
            chrome.downloads.onChanged.removeListener(listener);
            if (chrome.downloads.setShelfEnabled) {
              chrome.downloads.setShelfEnabled(true);
            }
            reject(new Error(delta.error.current));
          }
        }
      };
      chrome.downloads.onChanged.addListener(listener);

      // 超时处理
      setTimeout(() => {
        chrome.downloads.onChanged.removeListener(listener);
        if (chrome.downloads.setShelfEnabled) {
          chrome.downloads.setShelfEnabled(true);
        }
        resolve(); // 超时后也认为成功，避免阻塞
      }, 30000);
    });
  } catch (error) {
    console.error("chrome.downloads.download 调用失败:", error);
    if (chrome.downloads.setShelfEnabled) {
      chrome.downloads.setShelfEnabled(true);
    }
    throw error;
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
function showInjectedLoadingStatus(prompt) {
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

  container.innerHTML = `
    <div style="width: 20px; height: 20px; border: 2.5px solid #f3f3f3; border-top: 2.5px solid #667eea; border-radius: 50%; animation: ai-draw-spin 0.8s linear infinite;"></div>
    <span style="font-size: 14px; color: #4a5568; font-weight: 500;">AI 正在创作中...</span>
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
    // 创建简单的图片查看弹窗
    const modal = document.createElement("div");
    modal.id = "ai-draw-simple-modal";
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.8); z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      font-family: -apple-system, sans-serif;
    `;

    // 根据 allowNSFW 设置决定是否显示遮罩
    const blurStyle = allowNSFW ? "" : "filter: blur(40px);";
    const overlayHtml = allowNSFW
      ? ""
      : `
      <div id="ai-draw-nsfw-overlay" style="
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: white; font-size: 14px; cursor: pointer; background: rgba(0,0,0,0.3);
        border-radius: 8px;
      ">
        <span style="font-size: 32px; margin-bottom: 12px;">🔞</span>
        <div style="background: rgba(0,0,0,0.4); padding: 8px 16px; border-radius: 20px;">点击查看</div>
      </div>
    `;

    modal.innerHTML = `
      <div style="background: white; padding: 20px; border-radius: 12px; max-width: 500px; width: 90%; max-height: 90%; overflow: auto; text-align: center;">
        <div id="ai-draw-img-wrapper" style="position: relative; display: inline-block; cursor: pointer;">
          <img id="ai-draw-result-img" src="${imageUrl}" style="max-width: 100%; max-height: 70vh; border-radius: 8px; ${blurStyle}">
          ${overlayHtml}
        </div>
        <p style="margin: 12px 0 16px; color: #666; font-size: 14px;">${prompt}</p>
        <button id="ai-draw-close-btn" style="
          background: #667eea; color: white; border: none; padding: 10px 24px;
          border-radius: 6px; cursor: pointer; font-weight: 500;
        ">关闭</button>
      </div>
    `;
    modal.onclick = (e) => {
      if (e.target === modal) modal.remove();
    };
    document.body.appendChild(modal);

    // 绑定关闭按钮
    document.getElementById("ai-draw-close-btn").onclick = () => modal.remove();

    // 如果有遮罩，绑定点击揭示逻辑
    if (!allowNSFW) {
      const wrapper = document.getElementById("ai-draw-img-wrapper");
      const img = document.getElementById("ai-draw-result-img");
      const overlay = document.getElementById("ai-draw-nsfw-overlay");
      if (wrapper) {
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
    }

    container.remove();
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

      await handleGenerateImage(message.prompt, provider, tabId);
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

      await handleGenerateImage(
        message.prompt,
        provider,
        tabId,
        message.imageUrl,
        "edit",
      );
      sendResponse({ success: true });
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
  // ==================== 图片上传功能 ====================
  if (message.action === "uploadImage") {
    (async () => {
      try {
        const { settings } = await chrome.storage.local.get("settings");
        const result = await uploadImageToService(message.imageData, message.fileName, settings);
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
          handleGenerateImage(prompt, provider, tab.id);
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
    } catch (e) {}
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
    } catch (e) {}
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
    } catch (e) {}
    throw new Error("下载失败: " + errorMsg);
  }

  return await response.text();
}
// ==================== 图片上传服务功能 ====================

/**
 * 上传图片到配置的上传服务
 */
async function uploadImageToService(imageData, fileName, settings) {
  // 获取激活的上传服务
  const uploadServices = settings.imageUploadServices || [];
  const activeService = uploadServices.find(service => service.isActive);
  
  console.log("上传服务检查:", {
    总服务数: uploadServices.length,
    激活服务: activeService ? activeService.name : '无',
    服务列表: uploadServices.map(s => ({ name: s.name, active: s.isActive }))
  });
  
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

  // 将base64转换为blob
  const response = await fetch(imageData);
  const blob = await response.blob();

  // 创建FormData
  const formData = new FormData();
  formData.append(imageUploadFieldName || 'source', blob, fileName || 'image.png');

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

  // 添加自定义参数
  if (imageUploadCustomParams && typeof imageUploadCustomParams === 'object') {
    Object.entries(imageUploadCustomParams).forEach(([key, value]) => {
      if (key && value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value));
        console.log(`添加自定义参数: ${key} = ${value}`);
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
    throw new Error("上传失败: " + errorMsg);
  }

  let imageUrl;
  
  if (format === 'txt') {
    // 纯文本响应，直接作为URL
    imageUrl = await uploadResponse.text();
    imageUrl = imageUrl.trim();
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
    }
  }
  
  if (!imageUrl) {
    throw new Error(`无法从响应中提取图片URL，路径: ${imageUploadResponsePath}`);
  }

  return { success: true, imageUrl: imageUrl };
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
    Object.entries(customParams).forEach(([key, value]) => {
      if (key && value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value));
        console.log(`测试时添加自定义参数: ${key} = ${value}`);
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