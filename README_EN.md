# AI Drawer - Chrome Extension

A powerful Chrome browser extension that generates AI images from selected text via right-click menu, supporting image editing and multiple save options.

## Features

### 🎨 Image Generation
- **Right-click to draw** - Select text on a webpage, right-click, and choose "AI Drawer" to generate images
- **Keyboard shortcut** - Use `Ctrl+Shift+D` (Mac: `Command+Shift+D`) for quick drawing
- **Multiple providers** - Support for OpenAI DALL-E, Stability AI, Replicate, and more

### ✏️ Image Editing
- **Edit from image** - Right-click any image on a webpage to edit it
- **Upload local image** - Upload local images for editing when no image is available
- **Flexible prompts** - Enter editing instructions like "change background to blue" or "add a cat"

### 💾 Save & Manage
- **Copy to clipboard** - One-click copy of generated images
- **Download locally** - Save images to download directory
- **Auto-save** - Configure auto-save to a specific folder
- **Share to album** - Share images to image hosting services
- **History** - Automatically save up to 100 drawing records with search and batch export

### ⚙️ Advanced Configuration
- **Multi-API** - Configure multiple image generation/editing providers
- **Custom API** - Connect to any compatible AI image API
- **Async polling** - Support for async task APIs (like Replicate)
- **Multipart upload** - Support multipart/form-data for image editing
- **Templates** - Built-in API templates and custom template management

### 🔄 Data Sync
- **WebDAV sync** - Sync configuration to WebDAV server
- **Encrypted export** - AES-GCM encrypted export to protect API keys
- **Import config** - Support importing encrypted or plain-text configs

## Installation

1. Open Chrome browser and visit `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked extension"
4. Select the `chrome-aidrawer` folder
5. The extension icon will appear in the toolbar

## Usage

### Basic Drawing

1. Select the text you want to generate an image from
2. Right-click the selected text, choose "AI Drawer" → "Generate image from selection"
3. Wait for AI to generate the image
4. Preview, copy, or download the generated image

### Image Editing

**Method 1: Edit from webpage image**
1. Right-click an image on a webpage
2. Choose "✏️ Edit with [provider name]"
3. Enter your editing prompt
4. Click "Start editing"

**Method 2: Upload local image**
1. Right-click selected text or page空白处
2. Choose "✏️ Edit with [provider name]"
3. Click "Choose image" in the dialog to upload
4. Enter your editing prompt
5. Click "Start editing"

### Configure Image Upload Service

Configure image upload service for:
- Sharing images to image hosting
- Scenarios where server cannot download image URLs

Configuration steps:
1. Open extension options page
2. Find "Image Upload Service" section
3. Click "Add Upload Service"
4. Configure endpoint, authentication, response path, etc.
5. Click "Test Connection" to verify
6. Save and start using

### Configure API

1. Click extension icon and choose "API Settings"
2. Add AI provider (support generation and editing types)
3. Enter API key and endpoint URL
4. Configure request parameters and headers (optional)
5. Click "Save Settings"
6. Click "Test Connection" to verify

### Keyboard Shortcuts

- **Windows/Linux**: `Ctrl+Shift+D`
- **Mac**: `Command+Shift+D`

Shortcut can be modified in Chrome extension shortcuts page.

## File Structure

```
chrome-aidrawer/
├── manifest.json          # Extension manifest
├── background.js          # Background script (API requests, history management)
├── content.js             # Content script (page interaction, result display)
├── options.html           # API settings page
├── options.js             # Settings logic (providers, templates, WebDAV)
├── popup.html             # Popup page
├── popup.js               # Popup logic
├── edit-dialog.html       # Edit dialog page
├── edit-dialog.js         # Edit dialog logic
├── history.html           # History page
├── history.js             # History logic
├── icons/                 # Extension icons
├── styles/                # Style files
│   ├── history.css
│   ├── options.css
│   └── popup.css
└── lib/                   # Third-party libraries
    └── jszip.min.js
```

## Supported APIs

### Generation Services
- OpenAI DALL-E 2/3
- Stability AI (Stable Diffusion)
- Replicate (Open models like SDXL, FLUX)
- NewAPI and similar platforms
- Any compatible REST API

### Editing Services
- OpenAI DALL-E Edit
- Stability AI Image-to-Image
- Replicate Edit API
- Custom editing APIs
- Async polling mode support

### Image Upload Services
- Generic file upload APIs
- Image hosting services (SM.MS, ImgBB, etc.)
- Cloud storage services
- Custom upload services

## Notes

1. **API Key Security**
   - Regularly export encrypted backup configs
   - Don't share API keys with others

2. **Usage Costs**
   - AI services may incur costs, check provider billing
   - Some APIs may require proxy access

3. **Feature Limits**
   - Editing requires APIs that support image editing
   - Upload services need CORS support
   - History storage has Chrome extension quota limits

4. **Debugging**
   - Click "Debug" on failure to view request/response details
   - Test connection before regular use

## Changelog

### v2.0.0
- ✨ Added image editing feature
- ?? Added image upload service configuration
- ✨ Added WebDAV sync feature
- ✨ Added encrypted config export
- ✨ Added API template management
- 🎨 Improved UI with file selection and upload support
- 🐛 Fixed various known issues

### v1.0.0
- 🎉 Basic image generation
- ⚙️ Multi-API support
- 📚 History feature