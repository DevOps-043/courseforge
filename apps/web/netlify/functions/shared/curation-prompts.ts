function getCurrentTimestamp() {
  const now = new Date();
  return {
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().split(' ')[0],
    year: now.getFullYear(),
  };
}

const BLOCKED_DOMAINS = [
  'reddit.com',
  'quora.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'pinterest.com',
  'linkedin.com/posts',
  'semanticscholar.org',
  'arxiv.org',
  'replit.app',
  'github.com',
  'stackoverflow.com',
  'singaporefi',
  'investopedia.com',
];

export function generateFreshnessReminder(batchNumber: number) {
  const timestamp = getCurrentTimestamp();
  return `
================================================================
RESEARCH SESSION (Batch #${batchNumber})
Date: ${timestamp.date} | Time: ${timestamp.time}

SEARCH FOR CURRENT CONTENT: ${timestamp.year - 1}-${timestamp.year}
DO NOT use URLs from memory - SEARCH ONLY
Each URL will be CONTENT-VALIDATED
================================================================
`;
}

export function generateSystemPrompt(
  courseTitle: string,
  courseDescription: string,
) {
  return `
ROLE: Deep Research Agent for Educational Course Content
CURRENT DATE: ${new Date().toISOString().split('T')[0]}

================================================================
COURSE CONTEXT
================================================================

Course Title: ${courseTitle}
Course Description: ${courseDescription}

ALL sources MUST be DIRECTLY RELEVANT to this course topic.

================================================================
MISSION: FIND RELEVANT, HIGH-QUALITY SOURCES
================================================================

For each lesson, find 1-2 sources that:
1. Are DIRECTLY RELATED to the course topic: "${courseTitle}"
2. Cover the specific LESSON topic and objective
3. Have educational content (1000+ words)
4. Are current (2024-2026)

================================================================
SEARCH STRATEGY
================================================================

SEARCH QUERIES MUST INCLUDE:
- The course topic: "${courseTitle.split(' ').slice(0, 3).join(' ')}"
- The lesson topic
- Keywords: "guide", "tutorial", "how to", "tips"

PREFER:
- Official documentation
- Major publications (Harvard Business Review, Forbes, Inc, Entrepreneur)
- Educational sites (.edu, Coursera, edX)
- Established productivity/business blogs

STRICTLY AVOID:
- Reddit, Quora, forums
- Random PDFs (academic papers unrelated to the course)
- Financial/investment content (unless course is about finance)
- Social media posts
- Content in languages not matching the course

================================================================
OUTPUT FORMAT - CRITICAL
================================================================

You MUST RETURN ONLY VALID JSON. NO explanations, NO markdown, NO extra text.
Start your response with { and end with }
Do NOT wrap in \`\`\`json code blocks

EXACT FORMAT:
{"lessons":[{"lesson_id":"EXACT_ID_FROM_INPUT","lesson_title":"EXACT_TITLE_FROM_INPUT","sources":[{"url":"https://full.url.here","title":"Article title","rationale":"Why relevant","key_topics_covered":["topic1","topic2"],"estimated_quality":8}]}]}

RULES:
1. Use the EXACT lesson_id provided in the input
2. Each lesson MUST have 1-2 sources with full HTTPS URLs
3. URLs MUST be real, complete, and accessible
4. Output MUST parse as valid JSON

CRITICAL: Every source MUST be relevant to "${courseTitle}". Reject unrelated results.
`;
}

export function isBlockedDomain(url: string, courseTitle: string) {
  const urlLower = url.toLowerCase();
  const courseLower = courseTitle.toLowerCase();

  for (const domain of BLOCKED_DOMAINS) {
    if (!urlLower.includes(domain)) {
      continue;
    }

    if (
      domain === 'github.com' &&
      (courseLower.includes('programación') || courseLower.includes('coding'))
    ) {
      return false;
    }

    if (
      domain === 'investopedia.com' &&
      (courseLower.includes('finanz') || courseLower.includes('inversi'))
    ) {
      return false;
    }

    return true;
  }

  return false;
}
