/**
 * 图片分析服务 — 调用 AI API 进行图片反向生成提示词
 * 兼容 OpenAI Vision API 格式
 */

// 默认系统提示词
export const DEFAULT_ANALYZE_SYSTEM_PROMPT = `You are an expert AI art prompt engineer. Analyze the uploaded image and generate high-quality AI painting prompts.

Please output in the following JSON format:
{
  "prompt": "Main prompt (English, comma-separated keywords, 50-100 words)",
  "negativePrompt": "Negative prompt (English, common unwanted elements)",
  "description": "Image description (Chinese, 2-3 sentences)",
  "style": "Art style (e.g., realistic, anime, oil painting, digital art)",
  "subject": "Main subject description",
  "background": "Background description",
  "lighting": "Lighting effects (e.g., soft lighting, dramatic, cinematic)",
  "color": "Color tone (e.g., warm, cool, vibrant, pastel)",
  "composition": "Composition (e.g., portrait, landscape, close-up)"
}

Prompt requirements:
1. Use English keywords separated by commas
2. Sort by importance, most important first
3. Include quality tags (masterpiece, best quality, highly detailed, 8k uhd)
4. Be specific and descriptive
5. Include art medium, style references, and technical details

Negative prompt should include: low quality, blurry, bad anatomy, distorted, watermark, signature, text, cropped, worst quality, jpeg artifacts, ugly, duplicate, morbid, extra fingers, mutated hands, poorly drawn hands, poorly drawn face, mutation, deformed, extra limbs, extra arms, extra legs, malformed limbs, fused fingers, too many fingers, long neck, cross-eyed, mutated hands, polar lowres, bad face.`;

/**
 * 分析图片并生成提示词
 * @param {string} imageData - 图片的 base64 data URL
 * @param {object} provider - 服务商配置 { url, apiKey, model, systemPrompt }
 * @param {function} onProgress - 进度回调 (percent, text)
 * @returns {Promise<object>} 分析结果
 */
