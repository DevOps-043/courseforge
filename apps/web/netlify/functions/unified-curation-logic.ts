
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { CurationRowInsert } from '../../src/shared/types/curation.types';

// --- CONFIGURATION ---
const LESSONS_PER_BATCH = 2; // Process 2 lessons per API call
const SOURCES_PER_LESSON = 2; // Maximum sources per lesson
const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_FALLBACK_MODEL = 'gemini-1.5-pro';
const DELAY_BETWEEN_BATCHES_MS = 5000;
const MIN_CONTENT_LENGTH = 500;

// Helper function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to get current timestamp
function getCurrentTimestamp(): { date: string; time: string; year: number } {
    const now = new Date();
    return {
        date: now.toISOString().split('T')[0],
        time: now.toTimeString().split(' ')[0],
        year: now.getFullYear()
    };
}

// Generate freshness reminder
function generateFreshnessReminder(batchNumber: number): string {
    const ts = getCurrentTimestamp();
    return `
═══════════════════════════════════════════════════════════════
⏰ RESEARCH SESSION (Batch #${batchNumber})
   Date: ${ts.date} | Time: ${ts.time}
   
   🔴 SEARCH FOR CURRENT CONTENT: ${ts.year - 1}-${ts.year}
   🔴 DO NOT use URLs from memory - SEARCH ONLY
   🔴 Each URL will be CONTENT-VALIDATED
═══════════════════════════════════════════════════════════════
`;
}

// Helper function to resolve redirect URLs
async function resolveRedirectUrl(url: string, timeoutMs: number = 8000): Promise<string> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        clearTimeout(timeoutId);
        const finalUrl = response.url;
        if (finalUrl !== url) {
            console.log(`[URL Resolve] Redirect: ${url.substring(0, 50)}... -> ${finalUrl.substring(0, 80)}...`);
        }
        return finalUrl;
    } catch (error: any) {
        console.log(`[URL Resolve] Failed: ${url.substring(0, 50)}...`);
        return url;
    }
}

// Deep content validation - verifies URL has real educational content
async function validateUrlWithContent(url: string, timeoutMs: number = 10000): Promise<{ isValid: boolean; reason: string; contentLength: number }> {
    const browserHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            redirect: 'follow',
            headers: browserHeaders
        });

        clearTimeout(timeoutId);

        if (response.status >= 400) {
            console.log(`[Content Validation] ${url.substring(0, 50)}... -> HTTP ${response.status} (INVALID)`);
            return { isValid: false, reason: `HTTP ${response.status}`, contentLength: 0 };
        }

        const html = await response.text();

        // Check for soft 404 indicators
        const soft404Patterns = [
            /page\s*(not|no)\s*found/i,
            /404\s*(error|not found|página)/i,
            /no\s*se\s*encontr(ó|o)/i,
            /<title>[^<]*404[^<]*<\/title>/i
        ];

        for (const pattern of soft404Patterns) {
            if (pattern.test(html)) {
                console.log(`[Content Validation] ${url.substring(0, 50)}... -> Soft 404 (INVALID)`);
                return { isValid: false, reason: 'Soft 404', contentLength: 0 };
            }
        }

        // Check for paywall
        const paywallPatterns = [
            /sign\s*in\s*to\s*(continue|access)/i,
            /subscribe\s*to\s*(read|access)/i
        ];

        for (const pattern of paywallPatterns) {
            if (pattern.test(html) && html.length < 5000) {
                console.log(`[Content Validation] ${url.substring(0, 50)}... -> Paywall (INVALID)`);
                return { isValid: false, reason: 'Paywall', contentLength: 0 };
            }
        }

        // Extract text content
        const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

        if (textContent.length < MIN_CONTENT_LENGTH) {
            console.log(`[Content Validation] ${url.substring(0, 50)}... -> Too short (${textContent.length} chars)`);
            return { isValid: false, reason: `Too short (${textContent.length} chars)`, contentLength: textContent.length };
        }

        console.log(`[Content Validation] ${url.substring(0, 50)}... -> VALID (${textContent.length} chars)`);
        return { isValid: true, reason: 'OK', contentLength: textContent.length };

    } catch (error: any) {
        console.log(`[Content Validation] ${url.substring(0, 50)}... -> Error: ${error.message}`);
        return { isValid: false, reason: error.message, contentLength: 0 };
    }
}

