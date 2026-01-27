# AI画图助手 (AI Drawing Assistant) - Agent Guidelines

## Project Overview

Chrome Extension (Manifest V3) for AI image generation. Pure vanilla JavaScript with no build tools or package managers.

**Language**: Chinese UI, English code comments allowed but Chinese preferred for consistency

## Build/Test Commands

**No build system** - This is a vanilla JavaScript Chrome extension.

### Testing
```bash
# Load extension in Chrome
1. Open chrome://extensions/
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select project folder

# No unit tests configured
# No linting configured
# No automated testing available
```

### Manual Testing Checklist
- Test on different websites (cross-origin)
- Verify context menu appears on text selection
- Test image edit workflow (if applicable)
- Check popup functionality
- Verify history persistence

## Code Style Guidelines

### JavaScript

**Indentation**: 2 spaces

**Quotes**: Double quotes for strings
```javascript
// Good
const message = "Hello world";

// Bad
const message = 'Hello world';
```

**Semicolons**: Required
```javascript
const x = 1;
const y = 2;
```

**Naming Conventions**:
- Variables/functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- DOM elements: descriptive names with element type suffix when helpful
```javascript
const MAX_HISTORY_ITEMS = 100;
const providers = [];
const generateBtn = document.getElementById("generateBtn");
```

**Function Documentation**: Use JSDoc for all exported functions
```javascript
/**
 * Format error message for display
 * @param {*} error - Error object or string
 * @returns {string} Formatted error message
 */
export function formatErrorMessage(error) {
  // implementation
}
```

**Error Handling**: Always use try/catch with meaningful messages
```javascript
try {
  await someAsyncOperation();
} catch (error) {
  console.error("Operation failed:", error);
  showNotification(formatErrorMessage(error), "error");
}
```

**Async Patterns**: Prefer async/await over raw promises
```javascript
// Good
async function loadData() {
  const data = await chrome.storage.local.get("key");
  return data;
}

// Avoid
function loadData() {
  return chrome.storage.local.get("key").then(data => data);
}
```

### Module System

**ES6 Modules**: Use import/export in lib/ folder files
```javascript
// lib/common.js
export function helper() { }

// consumer
import { helper } from "./lib/common.js";
```

**Content Script Dynamic Import** (for shared modules):
```javascript
const common = await import(chrome.runtime.getURL("lib/common.js"));
```

**No npm packages** - Third-party libs go in lib/ folder (e.g., jszip.min.js)

### CSS

**File Organization**:
- `styles/common.css` - Shared variables, base styles, components
- `styles/[page].css` - Page-specific overrides

**CSS Variables**: Use defined design system
```css
/* From common.css */
background: var(--accent-color);
border-radius: var(--radius-md);
box-shadow: var(--shadow-sm);
```

**Naming**: Use kebab-case for classes
```css
.image-preview { }
.provider-select { }
```

### HTML

**Structure**: Standard HTML5 with Chinese lang attribute
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>AI画图助手</title>
  <link rel="stylesheet" href="styles/common.css">
  <link rel="stylesheet" href="styles/popup.css">
</head>
```

**File Naming**: kebab-case for multi-word files
- `edit-dialog.html`
- `history.js`

## Chrome Extension Specifics

### Manifest V3
- Service worker in `background.js` (not persistent background page)
- Content scripts in `content.js`
- `manifest.json` defines permissions, host permissions, and resources

### Storage
- Use `chrome.storage.local` for settings and history
- Use `chrome.storage.sync` sparingly (quota limits)

### Message Passing
```javascript
// Send
chrome.runtime.sendMessage({ action: "getSettings" });

// Receive (background.js)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSettings") {
    // handle
    sendResponse(data);
  }
});
```

## File Organization

```
├── manifest.json          # Extension config
├── background.js          # Service worker
├── content.js             # Content script
├── popup.html/js          # Extension popup
├── options.html/js        # Settings page
├── history.html/js        # History page
├── edit-dialog.html/js    # Image editing dialog
├── lib/
│   ├── common.js          # Shared utilities (ES6 module)
│   ├── image-utils.js     # Image processing (ES6 module)
│   └── jszip.min.js       # Third-party library
├── styles/
│   ├── common.css         # Shared styles
│   ├── popup.css
│   ├── options.css
│   ├── history.css
│   └── edit-dialog.css
└── icons/                 # Extension icons
```

## Security Considerations

- Always sanitize user input before DOM insertion (use `escapeHtml` from common.js)
- Never log API keys or sensitive data
- Use `chrome.storage.local` for API keys (not sync)
- Validate URLs before fetching
- Handle CORS issues gracefully

## Comments

- Chinese preferred for consistency with existing codebase
- JSDoc for all exported functions
- Inline comments for complex logic

```javascript
// 格式化错误信息
function formatError(error) {
  // 处理各种错误类型
}
```
