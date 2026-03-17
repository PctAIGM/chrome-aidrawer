// AI画图助手 - 图片存储管理模块
// 实现图片池存储、MD5去重、引用计数管理

const STORAGE_KEY = "imagePool";

/**
 * 计算base64数据的哈希值（使用SHA-256）
 * @param {string} base64Data - base64格式的图片数据
 * @returns {Promise<string>} 哈希值（十六进制字符串）
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
 * @returns {Promise<string>} 图片的哈希值
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
 * @param {string} md5 - 图片的哈希值
 * @returns {Promise<string|null>} base64格式的图片数据，不存在返回null
 */
export async function getImage(md5) {
  if (!md5) return null;

  const pool = await getImagePool();
  return pool[md5]?.data || null;
}

/**
 * 增加图片引用计数
 * @param {string} md5 - 图片的哈希值
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
 * @param {string} md5 - 图片的哈希值
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
