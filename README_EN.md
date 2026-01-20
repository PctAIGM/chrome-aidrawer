# AI Drawing Assistant - Chrome Extension

A powerful Chrome browser extension that allows you to generate AI images by right-clicking on selected text, with image editing capabilities.

## Features

- **Right-click Menu Drawing** - Select text on any webpage, right-click and choose "AI Drawing Assistant" to generate images
- **Image Editing** - Right-click on images or selected text to edit images with various AI services
- **Image Upload Service** - Configure image upload relay services to solve server-side image URL download issues
- **Keyboard Shortcuts** - Use Ctrl+Shift+D for quick drawing
- **Multiple API Support** - Supports OpenAI DALL-E, Stability AI, Replicate, and other APIs
- **History Records** - Automatically saves the last 100 drawing records
- **Multiple Save Options** - Copy to clipboard or download images
- **Flexible Configuration** - Customize API keys, model parameters, and more

## Installation

1. Open Chrome browser and navigate to chrome://extensions/
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked"
4. Select the chrome-drawer plugin folder
5. After successful installation, the plugin icon will appear in the toolbar

## Usage Guide

### Basic Usage

1. Select text on a webpage that you want to generate an image from
2. Right-click on the selected text and choose "AI Drawing Assistant" → "Generate image from selected content"
3. Wait for AI to generate the image
4. Once completed, you can copy or download the image

### Image Editing Feature

1. **Right-click Image Editing**:
   - Right-click on an image on a webpage
   - Select "✏️ Edit with XXX"
   - Enter editing prompt (e.g., "change background to blue", "add a cat", etc.)
   - Click "Start Editing"

2. **Upload Image Editing**:
   - Right-click on selected text and choose an editing option
   - In the popup dialog, select a local image file
   - Click "Upload Image" and wait for upload completion
   - Enter editing prompt and start editing

### Configure Image Upload Service

If you encounter "server cannot download image" issues during editing, configure an image upload service:

1. Find the "Image Upload Service" section in settings
2. Configure upload endpoint (e.g., `https://api.example.com/upload`)
3. Set API key (optional)
4. Configure response path (e.g., `data.url`)
5. Set file field name (usually `file`)
6. Click "Test Upload" to verify configuration

### Keyboard Shortcuts

- Windows/Linux: Ctrl+Shift+D
- Mac: Command+Shift+D

### API Configuration

1. Click the plugin icon and select "API Settings"
2. Add AI service providers (supports both drawing and editing types)
3. Enter your API key and endpoint
4. Configure custom parameters and request headers
5. Click "Save Settings"
6. Click "Test Connection" to verify configuration

## File Structure

```
chrome-drawer/
├── manifest.json          # Plugin configuration
├── background.js         # Background script
├── content.js            # Content script
├── options.html          # API configuration page
├── options.js            # Configuration logic
├── edit-dialog.html      # Image editing dialog page
├── edit-dialog.js        # Image editing dialog logic
├── history.html          # History page
├── history.js            # History logic
├── popup.html            # Popup page
├── popup.js              # Popup logic
├── icons/                # Plugin icons
├── styles/               # Style files
└── lib/                  # Third-party libraries
```

## Supported APIs

### Drawing Services
- OpenAI DALL-E (DALL-E 3 recommended)
- Stability AI (Stable Diffusion)
- Replicate (Open source models)
- Other compatible API services

### Image Editing Services
- OpenAI DALL-E Edit
- Stability AI Image-to-Image
- Custom editing APIs
- Supports asynchronous polling mode

### Image Upload Services
- Generic file upload APIs
- Image hosting services
- Cloud storage services
- Self-hosted upload services

## Important Notes

1. Valid API keys are required
2. Using AI services may incur costs
3. Some APIs may require proxy access
4. Recommend testing API connections first
5. Image editing features require APIs that support image editing
6. Image upload services need to support Cross-Origin Resource Sharing (CORS)

## Changelog

### v2.0.0
- ✨ Added image editing feature with support for editing existing images
- 🔧 Added image upload service configuration to solve server-side image download issues
- 🎨 Optimized user interface with file selection and upload support
- 🐛 Fixed multiple known issues

### v1.0.0
- 🎉 Basic drawing functionality
- ⚙️ Multiple API support
- 📚 History records feature

Made with love for AI art enthusiasts

---

**中文版本请查看 [README.md](README.md)**