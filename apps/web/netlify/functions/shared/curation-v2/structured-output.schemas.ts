export function createCurationBatchResponseSchema(maxSourcesPerLesson: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      lessons: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            lesson_id: { type: "string" },
            lesson_title: { type: "string" },
            sources: {
              type: "array",
              minItems: 1,
              maxItems: maxSourcesPerLesson,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  url: { type: "string" },
                  title: { type: "string" },
                  rationale: { type: "string" },
                  key_topics_covered: {
                    type: "array",
                    items: { type: "string" },
                  },
                  estimated_quality: {
                    type: "number",
                    minimum: 1,
                    maximum: 10,
                  },
                },
                required: [
                  "url",
                  "title",
                  "rationale",
                  "key_topics_covered",
                  "estimated_quality",
                ],
              },
            },
          },
          required: ["lesson_id", "lesson_title", "sources"],
        },
      },
    },
    required: ["lessons"],
  } as const;
}

export const CURATION_SEARCH_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          lesson_id: { type: "string" },
          sources: {
            type: "array",
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                url: { type: "string" },
                title: { type: "string" },
                rationale: { type: "string" },
                search_query: { type: "string" },
              },
              required: ["url", "title", "rationale", "search_query"],
            },
          },
        },
        required: ["lesson_id", "sources"],
      },
    },
  },
  required: ["lessons"],
} as const;
