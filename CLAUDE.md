# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI画图助手 (AI Drawing Assistant) is a Chrome Extension (Manifest V3) for AI image generation. Pure vanilla JavaScript with no build tools or package managers.

**UI Language**: Chinese (中文) | **Code comments**: Chinese preferred

## Testing

No automated tests. Manual testing via Chrome extension loading:

```bash
# Load extension in Chrome
1. Open chrome://extensions/
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select project folder
```

## Architecture

```
background.js      # Service Worker - API requests, history management, context menus
content.js         # Content Script - Page interaction, status display
lib/
├── common.js      # Shared utilities (ES6 module) - formatErrorMessage, showNotification, escapeHtml
├── image-utils.js # Image processing (ES6 module) - base64 conversion, ZIP export
└── image-store.js # Image pool storage (ES6 module) - SHA-256 dedup, reference counting
```

### Message Flow

```
content.js <---> background.js <---> options.js/popup.js
     |
     v
showMiniStatus() -> Display result in page corner
```

### Key Message Actions

- `getSelection` - Get selected text from page
- `imageGenerated` / `imageError` - Display generation result
- `showEditDialog` - Open image editing dialog

## Code Style

Detailed guidelines in [AGENTS.md](AGENTS.md). Key points:

- **Indentation**: 2 spaces
- **Quotes**: Double quotes for strings
- **Semicolons**: Required
- **Naming**: `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for constants
- **JSDoc**: Required for all exported functions
- **Error handling**: Always use try/catch with meaningful messages

## Chrome Extension Patterns

### Storage

- `chrome.storage.local` - Settings, history, image pool
- `chrome.storage.sync` - Avoid (quota limits)

### Dynamic Module Import (Content Script)

```javascript
const common = await import(chrome.runtime.getURL("lib/common.js"));
```

### Message Passing

```javascript
// Send
chrome.runtime.sendMessage({ action: "getSettings" });

// Receive
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSettings") {
    sendResponse(data);
  }
});
```

## Security

- Always sanitize user input with `escapeHtml()` before DOM insertion
- Never log API keys or sensitive data
- Validate URLs before fetching
