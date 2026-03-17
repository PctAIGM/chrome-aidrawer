# 图片池存储设计文档

## 背景

改图操作的原图URL可能因服务商超时清理而失效，导致历史记录的原图无法显示。需要将原图也存储为base64格式，并通过MD5去重和引用计数机制减少存储空间占用。

## 目标

1. 将所有图片（生成图、原图）统一存储为base64格式
2. 使用MD5去重，相同图片只存一份
3. 引用计数管理：存储时+1，删除时-1，为0时清除
4. 支持改图时复用已存储的原图（multipart上传场景）
5. 提供旧数据迁移功能

## 数据结构

### 图片池（新增）

存储键: `imagePool`

```javascript
{
  "abc123def456...": {    // MD5哈希作为key
    data: "data:image/png;base64,iVBORw0KGgo...",
    refCount: 2,          // 引用计数
    size: 153600,         // 字节数，用于统计
    createdAt: "2024-01-15T10:30:00Z"
  }
}
```

### 历史记录（修改）

存储键: `history`

```javascript
[
  {
    id: 1705312200000,
    prompt: "一只可爱的猫咪",
    imageMd5: "abc123def456...",      // 替代原 imageUrl
    originalImageMd5: "789xyz...",    // 替代原 originalImageUrl（仅改图时有）
    operationType: "edit",
    provider: "OpenAI",
    createdAt: "2024-01-15T10:30:00Z"
  }
]
```

### 迁移状态（新增）

存储键: `migrationStatus`

```javascript
{
  status: "none" | "in_progress" | "completed",
  startedAt: "2024-01-15T10:00:00Z" | null,
  completedAt: "2024-01-15T10:05:00Z" | null,
  totalRecords: 50,
  processedRecords: 30,
  error: null | "错误信息"
}
```

## 核心流程

### 1. 保存历史记录

```
用户生成/改图成功
       ↓
生成图已是base64 → 计算MD5 → storeImage() → 返回md5
       ↓
原图是URL → 下载为base64 → 计算MD5 → storeImage() → 返回md5
       ↓
构建historyItem（用md5替代imageUrl）
       ↓
保存到chrome.storage.local
```

### 2. 删除历史记录

```
用户删除记录
       ↓
读取imageMd5、originalImageMd5
       ↓
分别调用 decrementRef(md5)
       ↓
如果refCount变为0 → 从imagePool删除该图片
       ↓
从history数组删除记录
```

### 3. 读取历史记录

```
加载历史记录
       ↓
渲染卡片时，通过md5从imagePool获取base64
       ↓
如果存在 → 显示图片
如果不存在 → 显示"图片已失效"
```

### 4. 改图复用

```
用户选择已存储的图片进行改图
       ↓
检查图片是否在imagePool中
       ↓
在池中 → 直接获取base64数据
       ↓
提供商支持multipart → 直接使用base64
提供商需要URL → 需上传到图床后使用
```

## 迁移锁定机制

### 功能锁定

```
用户触发画图/改图
       ↓
检查 migrationStatus.status
       ↓
├── "completed" 或 "none" → 正常执行
├── "in_progress" → 弹窗提示："正在迁移历史记录，请稍候..."
└── 迁移失败 → 弹窗提示："迁移失败，请重试或清理历史记录"
```

### 迁移流程

```
用户在设置页点击"迁移历史记录"
       ↓
设置 migrationStatus.status = "in_progress"
       ↓
读取现有history数组
       ↓
遍历每条记录：
  - imageUrl是base64 → 计算MD5 → 存入imagePool → 替换为md5
  - originalImageUrl是base64 → 计算MD5 → 存入imagePool → 替换为md5
  - 已是md5格式 → 跳过
       ↓
保存新的history数组
       ↓
设置 migrationStatus.status = "completed"
       ↓
显示迁移结果
```

### 新用户处理

- 新安装用户：`migrationStatus` 默认为 `{ status: "completed" }`
- 直接使用新格式，无需迁移

## 新增模块

### lib/image-store.js

图片存储管理模块，提供以下函数：

```javascript
// 计算图片MD5
export async function calculateImageMd5(base64Data) { }

// 存储图片到池中（返回MD5）
export async function storeImage(base64Data) { }

// 从池中获取图片
export async function getImage(md5) { }

// 增加引用计数
export async function incrementRef(md5) { }

// 减少引用计数（返回是否已删除）
export async function decrementRef(md5) { }

// 获取存储统计
export async function getStorageStats() { }

// 批量迁移图片
export async function migrateImages(imageUrls) { }
```

## 边界情况处理

| 情况 | 处理方式 |
|------|----------|
| imagePool中找不到md5 | 显示"图片已失效"占位图 |
| 迁移中断（关闭页面） | 下次可继续，已处理的会跳过 |
| 存储配额超限 | 提示用户清理旧记录 |
| 重复迁移 | 检测已迁移记录，跳过处理 |

## 设置页面UI

```
┌─────────────────────────────────────┐
│ 📦 历史记录存储管理                  │
├─────────────────────────────────────┤
│ 存储格式: v2 (新格式)                │
│ 图片数量: 45 张                      │
│ 占用空间: 12.5 MB                    │
│ 去重节省: 3.2 MB                     │
│                                     │
│ [清理无效引用]                       │
└─────────────────────────────────────┘

旧格式待迁移：
┌─────────────────────────────────────┐
│ 📦 历史记录存储管理                  │
├─────────────────────────────────────┤
│ 存储格式: v1 (旧格式)                │
│ 图片数量: 50 张                      │
│ 占用空间: 约 15 MB                   │
│                                     │
│ ⚠️ 需要迁移到新格式才能继续使用      │
│                                     │
│ [开始迁移]                          │
└─────────────────────────────────────┘

迁移中：
┌─────────────────────────────────────┐
│ 📦 正在迁移历史记录...               │
├─────────────────────────────────────┤
│ 进度: 30/50 (60%)                    │
│ ████████████░░░░░░░░                 │
│                                     │
│ [取消] (已处理的会保留)              │
└─────────────────────────────────────┘
```

## 实现步骤

1. 创建 `lib/image-store.js` 模块
2. 修改 `background.js` 中的 `saveToHistory` 函数
3. 修改 `background.js` 中的删除历史记录逻辑
4. 修改 `history.js` 中的图片渲染逻辑
5. 添加迁移功能到 `options.js`
6. 添加迁移锁定机制
7. 处理新用户初始化
