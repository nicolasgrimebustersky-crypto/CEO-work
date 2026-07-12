import Anthropic from "@anthropic-ai/sdk";

// AI square-footage estimator for the instant quote tool.
// POST /api/estimate  { image: <base64>, mediaType: "image/jpeg", service: "Driveway / Concrete" }
// → { ok: true, estimate: { sqft_low, sqft_high, sqft_best, confidence, ... } }
//
// Requires the ANTHROPIC_API_KEY environment variable (set in Netlify:
// Site configuration → Environment variables). Pricing is applied client-side
// from QUOTE_SERVICES in components/site/site-data.ts.

const ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    is_relevant_photo: {
      type: "boolean",
      description:
        "true only if the photo shows an outdoor surface/structure relevant to the requested service",
    },
    surface_type: {
      type: "string",
      description: "What surface is visible, e.g. 'concrete driveway'",
    },
    sqft_low: { type: "integer", description: "Low end of square footage estimate" },
    sqft_high: { type: "integer", description: "High end of square footage estimate" },
    sqft_best: { type: "integer", description: "Single best estimate of square footage" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reference_objects: {
      type: "array",
      items: { type: "string" },
      description: "Objects used for scale (car, door, garage, person...)",
    },
    notes: {
      type: "string",
      description: "One short sentence for the customer about the estimate",
    },
  },
  required: [
    "is_relevant_photo",
    "surface_type",
    "sqft_low",
    "sqft_high",
    "sqft_best",
    "confidence",
    "reference_objects",
    "notes",
  ],
  additionalProperties: false,
};

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);

export default async (req) => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const { image, mediaType, service } = body ?? {};
  if (
    typeof image !== "string" ||
    image.length < 100 ||
    image.length > 5_500_000 || // ~4MB decoded
    !ALLOWED_MEDIA.has(mediaType) ||
    typeof service !== "string" ||
    service.length > 60
  ) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      output_config: {
        effort: "low", // keep latency inside serverless limits; schema keeps output tight
        format: { type: "json_schema", schema: ESTIMATE_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: image },
            },
            {
              type: "text",
              text: `You estimate surface area for a pressure-washing & landscaping company in Louisville, KY. The customer requested a quote for: "${service}".

Estimate the total square footage of the surface relevant to that service that is visible (or reasonably inferable) in the photo. Use visible objects for scale: a car is ~6ft wide x 16ft long, a single garage door ~8ft wide, a double ~16ft, an entry door ~3ft x 6.7ft, one deck board ~5.5in wide, a concrete driveway slab square ~4-5ft. If only part of the surface is visible, extrapolate conservatively and widen the range. For house siding, estimate the washable exterior wall area of the visible sides and extrapolate to the whole house. For mulching, estimate the ground area of the landscape beds only (not lawn).

If the photo does not show anything relevant to the requested service (e.g. a selfie, a pet, indoors), set is_relevant_photo to false and explain briefly in notes.`,
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ ok: false, error: "refused" }, { status: 200 });
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) {
      return Response.json({ ok: false, error: "empty_response" }, { status: 502 });
    }
    const estimate = JSON.parse(text);
    return Response.json({ ok: true, estimate });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ ok: false, error: "busy" }, { status: 429 });
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return Response.json({ ok: false, error: "upstream_unreachable" }, { status: 502 });
    }
    console.error("estimate error", err);
    return Response.json({ ok: false, error: "estimate_failed" }, { status: 500 });
  }
};

export const config = { path: "/api/estimate" };
