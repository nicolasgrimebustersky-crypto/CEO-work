import Anthropic from "@anthropic-ai/sdk";

// AI square-footage estimator for the instant quote tool.
// POST /api/estimate  { images: [{ image: <base64>, mediaType: "image/jpeg" }, ...], services: ["Driveway / Concrete", "Sidewalk / Walkway"] }
// → { ok: true, estimates: [{ service, sqft_low, sqft_high, sqft_best, confidence, ... }, ...] }
//
// Accepts 1-10 photos of the same property and 1-5 requested services, and
// returns one estimate per requested service (same order, one entry each —
// entries for services not visible in the photos come back with
// is_relevant_photo: false). Requires the ANTHROPIC_API_KEY environment
// variable (set in Netlify: Site configuration → Environment variables).
// Pricing is applied client-side from QUOTE_SERVICES in
// components/site/site-data.ts. Claude may use the web_search tool sparingly
// to confirm typical reference-object dimensions or surface-area norms when
// genuinely unsure — most estimates won't need it.

const ESTIMATE_SCHEMA = {
  type: "object",
  properties: {
    estimates: {
      type: "array",
      description: "One entry per requested service, in the same order as requested",
      items: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "The exact requested service label this estimate is for",
          },
          is_relevant_photo: {
            type: "boolean",
            description: "true if at least one photo shows this service's surface/structure",
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
            description: "One short sentence for the customer about this estimate",
          },
        },
        required: [
          "service",
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
      },
    },
  },
  required: ["estimates"],
  additionalProperties: false,
};

const ALLOWED_MEDIA = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGES = 10;
const MAX_SERVICES = 5;
const MAX_IMAGE_LEN = 2_000_000; // ~1.5MB decoded, per photo
const MAX_TOTAL_LEN = 10_000_000; // ~7.5MB decoded, combined

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

  const { images, services } = body ?? {};
  if (
    !Array.isArray(images) ||
    images.length < 1 ||
    images.length > MAX_IMAGES ||
    !Array.isArray(services) ||
    services.length < 1 ||
    services.length > MAX_SERVICES ||
    services.some((s) => typeof s !== "string" || s.length < 1 || s.length > 60)
  ) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  let totalLen = 0;
  for (const img of images) {
    if (
      !img ||
      typeof img.image !== "string" ||
      img.image.length < 100 ||
      img.image.length > MAX_IMAGE_LEN ||
      !ALLOWED_MEDIA.has(img.mediaType)
    ) {
      return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
    totalLen += img.image.length;
  }
  if (totalLen > MAX_TOTAL_LEN) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 0 });

  const multi = images.length > 1;
  const multiService = services.length > 1;
  const serviceList = services.map((s, i) => `${i + 1}. "${s}"`).join("\n");
  const content = images.flatMap((img, i) => [
    ...(multi ? [{ type: "text", text: `Photo ${i + 1} of ${images.length}:` }] : []),
    { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.image } },
  ]);
  content.push({
    type: "text",
    text: `You estimate surface area for a pressure-washing & landscaping company in Louisville, KY. The customer requested a quote for ${multiService ? "these services" : "this service"}, all visible in the same photo(s):
${serviceList}
${
  multi
    ? `They uploaded ${images.length} photos of the same property from different angles or distances — cross-reference all of them for each service to produce one combined, more accurate estimate per service.`
    : ""
}

Look carefully at every photo before answering. Identify each requested surface independently — e.g. a driveway, a front walkway, and a rear patio are usually distinguishable by material, location, and edges even in the same shot; don't lump them into one blob.

Estimate the total square footage of the surface relevant to each service that is visible (or reasonably inferable) across the photo(s). Use visible objects for scale: a car is ~6ft wide x 16ft long, a single garage door ~8ft wide, a double ~16ft, an entry door ~3ft x 6.7ft, one deck board ~5.5in wide, a concrete driveway slab square ~4-5ft, an average adult stride ~2.5ft. Cross-check your estimate against at least two different reference objects when more than one is visible, and note any disagreement in your reasoning. If only part of a surface is visible, extrapolate conservatively and widen that service's range accordingly. For house siding, estimate the washable exterior wall area of the visible sides and extrapolate to the whole house. For mulching, estimate the ground area of the landscape beds only (not lawn).

You have a web_search tool available. Use it sparingly — only when you're genuinely unsure of a standard reference dimension (e.g. typical single-car garage door width, standard concrete slab size) or want to sanity-check a surface-area conversion. Most estimates should not need a search; don't search for anything unrelated to sizing this job.

Return one entry in "estimates" for every requested service above, in the same order, using the exact requested service text in the "service" field. If a requested service's surface is not visible anywhere in the photos (e.g. photos only show a driveway but siding was also requested), still include an entry for it with is_relevant_photo set to false and a brief explanation in notes — do not skip it. If NONE of the photos show anything relevant to any requested service (e.g. a selfie, a pet, indoors), set is_relevant_photo to false on every entry.`,
  });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: ESTIMATE_SCHEMA },
      },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 }],
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return Response.json({ ok: false, error: "refused" }, { status: 200 });
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) {
      return Response.json({ ok: false, error: "empty_response" }, { status: 502 });
    }
    const parsed = JSON.parse(text);
    return Response.json({ ok: true, estimates: parsed.estimates });
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
