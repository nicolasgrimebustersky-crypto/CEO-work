import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import {
  isAllowedImageType,
  priceItems,
  usableItems,
  type PricedItem,
} from "@/lib/estimateDraft";

/**
 * Drafting estimate wording with Claude.
 *
 * The model is given the job in the operator's own words, up to four photos,
 * and the price they have already decided on. It returns what the work was and
 * roughly how the job divides — never the money. lib/estimateDraft.ts turns the
 * split into dollars that add up to the price that was typed in.
 *
 * That division of labour is the point. The wording is what a model is good at
 * and what costs the operator two minutes of typing on a doorstep; the total is
 * the one part of an estimate that must not be approximately right.
 */

const MODEL = "claude-opus-5";

export const isEstimateAIConfigured = Boolean(
  (process.env.ANTHROPIC_API_KEY ?? "").trim(),
);

/** What the model is asked to produce, enforced by the API rather than hoped for. */
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "One entry per distinct piece of work. Usually one to four.",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "What the service is called, as it would appear on an invoice. Three or four words: 'Driveway pressure wash', 'Gutter clear-out'.",
          },
          description: {
            type: "string",
            description:
              "One sentence saying what it actually covers, specific enough to settle an argument three weeks later about whether the back patio was included.",
          },
          share: {
            type: "number",
            description:
              "Roughly what fraction of the whole job this part was, between 0 and 1. All shares together should be about 1.",
          },
        },
        required: ["name", "description", "share"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const SYSTEM = `You write line items for a small pressure-washing, landscaping and snow-removal business in Oldham County, Kentucky. Two people run it and they are usually standing in a customer's driveway when they use this.

Turn what they tell you into estimate line items a homeowner will read.

Rules:
- Plain, concrete language. "Driveway pressure wash", not "Exterior Surface Restoration Service".
- Describe only work that was actually described or is plainly visible in the photos. Never invent a service to pad the estimate.
- If the job is one thing, return one line. Do not split a simple job to look thorough.
- The description settles later disagreements: name the specific surfaces and areas covered.
- Never mention prices, totals, rates or hours anywhere in your text. You are not pricing this job — the operator already has. You only say what the work was and roughly how it divides.
- Write for the customer, not for the crew. No internal shorthand.`;

export interface DraftPhoto {
  mediaType: string;
  /** base64, no data: prefix. */
  data: string;
}

export interface DraftResult {
  items: PricedItem[];
  /** What the model was told the job was, echoed for the timeline. */
  usedPhotos: number;
}

/**
 * Asks the model for the wording, then prices it here.
 *
 * `effort: "low"` on purpose: this is a short writing task, not a reasoning
 * one, and the operator is standing on a doorstep waiting for it. Thinking is
 * left adaptive rather than disabled — disabling it on this model can leak
 * reasoning into the visible text, which here would end up on a customer's
 * estimate.
 */
export async function draftEstimate(input: {
  description: string;
  total: number;
  serviceType: string;
  photos: DraftPhoto[];
}): Promise<DraftResult> {
  const client = new Anthropic();

  const photos = input.photos.filter((photo) => isAllowedImageType(photo.mediaType));

  const content: Anthropic.ContentBlockParam[] = [
    ...photos.map(
      (photo): Anthropic.ContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: photo.mediaType as "image/jpeg", data: photo.data },
      }),
    ),
    {
      type: "text",
      text: [
        `Service: ${input.serviceType.replace(/_/g, " ")}`,
        `What we did: ${input.description.trim()}`,
        photos.length > 0
          ? `${photos.length} photo${photos.length === 1 ? "" : "s"} of the property are attached.`
          : "No photos.",
      ].join("\n"),
    },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: DRAFT_SCHEMA },
    },
    messages: [{ role: "user", content }],
  });

  // A safety decline returns 200 with no usable content. Treated as "no draft"
  // rather than as an error the operator has to interpret — the manual builder
  // is right there and still works.
  if (response.stop_reason === "refusal") {
    return { items: [], usedPhotos: photos.length };
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { items: [], usedPhotos: photos.length };
  }

  const items = usableItems((parsed as { items?: unknown })?.items);
  return { items: priceItems(items, input.total), usedPhotos: photos.length };
}
