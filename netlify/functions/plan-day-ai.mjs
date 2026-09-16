const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One concise sentence summarizing the revised plan." },
    events: {
      type: "array",
      description: "The complete revised schedule for the day, including confirmed items that should be preserved.",
      items: {
        type: "object",
        properties: {
          time: { type: "string", description: "Time label such as 上午, 14:00, or 傍晚." },
          type: { type: "string", enum: ["flight", "train", "boat", "hotel", "place", "note"] },
          status: { type: "string", enum: ["confirmed", "booked", "suggested", "todo"] },
          title: { type: "string" },
          detail: { type: "string" },
          maps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                query: { type: "string" }
              },
              required: ["label", "query"],
              additionalProperties: false
            }
          }
        },
        required: ["time", "type", "status", "title", "detail", "maps"],
        additionalProperties: false
      }
    }
  },
  required: ["summary", "events"],
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
  const userRequest = String(payload?.request || "").trim();
  const day = payload?.day;
  if (!userRequest || !day || !Array.isArray(day.events)) return jsonResponse({ error: "Missing request or day data" }, 400);

  const systemPrompt = [
    "You are a practical travel itinerary planner for a two-person Italy trip.",
    "Revise only the supplied day according to the user request.",
    "Preserve confirmed or booked flights, hotels, trains and fixed appointment times unless the user explicitly asks to change them.",
    "Keep the route geographically and chronologically sensible.",
    "Split multi-stop instructions into separate events instead of putting multiple destinations in one title.",
    "For a route, title it as 'Origin → Destination' and include map entries for both origin and destination.",
    "For restaurants or meals, use a place event and include a map entry.",
    "Use concise Chinese titles and practical Chinese details.",
    "Return the complete final schedule for the day, not just the changes."
  ].join(" ");

  const input = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify({ currentDay: day, requestedChange: userRequest }, null, 2) }
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
            name: "revised_day_plan",
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
    const plan = JSON.parse(outputText);
    return jsonResponse(plan);
  } catch (error) {
    return jsonResponse({ error: error?.message || "Unexpected planner error" }, 500);
  }
}