export async function analyzeImage(imageData, provider, onProgress = null) {
  const { url, apiKey, model, systemPrompt } = provider;

  if (!url || !apiKey) {
    throw new Error("请配置图片分析服务商的 URL 和 API Key");
  }

  if (!model) {
    throw new Error("请选择分析模型");
  }

  // 优先使用传入的系统提示词，否则使用默认
  const actualSystemPrompt = systemPrompt && systemPrompt.trim() ? systemPrompt : DEFAULT_ANALYZE_SYSTEM_PROMPT;

  // 准备请求体
  const requestBody = {
    model: model,
    messages: [
      {
        role: "system",
        content: actualSystemPrompt
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Please analyze this image and generate prompts for AI art generation."
          },
          {
            type: "image_url",
            image_url: {
              url: imageData,
              detail: "high"
            }
          }
        ]
      }
    ],
    max_tokens: provider.maxTokens !== undefined ? Number(provider.maxTokens) : 2000,
    temperature: provider.temperature !== undefined ? Number(provider.temperature) : 0.7,
    stream: false
  };

  // 附加可选参数
  if (provider.topP !== undefined) requestBody.top_p = Number(provider.topP);
  if (provider.presencePenalty !== undefined) requestBody.presence_penalty = Number(provider.presencePenalty);
  if (provider.frequencyPenalty !== undefined) requestBody.frequency_penalty = Number(provider.frequencyPenalty);

  // 创建安全的请求体副本（去除大段 base64 图片数据）
  const safeRequestBody = JSON.parse(JSON.stringify(requestBody));
  if (safeRequestBody.messages) {
    safeRequestBody.messages.forEach(msg => {
      if (Array.isArray(msg.content)) {
        msg.content.forEach(item => {
          if (item.type === "image_url" && item.image_url?.url) {
            item.image_url.url = "[图片内容已省略以节省内存]";
          }
        });
      }
    });
  }

  if (onProgress) onProgress(0.2, "正在发送请求...");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(requestBody)
    });

    if (onProgress) onProgress(0.6, "正在接收响应...");

    // 获取响应文本
    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    if (!response.ok) {
      let errorMsg = `API 错误 (${response.status})`;
      if (responseData.error?.message) {
        errorMsg = responseData.error.message;
      } else if (responseData.message) {
        errorMsg = responseData.message;
      } else if (responseText) {
        errorMsg = responseText;
      }

      // 创建带有调试数据的错误
      const error = new Error(errorMsg);
      error.debugData = {
        url: url,
        method: "POST",
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer ***"
        },
        body: safeRequestBody,
        response: responseData
      };
      throw error;
    }

    if (onProgress) onProgress(0.8, "正在解析结果...");

    // 提取分析结果
    let content = responseData.choices?.[0]?.message?.content;

    // 尝试解析可能被强制为流式 (SSE) 格式的响应
    if (!content && responseData.raw && responseData.raw.includes("data: ")) {
      content = "";
      const lines = responseData.raw.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const dataStr = line.substring(6).trim();
          if (dataStr === "[DONE]") continue;
          try {
            const chunk = JSON.parse(dataStr);
            const delta = chunk.choices?.[0]?.delta;
            if (delta && delta.content) {
              content += delta.content;
            }
          } catch (e) {
            // 忽略解析失败的数据块
          }
        }
      }
      if (!content) content = undefined;
    }

    if (!content) {
      const error = new Error("API 响应格式错误，无法提取内容");
      error.debugData = {
        url: url,
        method: "POST",
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer ***"
        },
        body: safeRequestBody,
        response: responseData
      };
      throw error;
    }

    // 清理一些模型可能输出的特殊控制符
    // 移除 <think ...>...</think ...> 块
    content = content.replace(/<think[^>]*>[\s\S]*?<\/think>/g, "");
    // 移除孤立的特殊标签，如 <begin_of_box>, <|im_start|> 等
    content = content.replace(/<\/?(?:begin_of_box|end_of_box|\|im_start\||\|im_end\|)>/g, "").trim();

    // 解析 JSON 结果
    const result = parseAnalysisResult(content);

    // 附加上调试数据
    result._debugData = {
      url: url,
      method: "POST",
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer ***"
      },
      body: safeRequestBody,
      response: responseData,
      rawContent: content
    };

    if (onProgress) onProgress(1.0, "完成");

    return result;

  } catch (error) {
    if (error.debugData) {
      throw error;
    }
    const wrappedError = new Error(error.message || "分析请求失败");
    wrappedError.debugData = {
      url: url,
      method: "POST",
      status: "Network Error",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer ***"
      },
      body: safeRequestBody,
      response: error.message
    };
    throw wrappedError;
  }
}

/**
 * 从 API 响应内容中解析分析结果
 * @param {string} content - API 返回的文本内容
 * @returns {object} 解析后的结果
 */
function parseAnalysisResult(content) {
  try {
    // 尝试直接解析 JSON
    // 先查找 JSON 代码块
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    // 清理可能的 Markdown 格式
    const cleanedJson = jsonStr.trim();

    const parsed = JSON.parse(cleanedJson);

    return {
      prompt: parsed.prompt || parsed.positivePrompt || "",
      negativePrompt: parsed.negativePrompt || parsed.negative_prompt || "",
      description: parsed.description || parsed.desc || "",
      style: parsed.style || "",
      subject: parsed.subject || "",
      background: parsed.background || "",
      lighting: parsed.lighting || "",
      color: parsed.color || "",
      composition: parsed.composition || ""
    };
  } catch (error) {
    // JSON 解析失败，降级到文本提取（这是正常流程，不打印警告）
    return extractFromText(content);
  }
}

/**
 * 从非 JSON 格式文本中提取信息
 * @param {string} text
 * @returns {object}
 */
