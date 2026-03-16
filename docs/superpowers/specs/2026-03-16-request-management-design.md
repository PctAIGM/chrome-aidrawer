# 请求管理功能设计文档

## 概述

为 AI 画图助手增加请求管理功能，记录所有 API 请求的完整生命周期，包括请求参数、响应内容、调试信息和耗时统计。

## 需求确认

- **页面位置**: 独立新页面 `requests.html`
- **记录内容**: 请求参数、响应内容、调试信息、耗时统计
- **存储策略**: 独立存储（与 history 分开）
- **保留策略**: 按时间限制，保留 7 天

## 数据结构

### 请求记录 (RequestRecord)

```typescript
interface RequestRecord {
  id: string;                    // 唯一标识：req_${timestamp}
  status: "pending" | "success" | "failed";
  
  // 请求参数
  request: {
    prompt: string;
    negativePrompt?: string;
    operationType: "generate" | "edit";
    providerId: string;
    providerName: string;
    imageUrl?: string;           // 改图时的原图URL
    customParams?: Record<string, any>;
  };
  
  // 响应内容
  response: {
    imageUrl?: string;
    responseData?: any;
    error?: string;
  };
  
  // 调试信息
  debug: {
    requestBody: any;
    requestHeaders: Record<string, string>;
    responseData: any;
    endpoint: string;
  };
  
  // 时间统计
  timing: {
    startedAt: string;           // ISO 8601
    completedAt?: string;
    duration?: number;           // 毫秒
  };
}
```

### 存储结构

```javascript
// chrome.storage.local
{
  requests: RequestRecord[],     // 请求记录数组
  settings: {
    // 新增配置项
    requestRetentionDays: 7      // 请求保留天数
  }
}
```

## 文件结构

```
新增文件：
├── requests.html              # 请求管理页面
├── requests.js                # 页面逻辑
├── styles/requests.css        # 页面样式

修改文件：
├── background.js              # 增加请求记录逻辑
├── manifest.json              # 注册新页面
├── lib/common.js              # 增加请求记录工具函数
```

## 功能设计

### 页面布局

```
┌─────────────────────────────────────────────────────┐
│ AI画图助手 - 请求管理                    [清理] [刷新] │
├─────────────────────────────────────────────────────┤
│ [全部] [进行中] [成功] [失败]  [搜索框...]           │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🟢 成功 | 生成 | OpenAI | 5.2s | 2024-01-01    │ │
│ │ 提示词: 一只可爱的猫...                         │ │
│ │ [查看详情] [重试]                               │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 🔴 失败 | 改图 | Stability | 2.1s | 2024-01-01 │ │
│ │ 提示词: 修改背景...                             │ │
│ │ 错误: HTTP 500 - Internal Server Error          │ │
│ │ [查看详情] [重试]                               │ │
│ └─────────────────────────────────────────────────┘ │
│ ...                                                 │
└─────────────────────────────────────────────────────┘
```

### 状态筛选

| 筛选项 | 说明 |
|--------|------|
| 全部 | 显示所有请求记录 |
| 进行中 | status = "pending" |
| 成功 | status = "success" |
| 失败 | status = "failed" |

### 详情查看

点击"查看详情"展开完整信息：

```
┌─────────────────────────────────────────────────────┐
│ 📋 请求参数                                         │
│   提示词: 一只可爱的猫                              │
│   服务商: OpenAI                                   │
│   操作类型: 生成                                    │
│                                                     │
│ ⏱️ 耗时统计                                         │
│   开始时间: 2024-01-01 12:00:00                    │
│   完成时间: 2024-01-01 12:00:05                    │
│   总耗时: 5.2 秒                                    │
│                                                     │
│ 📤 请求详情                                         │
│   端点: https://api.openai.com/v1/images/generations│
│   请求体: { "prompt": "...", "n": 1 }              │
│                                                     │
│ 📥 响应详情                                         │
│   状态: 成功                                        │
│   响应数据: { "data": [...] }                      │
│                                                     │
│ [复制调试信息] [导出JSON]                           │
└─────────────────────────────────────────────────────┘
```

### 重试功能

