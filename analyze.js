// /api/analyze.js
// This runs on Vercel's servers, NOT in the user's browser.
// Your GEMINI_API_KEY stays secret here and is never exposed to the public.

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

    const API_KEY = process.env.GEMINI_API_KEY;

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
- Return ONLY valid JSON, no markdown code fences`;

    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: SYSTEM_PROMPT + '\n\nAnalyze this skin image and return JSON only.' },
              {
                inline_data: {
                  mime_type: mimeType || 'image/jpeg',
                  data: image,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      // Full detail goes to Vercel's server logs (visible to you, not the public)
      console.error('Gemini API error', response.status, JSON.stringify(errBody));

      const msg = errBody.error?.message || `Gemini API error: ${response.status}`;
      return new Response(
        JSON.stringify({
          error: msg,
          status_code: response.status,
          gemini_error: errBody.error || null,
        }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      console.error('Gemini truncated response (MAX_TOKENS)', JSON.stringify(data.usageMetadata||{}));
      return new Response(
        JSON.stringify({ error: 'AI response was cut off — please try again' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const rawText =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || '';

    if (!rawText) {
      return new Response(
        JSON.stringify({ error: 'Empty response from AI — please try again' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      // Fallback: extract the outermost {...} block in case there's stray text around it
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          result = JSON.parse(match[0]);
        } catch (secondErr) {
          return new Response(
            JSON.stringify({
              error: 'Could not parse AI response — please try again',
              debug_raw: cleaned.slice(0, 300),
            }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } else {
        return new Response(
          JSON.stringify({
            error: 'Could not parse AI response — please try again',
            debug_raw: cleaned.slice(0, 300),
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } }
        );
      }
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