function extractFromText(text) {
  const result = {
    prompt: "",
    negativePrompt: "",
    description: "",
    style: "",
    subject: "",
    background: "",
    lighting: "",
    color: "",
    composition: ""
  };

  // 尝试提取各个字段
  const patterns = {
    prompt: /(?:prompt|正向提示词|提示词)[：:]\s*([\s\S]*?)(?=\n\n|$|(?:negative|反向|description|描述|style|风格))/i,
    negativePrompt: /(?:negative\s*prompt|反向提示词|负面提示词)[：:]\s*([\s\S]*?)(?=\n\n|$|(?:description|描述|style|风格))/i,
    description: /(?:description|描述)[：:]\s*([\s\S]*?)(?=\n\n|$|(?:style|风格|subject|主体))/i,
    style: /(?:style|风格|art\s*style)[：:]\s*([\s\S]*?)(?=\n\n|$|(?:subject|主体|background|背景))/i,
    subject: /(?:subject|主体|main\s*subject)[：:]\s*([\s\S]*?)(?=\n\n|$|(?:background|背景|lighting|光影))/i,
    background: /(?:background|背景)[：:]\s*([\s\S]*?)(?=\n\n|$|(?:lighting|光影|color|色调))/i,
    lighting: /(?:lighting|光影|光线|light)[：:]\s*([\s\S]*?)(?=\n\n|$|(?:color|色调|composition|构图))/i,
    color: /(?:color|色调|颜色|color\s*tone)[：:]\s*([\s\S]*?)(?=\n\n|$|(?:composition|构图))/i,
    composition: /(?:composition|构图)[：:]\s*([\s\S]*?)(?=\n\n|$)/i
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match) {
      result[key] = match[1].trim();
    }
  }

  // 如果没有提取到 prompt，使用整个文本作为 prompt
  if (!result.prompt) {
    result.prompt = text.trim();
  }

  return result;
}

/**
 * 获取模型列表（兼容 OpenAI /models 接口）
 * @param {string} url - 基础 URL
 * @param {string} apiKey - API 密钥
 * @returns {Promise<Array>} 模型列表
 */
export async function fetchModels(url, apiKey) {
  if (!url || !apiKey) {
    throw new Error("请提供 URL 和 API Key");
  }

  try {
    // 构建 /models 端点 URL
    const baseUrl = url.replace(/\/v1\/chat\/completions$/, "").replace(/\/$/, "");
    const modelsUrl = `${baseUrl}/v1/models`;

    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey.trim()}`
      }
    });

    if (!response.ok) {
      throw new Error(`获取模型列表失败: ${response.status}`);
    }

    const data = await response.json();
    const models = data.data || [];

    // 优先显示已知支持视觉的模型
    const visionKeywords = ["vision", "gpt-4", "claude", "gemini", "multimodal", "llava", "bakllava"];
    const sortedModels = models.sort((a, b) => {
      const aHasVision = visionKeywords.some(kw => a.id.toLowerCase().includes(kw));
      const bHasVision = visionKeywords.some(kw => b.id.toLowerCase().includes(kw));

      if (aHasVision && !bHasVision) return -1;
      if (!aHasVision && bHasVision) return 1;
      return a.id.localeCompare(b.id);
    });

    return sortedModels.map(m => ({
      id: m.id,
      name: m.id,
      supportsVision: visionKeywords.some(kw => m.id.toLowerCase().includes(kw))
    }));

  } catch (error) {
    throw error;
  }
}

/**
 * 验证分析服务商配置
 * @param {object} provider - 服务商配置
 * @returns {object} { valid: boolean, error?: string }
 */
export function validateAnalyzeProvider(provider) {
  if (!provider) {
    return { valid: false, error: "配置不能为空" };
  }

  if (!provider.url || !provider.url.trim()) {
    return { valid: false, error: "API URL 不能为空" };
  }

  try {
    new URL(provider.url);
  } catch {
    return { valid: false, error: "API URL 格式不正确" };
  }

  if (!provider.apiKey || !provider.apiKey.trim()) {
    return { valid: false, error: "API Key 不能为空" };
  }

  if (!provider.model || !provider.model.trim()) {
    return { valid: false, error: "请选择或输入模型名称" };
  }

  return { valid: true };
}