- 失败的请求显示"重试"按钮
- 点击后跳转到 popup 页面并预填充参数（prompt、服务商、操作类型等）
- 用户可以在 popup 中修改参数后再发起请求
- 不直接在后台重新发起请求，以避免重复请求浪费配额

### 搜索功能

- 搜索范围：提示词（prompt）和服务商名称（providerName）
- 搜索方式：模糊匹配，不区分大小写
- 实时搜索：输入时自动过滤，无需点击搜索按钮

### 异常处理

**存储失败：**
- 请求记录保存失败时，在控制台记录错误，不阻塞主流程
- 图片生成成功是最高优先级，请求记录失败不应影响用户获取结果

**清理失败：**
- 自动清理失败时，下次请求时重试
- 不影响正常的请求记录功能

### 孤立请求清理

- 扩展启动时（`chrome.runtime.onInstalled`）检查所有 pending 状态的请求
- 超过 1 小时仍处于 pending 状态的请求自动标记为 failed
- 错误信息设置为 "请求中断（可能是浏览器关闭或扩展更新）"

### 存储限制

- 默认不限制记录数量，仅按时间（7天）清理
- 如果存储配额超出，自动清理最早的记录
- 清理时保留最近的 50 条记录作为最低保障

### 入口

1. **右键菜单**: 增加"📋 请求管理"选项
2. **历史记录页面**: 添加链接跳转

## 实现要点

### 1. 请求记录时机

在 `background.js` 的 `handleGenerateImage` 函数中：

```javascript
async function handleGenerateImage(prompt, negativePrompt, provider, tabId, imageUrl, operationType) {
  // 1. 创建请求记录
  const requestRecord = createRequestRecord({
    prompt, negativePrompt, provider, imageUrl, operationType
  });
  
  // 2. 保存初始状态（pending）
  await saveRequestRecord(requestRecord);
  
  try {
    // 3. 执行请求
    const result = await generateWithCustomAPI(prompt, config);
    
    // 4. 更新为成功状态
    await updateRequestRecord(requestRecord.id, {
      status: "success",
      response: { imageUrl: result.imageUrl, responseData: result.responseData },
      debug: { ... },
      timing: { completedAt: new Date().toISOString(), duration: ... }
    });
    
  } catch (error) {
    // 5. 更新为失败状态
    await updateRequestRecord(requestRecord.id, {
      status: "failed",
      response: { error: error.message },
      debug: error.debugData,
      timing: { completedAt: new Date().toISOString(), duration: ... }
    });
  }
}
```

### 2. 自动清理

```javascript
async function cleanupOldRequests() {
  const { settings } = await chrome.storage.local.get("settings");
  const retentionDays = settings?.requestRetentionDays || 7;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  const { requests } = await chrome.storage.local.get("requests");
  const filtered = (requests || []).filter(r => 
    new Date(r.timing.startedAt) >= cutoffDate
  );
  
  await chrome.storage.local.set({ requests: filtered });
}
```

### 3. API Key 脱敏

```javascript
function sanitizeHeaders(headers) {
  const sanitized = { ...headers };
  if (sanitized["Authorization"]) {
    // 保留前缀，隐藏实际 key
    sanitized["Authorization"] = sanitized["Authorization"].substring(0, 20) + "...";
  }
  return sanitized;
}
```

### 4. 前端实时更新

使用 `chrome.storage.onChanged` 监听请求状态变化：

```javascript
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.requests) {
    renderRequestList();
  }
});
```

## 样式设计

复用现有设计系统变量（`styles/common.css`）：

- 使用 `--accent-color` 作为主色调
- 成功状态：绿色 (#48bb78)
- 失败状态：红色 (#f56565)
- 进行中：蓝色 (#667eea) + 动画

## 兼容性

- 保持现有 history 功能不变
- 请求记录存储独立，不影响历史记录配额
- 右键菜单增加新选项，不修改现有选项

## 测试要点

1. 验证请求记录创建时机正确
2. 验证状态更新（pending → success/failed）
3. 验证自动清理逻辑
4. 验证 API Key 脱敏
5. 验证前端实时更新
6. 验证重试功能
7. 验证与现有 history 功能的独立性