// NEW SYSTEM PROMPT - Focused on LESSON research with course context
function generateSystemPrompt(courseTitle: string, courseDescription: string): string {
    return `
ROLE: Deep Research Agent for Educational Course Content
CURRENT DATE: ${new Date().toISOString().split('T')[0]}

═══════════════════════════════════════════════════════════════
*** COURSE CONTEXT ***
═══════════════════════════════════════════════════════════════

Course Title: ${courseTitle}
Course Description: ${courseDescription}

ALL sources MUST be DIRECTLY RELEVANT to this course topic.

═══════════════════════════════════════════════════════════════
*** MISSION: FIND RELEVANT, HIGH-QUALITY SOURCES ***
═══════════════════════════════════════════════════════════════

For each lesson, find 1-2 sources that:
1. Are DIRECTLY RELATED to the course topic: "${courseTitle}"
2. Cover the specific LESSON topic and objective
3. Have educational content (1000+ words)
4. Are current (2024-2026)

═══════════════════════════════════════════════════════════════
*** SEARCH STRATEGY ***
═══════════════════════════════════════════════════════════════

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

═══════════════════════════════════════════════════════════════
*** OUTPUT FORMAT ***
═══════════════════════════════════════════════════════════════

Return ONLY valid JSON:
{
  "lessons": [
    {
      "lesson_id": "...",
      "lesson_title": "...",
      "sources": [
        {
          "url": "FULL URL",
          "title": "Article title",
          "rationale": "How this relates to ${courseTitle}",
          "key_topics_covered": ["topic1", "topic2"],
          "estimated_quality": 8
        }
      ]
    }
  ]
}

CRITICAL: Every source MUST be relevant to "${courseTitle}". Reject unrelated results.
`;
}

// Domains to REJECT for grounding URLs
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
    'semanticscholar.org', // Academic papers often unrelated
    'arxiv.org', // Academic papers
    'replit.app', // Code playgrounds
    'github.com', // Unless course is about coding
    'stackoverflow.com',
    'singaporefi', // Finance forums
    'investopedia.com', // Unless course is about finance
];

// Check if URL is from a blocked/irrelevant domain
function isBlockedDomain(url: string, courseTitle: string): boolean {
    const urlLower = url.toLowerCase();
    const courseLower = courseTitle.toLowerCase();

    // Check explicit blocklist
    for (const domain of BLOCKED_DOMAINS) {
        if (urlLower.includes(domain)) {
            // Exception: if course is about that specific topic
            if (domain === 'github.com' && (courseLower.includes('programación') || courseLower.includes('coding'))) {
                return false;
            }
            if (domain === 'investopedia.com' && (courseLower.includes('finanz') || courseLower.includes('inversi'))) {
                return false;
            }
            console.log(`[Grounding Filter] Blocked: ${url.substring(0, 50)}... (domain: ${domain})`);
            return true;
        }
    }

    return false;
}

// Interface for lesson-based processing
interface LessonToProcess {
    lesson_id: string;
    lesson_title: string;
    lesson_objective: string;
    module_title: string;
    component_count: number;
}

interface LessonSource {
    url: string;
    title: string;
    rationale: string;
    key_topics_covered: string[];
    estimated_quality: number;
}

interface LessonResult {
    lesson_id: string;
    lesson_title: string;
    sources: LessonSource[];
}

