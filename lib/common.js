// AI画图助手 - 公共方法库
// 此文件包含在多个页面中重复使用的工具函数

/**
 * 格式化错误信息，处理对象类型的错误
 * @param {*} error - 错误对象、字符串或其他类型
 * @returns {string} 格式化后的错误信息
 */
function formatErrorMessage(error) {
  if (!error) return '未知错误';
  
  // 如果是字符串，直接返回
  if (typeof error === 'string') return error;
  
  // 如果是Error对象，返回message
  if (error instanceof Error) return error.message;
  
  // 如果是对象，尝试转换为JSON
  if (typeof error === 'object') {
    try {
      // 如果对象有message属性，优先使用
      if (error.message) return error.message;
      
      // 如果对象有error属性，递归处理
      if (error.error) return formatErrorMessage(error.error);
      
      // 尝试JSON序列化
      const jsonStr = JSON.stringify(error, null, 2);
      return jsonStr !== '{}' ? jsonStr : '未知对象错误';
    } catch (e) {
      return `对象错误 (无法序列化): ${error.toString()}`;
    }
  }
  
  // 其他类型，转换为字符串
  return String(error);
}

/**
 * 将文件转换为base64格式
 * @param {File} file - 要转换的文件对象
 * @returns {Promise<string>} base64格式的数据URL
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 将blob转换为base64格式
 * @param {Blob} blob - 要转换的blob对象
 * @returns {Promise<string>} base64格式的数据URL
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 显示通知消息（仅用于前端页面，不包括background）
 * @param {string} message - 通知消息内容
 * @param {string} type - 通知类型: "info", "success", "error"
 */
function showNotification(message, type = "info") {
  const existing = document.querySelector(".notification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.remove(), 3000);
}

/**
 * HTML转义，防止XSS攻击
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的HTML安全文本
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 截断文本到指定长度
 * @param {string} text - 要截断的文本
 * @param {number} maxLength - 最大长度
 * @returns {string} 截断后的文本（超出部分用...表示）
 */
function truncateText(text, maxLength) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

/**
 * 格式化日期为友好的相对时间
 * @param {string} dateString - ISO格式的日期字符串
 * @returns {string} 格式化后的日期字符串
 */
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
