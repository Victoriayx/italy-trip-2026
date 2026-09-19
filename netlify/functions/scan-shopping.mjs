const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One concise sentence describing what was recognized." },
    items: {
      type: "array",
      description: "Shopping or proxy-buy items extracted from the screenshot.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "The key product name in Chinese or its original language." },
          price: { type: "number", description: "The final line price for this item. Use 0 if no price is visible." },
          note: { type: "string", description: "Optional short note such as quantity, size, color, or source." }
        },
        required: ["name", "price", "note"],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "items"],
  additionalProperties: false
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default async function handler(request) {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const apiKey = process.env.OPENAI_API_KEY || process.env.NETLIFY_AI_GATEWAY_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.NETLIFY_AI_GATEWAY_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  if (!apiKey) return jsonResponse({ error: "Missing OpenAI-compatible AI credential" }, 500);

  let payload;
  try { payload = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
  const imageBase64 = String(payload?.imageBase64 || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").trim();
  const mimeType = /^image\/(?:jpeg|png|webp|gif)$/i.test(String(payload?.mimeType || "")) ? String(payload.mimeType) : "image/jpeg";
  if (!imageBase64) return jsonResponse({ error: "Missing image" }, 400);
  if (imageBase64.length > 8000000) return jsonResponse({ error: "Image is too large" }, 413);

  const input = [
    {
      role: "system",
      content: [{
        type: "input_text",
        text: [
          "You extract shopping items from screenshots for a two-person trip.",
          "Read the image carefully and return only clear purchasable products.",
          "Ignore subtotals, tax, shipping, discounts, payment methods, order numbers, and the grand total.",
          "If an item has quantity greater than one, return the line total shown for that product, not the unit price.",
          "Keep product names concise and preserve size, color, model, or quantity when it is important.",
          "If a price is not visible, set price to 0 and explain briefly in note.",
          "Return every distinct item visible in the screenshot. Do not invent products."
        ].join(" ")
      }]
    },
    {
      role: "user",
      content: [
        { type: "input_text", text: "请识别这张购物截图中的物品关键名称和价格。价格只返回数字。" },
        { type: "input_image", image_url: `data:${mimeType};base64,${imageBase64}`, detail: "high" }
      ]
    }
  ];

  try {
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-6-astra",
        input,
        text: {
          format: {
            type: "json_schema",
            name: "shopping_scan",
            strict: true,
            schema: RESPONSE_SCHEMA
          }
        }
      })
    });
    const data = await response.json();
    if (!response.ok) return jsonResponse({ error: data?.error?.message || "OpenAI request failed" }, response.status);
    const outputText = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
    if (!outputText) return jsonResponse({ error: "No structured output returned" }, 502);
    const result = JSON.parse(outputText);
    result.items = Array.isArray(result.items) ? result.items.map((item) => ({
      name: String(item?.name || "").trim(),
      price: Number.isFinite(Number(item?.price)) ? Number(item.price) : 0,
      note: String(item?.note || "").trim()
    })).filter((item) => item.name) : [];
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected shopping scan error" }, 500);
  }
}
