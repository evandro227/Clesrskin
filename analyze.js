// /api/analyze.js
// This runs on Vercel's servers, NOT in the user's browser.
// Your ANTHROPIC_API_KEY stays secret here and is never exposed to the public.

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { image, mimeType } = await req.json();

    if (!image) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const API_KEY = process.env.ANTHROPIC_API_KEY;

    if (!API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Server not configured — missing API key' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const SYSTEM_PROMPT = `You are ClearSkin AI — a professional dermatology AI assistant.
Analyze the skin image carefully. Respond ONLY with a single valid JSON object, no markdown, no text outside the JSON.

Required JSON:
{
  "condition": "Precise medical or common name of the condition",
  "severity": "Mild" | "Moderate" | "Severe",
  "confidence": <integer 0-100>,
  "description": "2-3 sentences: what you visually observe, what the condition is, and the likely mechanism.",
  "body_area": "Body area shown (e.g. face, forehead, cheek, jawline, back, chest, arm)",
  "causes": ["specific cause 1","specific cause 2","specific cause 3"],
  "actions": ["clear step 1","clear step 2","clear step 3","clear step 4"],
  "avoid": ["specific ingredient or habit 1","ingredient 2","habit 3"],
  "ingredients": ["beneficial ingredient 1","ingredient 2","ingredient 3","ingredient 4"],
  "products": [
    {"name":"Specific product name or type","type":"Cleanser/Serum/Cream/Spot Treatment/etc","stars":"★★★★★"},
    {"name":"...","type":"...","stars":"★★★★☆"},
    {"name":"...","type":"...","stars":"★★★★★"}
  ],
  "skin_types": ["applicable skin type from: Oily, Dry, Combination, Sensitive, Normal"],
  "lifestyle_tips": ["actionable lifestyle change 1","lifestyle change 2"],
  "see_doctor": true | false,
  "doctor_reason": "Specific reason if see_doctor is true, else null"
}

Rules:
- All string arrays must have at least 1 item
- confidence must be an integer
- see_doctor must be boolean
- If image is unclear/not skin: condition="Unclear Image", confidence=20, see_doctor=false, describe in description what would improve the photo
- Return ONLY valid JSON`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1300,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType || 'image/jpeg',
                  data: image,
                },
              },
              { type: 'text', text: 'Analyze this skin image and return JSON only.' },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return new Response(
        JSON.stringify({
          error: errBody.error?.message || `Anthropic API error: ${response.status}`,
        }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const rawText = (data.content || []).map((b) => b.text || '').join('').trim();
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ error: 'Could not parse AI response — please try again' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!result.condition) {
      return new Response(
        JSON.stringify({ error: 'Incomplete AI response — please try again' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Unexpected server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