export async function processUnifiedCuration(params: {
    artifactId: string;
    curationId: string;
    customPrompt?: string;
    supabaseUrl: string;
    supabaseKey: string;
    geminiApiKey: string;
}) {
    const { artifactId, curationId, customPrompt, supabaseUrl, supabaseKey, geminiApiKey } = params;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const client = new GoogleGenAI({ apiKey: geminiApiKey });

    console.log(`[Lesson Curation] Starting for Artifact: ${artifactId}, Curation: ${curationId}`);

    // 1. Fetch Configuration, Plan, Course Context, and Syllabus
    const [settingsResult, planResult, artifactResult, syllabusResult] = await Promise.all([
        supabase.from('model_settings').select('*').eq('setting_type', 'CURATION').eq('is_active', true).single(),
        supabase.from('instructional_plans').select('lesson_plans').eq('artifact_id', artifactId).single(),
        supabase.from('artifacts').select('title, description, main_topic, audience, objectives').eq('id', artifactId).single(),
        supabase.from('syllabus').select('modules, learning_objectives, keywords').eq('artifact_id', artifactId).single()
    ]);

    // Extract comprehensive course context
    const courseTitle = artifactResult.data?.title || artifactResult.data?.main_topic || 'Unknown Course';
    const courseDescription = artifactResult.data?.description || '';
    const courseAudience = artifactResult.data?.audience || '';
    const courseObjectives = artifactResult.data?.objectives || [];

    // Extract syllabus info for better context
    const syllabusModules = syllabusResult.data?.modules || [];
    const syllabusKeywords = syllabusResult.data?.keywords || [];
    const learningObjectives = syllabusResult.data?.learning_objectives || courseObjectives;

    // Build module summary for context
    const moduleNames = syllabusModules.slice(0, 5).map((m: any) => m.title || m.name).filter(Boolean);
    const keywordsStr = Array.isArray(syllabusKeywords) ? syllabusKeywords.slice(0, 10).join(', ') : '';

    console.log(`[Lesson Curation] Course: "${courseTitle}"`);
    console.log(`[Lesson Curation] Modules: ${moduleNames.join(', ') || 'N/A'}`);
    console.log(`[Lesson Curation] Keywords: ${keywordsStr || 'N/A'}`);

    let activeModel = settingsResult.data?.model_name || DEFAULT_MODEL;
    const fallbackModel = settingsResult.data?.fallback_model || DEFAULT_FALLBACK_MODEL;
    console.log(`[Lesson Curation] Using model: ${activeModel}, Fallback: ${fallbackModel}`);

    // Build comprehensive course context string
    const fullCourseContext = `
COURSE TITLE: ${courseTitle}
${courseDescription ? `DESCRIPTION: ${courseDescription.substring(0, 300)}` : ''}
${courseAudience ? `TARGET AUDIENCE: ${courseAudience}` : ''}
${moduleNames.length > 0 ? `MAIN MODULES: ${moduleNames.join(', ')}` : ''}
${keywordsStr ? `KEY TOPICS/KEYWORDS: ${keywordsStr}` : ''}
${Array.isArray(learningObjectives) && learningObjectives.length > 0 ? `LEARNING OBJECTIVES: ${learningObjectives.slice(0, 3).join('; ')}` : ''}
`.trim();

    // Generate system prompt with full course context
    const systemPrompt = generateSystemPrompt(courseTitle, fullCourseContext);

    // 2. Extract LESSONS (not components) from the plan
    const lessonPlans = planResult.data?.lesson_plans || [];
    const lessonsToProcess: LessonToProcess[] = [];

    if (Array.isArray(lessonPlans)) {
        lessonPlans.forEach((lesson: any, index: number) => {
            // Ensure unique lesson_id - use index as fallback suffix
            // Also catch 'undefined' string literal which can happen from bad JSON parsing
            const baseId = lesson.lesson_id || lesson.id;
            const isValidId = baseId && baseId !== 'undefined' && baseId !== 'null' && baseId.trim() !== '';
            const uniqueId = isValidId ? baseId : `lesson-${index + 1}`;

            console.log(`[Lesson Curation] Lesson ${index}: baseId="${baseId}" -> uniqueId="${uniqueId}"`);

            lessonsToProcess.push({
                lesson_id: uniqueId,
                lesson_title: lesson.lesson_title || lesson.title || `Lección ${index + 1}`,
                lesson_objective: lesson.objective || lesson.summary || lesson.description || '',
                module_title: lesson.module_title || '',
                component_count: lesson.components?.length || 0
            });
        });
    }

    console.log(`[Lesson Curation] Found ${lessonsToProcess.length} lessons to process.`);
    // DEBUG: Log all lesson IDs being processed
    console.log(`[Lesson Curation] Lesson IDs: ${lessonsToProcess.map(l => l.lesson_id).join(', ')}`);
    console.log(`[Lesson Curation] Lesson Titles: ${lessonsToProcess.map(l => l.lesson_title).slice(0, 5).join(' | ')}...`);

    // 3. Process Lessons in Batches
    const curatedResults: CurationRowInsert[] = [];
    const maxRetries = 2;

    let remainingLessons = [...lessonsToProcess];
    let attempt = 0;

    while (remainingLessons.length > 0 && attempt <= maxRetries) {
        console.log(`[Lesson Curation] Pass ${attempt + 1}/${maxRetries + 1}. Remaining lessons: ${remainingLessons.length}`);

        const failedInThisPass: LessonToProcess[] = [];

        for (let i = 0; i < remainingLessons.length; i += LESSONS_PER_BATCH) {
            const batch = remainingLessons.slice(i, i + LESSONS_PER_BATCH);
            const batchNum = Math.floor(i / LESSONS_PER_BATCH) + 1;
            console.log(`[Lesson Curation] Processing batch ${batchNum} (${batch.length} lessons)...`);

            // Delay between batches
            if (i > 0) {
                console.log(`[Lesson Curation] Waiting ${DELAY_BETWEEN_BATCHES_MS}ms...`);
                await delay(DELAY_BETWEEN_BATCHES_MS);
            }

            const freshnessReminder = generateFreshnessReminder(batchNum);
            const retryNote = attempt > 0 ? "\n⚠️ PREVIOUS ATTEMPT FAILED. Use DIFFERENT search terms.\n" : "";

            const batchPrompt = `
${freshnessReminder}
${retryNote}

═══════════════════════════════════════════════════════════════
COURSE CONTEXT (All sources MUST be relevant to this topic)
═══════════════════════════════════════════════════════════════
${fullCourseContext}

═══════════════════════════════════════════════════════════════
LESSONS TO RESEARCH
═══════════════════════════════════════════════════════════════
${JSON.stringify(batch.map(l => ({
                lesson_id: l.lesson_id,
                title: l.lesson_title,
                objective: l.lesson_objective,
                module: l.module_title
            })), null, 2)}

TASK: Find 1-2 HIGH-QUALITY sources for EACH lesson above.

SEARCH STRATEGY:
- Search for: "${courseTitle}" + [lesson topic] + "guide" OR "tutorial" OR "tips"
- Sources MUST directly relate to ${courseTitle}
- Prefer articles from major publications, .edu sites, or established productivity blogs
- REJECT: Reddit, forums, unrelated PDFs, social media
`;

            try {
                console.log(`[Lesson Curation] Calling ${activeModel}...`);

                const response = await client.models.generateContent({
                    model: activeModel,
                    contents: [{ role: 'user', parts: [{ text: batchPrompt }] }],
                    config: {
                        systemInstruction: { parts: [{ text: systemPrompt }] },
                        tools: [{ googleSearch: {} }],
                        temperature: 0.3 // Lower for more reliable results
                    }
                });

                console.log(`[Lesson Curation] Response received.`);

                // Extract grounding URLs first
                const groundingMeta = response.candidates?.[0]?.groundingMetadata;
                const groundingUrls: { uri: string; title: string }[] = [];

                if (groundingMeta?.groundingChunks) {
                    console.log(`[Lesson Curation] Found ${groundingMeta.groundingChunks.length} grounding sources.`);
                    for (const chunk of groundingMeta.groundingChunks) {
                        if (chunk.web?.uri) {
                            let finalUri = chunk.web.uri;
                            if (finalUri.includes('grounding-api-redirect')) {
                                finalUri = await resolveRedirectUrl(finalUri);
                            }

                            // FILTER: Skip blocked/irrelevant domains
                            if (isBlockedDomain(finalUri, courseTitle)) {
                                continue; // Skip this source
                            }

                            groundingUrls.push({
                                uri: finalUri,
                                title: chunk.web.title || 'Source from Google Search'
                            });
                            console.log(`   - Grounding: ${chunk.web.title || 'Untitled'}`);
                        }
                    }
                }

                // Parse response text
                const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!responseText) {
                    console.warn(`[Lesson Curation] Empty response. Using grounding URLs as fallback.`);

                    // Fallback: assign grounding URLs to lessons (limit to SOURCES_PER_LESSON)
                    if (groundingUrls.length > 0) {
                        for (let j = 0; j < batch.length; j++) {
                            const lesson = batch[j];
                            // Only add up to SOURCES_PER_LESSON per lesson
                            const sourcesToAdd = Math.min(SOURCES_PER_LESSON, groundingUrls.length);
                            for (let s = 0; s < sourcesToAdd; s++) {
                                const source = groundingUrls[s];
                                curatedResults.push({
                                    curation_id: curationId,
                                    lesson_id: lesson.lesson_id,
                                    lesson_title: lesson.lesson_title,
                                    component: 'LESSON_SOURCE',
                                    is_critical: true,
                                    source_ref: source.uri,
                                    source_title: source.title,
                                    source_rationale: 'Fuente de Google Search (respuesta vacía del modelo)',
                                    url_status: 'OK',
                                    apta: true,
                                    cobertura_completa: true,
                                    auto_evaluated: false,
                                    auto_reason: `Grounding fallback (${activeModel})`
                                });
                            }
                        }
                        continue;
                    } else {
                        failedInThisPass.push(...batch);
                        continue;
                    }
                }

                // Parse JSON from response
                let parsed: { lessons: LessonResult[] };
                try {
                    let jsonStr = responseText;
                    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
                    if (jsonMatch) {
                        jsonStr = jsonMatch[1].trim();
                    } else {
                        const jsonStart = responseText.indexOf('{');
                        const jsonEnd = responseText.lastIndexOf('}');
                        if (jsonStart !== -1 && jsonEnd > jsonStart) {
                            jsonStr = responseText.substring(jsonStart, jsonEnd + 1);
                        }
                    }
                    parsed = JSON.parse(jsonStr);
                } catch (parseError) {
                    console.error(`[Lesson Curation] JSON parse error. Using grounding fallback.`);
                    if (groundingUrls.length > 0) {
                        for (let j = 0; j < batch.length; j++) {
                            const lesson = batch[j];
                            // Only add up to SOURCES_PER_LESSON per lesson
                            const sourcesToAdd = Math.min(SOURCES_PER_LESSON, groundingUrls.length);
                            for (let s = 0; s < sourcesToAdd; s++) {
                                const source = groundingUrls[s];
                                curatedResults.push({
                                    curation_id: curationId,
                                    lesson_id: lesson.lesson_id,
                                    lesson_title: lesson.lesson_title,
                                    component: 'LESSON_SOURCE',
                                    is_critical: true,
                                    source_ref: source.uri,
                                    source_title: source.title,
                                    source_rationale: 'Fuente de Google Search (error de parseo)',
                                    url_status: 'OK',
                                    apta: true,
                                    cobertura_completa: true,
                                    auto_evaluated: false,
                                    auto_reason: `Grounding fallback (${activeModel})`
                                });
                            }
                        }
                        continue;
                    }
                    failedInThisPass.push(...batch);
                    continue;
                }

                // Process each lesson result
                // DEBUG: Log parsed lesson IDs vs expected
                const parsedLessonIds = parsed.lessons?.map(l => l.lesson_id) || [];
                console.log(`[Lesson Curation] Model returned lessons: ${parsedLessonIds.join(', ')}`);
                console.log(`[Lesson Curation] Expected lessons: ${batch.map(l => l.lesson_id).join(', ')}`);

                // FIXED: Use position-based assignment if ID matching fails
                for (let lessonIdx = 0; lessonIdx < batch.length; lessonIdx++) {
                    const lesson = batch[lessonIdx];

                    // Try to find by ID first, then fallback to position
                    let lessonResult = parsed.lessons?.find(l =>
                        l.lesson_id === lesson.lesson_id ||
                        l.lesson_id?.toLowerCase() === lesson.lesson_id?.toLowerCase()
                    );

                    // If no ID match, try to match by position in array
                    if (!lessonResult && parsed.lessons && parsed.lessons[lessonIdx]) {
                        console.log(`[Lesson Curation] ID mismatch for ${lesson.lesson_id}, using position ${lessonIdx}`);
                        lessonResult = parsed.lessons[lessonIdx];
                    }

                    if (!lessonResult?.sources || lessonResult.sources.length === 0) {
                        console.warn(`[Lesson Curation] No sources for ${lesson.lesson_id}. Using grounding.`);
                        // Use a different grounding URL for each lesson to avoid duplicates
                        if (groundingUrls.length > 0) {
                            const sourceIdx = lessonIdx % groundingUrls.length;
                            const source = groundingUrls[sourceIdx];
                            curatedResults.push({
                                curation_id: curationId,
                                lesson_id: lesson.lesson_id,
                                lesson_title: lesson.lesson_title,
                                component: 'LESSON_SOURCE',
                                is_critical: true,
                                source_ref: source.uri,
                                source_title: source.title,
                                source_rationale: 'Fuente de Google Search (sin resultado específico)',
                                url_status: 'OK',
                                apta: true,
                                cobertura_completa: true,
                                auto_evaluated: false,
                                auto_reason: `Grounding fallback (${activeModel})`
                            });
                        } else {
                            failedInThisPass.push(lesson);
                        }
                        continue;
                    }

                    // Validate and save each source
                    let validSourceCount = 0;
                    for (const source of lessonResult.sources) {
                        if (validSourceCount >= SOURCES_PER_LESSON) break;

                        // Validate URL
                        let urlToValidate = source.url;
                        if (urlToValidate.includes('grounding-api-redirect')) {
                            urlToValidate = await resolveRedirectUrl(urlToValidate);
                        }

                        const validation = await validateUrlWithContent(urlToValidate);

                        if (validation.isValid) {
                            curatedResults.push({
                                curation_id: curationId,
                                lesson_id: lesson.lesson_id,
                                lesson_title: lesson.lesson_title,
                                component: 'LESSON_SOURCE',
                                is_critical: true,
                                source_ref: urlToValidate,
                                source_title: source.title,
                                source_rationale: source.rationale,
                                url_status: 'OK',
                                apta: true,
                                cobertura_completa: true,
                                notes: `Quality: ${source.estimated_quality}/10. Topics: ${source.key_topics_covered?.join(', ') || 'N/A'}`,
                                auto_evaluated: true,
                                auto_reason: `Validated (${activeModel})`
                            });
                            validSourceCount++;
                            console.log(`[Lesson Curation] ✓ ${lesson.lesson_id}: ${source.title}`);
                        } else {
                            console.log(`[Lesson Curation] ✗ ${lesson.lesson_id}: ${source.url} - ${validation.reason}`);

                            // Try grounding URL as fallback
                            if (groundingUrls.length > 0 && validSourceCount === 0) {
                                const groundingSource = groundingUrls[0];
                                curatedResults.push({
                                    curation_id: curationId,
                                    lesson_id: lesson.lesson_id,
                                    lesson_title: lesson.lesson_title,
                                    component: 'LESSON_SOURCE',
                                    is_critical: true,
                                    source_ref: groundingSource.uri,
                                    source_title: groundingSource.title,
                                    source_rationale: `Fuente alternativa de Google Search (URL original falló: ${validation.reason})`,
                                    url_status: 'OK',
                                    apta: true,
                                    cobertura_completa: true,
                                    auto_evaluated: false,
                                    auto_reason: `Grounding fallback (${activeModel})`
                                });
                                validSourceCount++;
                            }
                        }
                    }

                    if (validSourceCount === 0) {
                        failedInThisPass.push(lesson);
                    }
                }

            } catch (err: any) {
                console.error(`[Lesson Curation] Batch Error (${activeModel}):`, err.message);

                if (attempt < maxRetries) {
                    failedInThisPass.push(...batch);

                    if (err.message.includes('503') || err.message.includes('overloaded')) {
                        console.warn(`[Lesson Curation] Model overloaded. Switching to: ${fallbackModel}`);
                        activeModel = fallbackModel;
                        await delay(10000);
                    }
                }
            }
        }

        remainingLessons = failedInThisPass;
        attempt++;
        if (remainingLessons.length === 0) break;
    }

    // Insert results
    if (curatedResults.length > 0) {
        const { error } = await supabase.from('curation_rows').insert(curatedResults);
        if (error) {
            console.error('[Lesson Curation] Insert Error:', error);
        } else {
            console.log(`[Lesson Curation] Inserted ${curatedResults.length} lesson sources.`);
        }
    }

    // Update curation status
    await supabase.from('curation').update({
        state: 'PHASE2_GENERATED',
        updated_at: new Date().toISOString()
    }).eq('id', curationId);

    console.log(`[Lesson Curation] Complete. Processed ${lessonsToProcess.length} lessons.`);
    return curatedResults.length;
}
