import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import {
    getAuthenticatedUser,
    getAuthorizedMaterialComponentAdmin,
    getServiceRoleClient,
} from '@/lib/server/artifact-action-auth';

interface StoryboardItem {
    slide_index?: number;
    on_screen_text?: string;
    narration_text?: string;
    visual_content?: string;
}

interface ScriptSection {
    section_number?: number;
    on_screen_text?: string;
    narration_text?: string;
    visual_notes?: string;
}

interface RenderableSlideAsset {
    slide_index: number;
    storage_path: string;
    public_url: string;
    content_type?: string;
}

async function rasterizeSlideSvgToPng(svg: string): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    return sharp(Buffer.from(svg, 'utf-8'), {
        density: 144,
    })
        .resize(1920, 1080, { fit: 'cover' })
        .png()
        .toBuffer();
}

function escapeXml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function splitTextLines(value: string, maxLength: number, maxLines: number) {
    const words = value.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (next.length > maxLength && current) {
            lines.push(current);
            current = word;
        } else {
            current = next;
        }

        if (lines.length >= maxLines) break;
    }

    if (current && lines.length < maxLines) {
        lines.push(current);
    }

    return lines;
}

function buildSlideSvg(slide: {
    index: number;
    title: string;
    bullets: string[];
    visualNotes: string;
}) {
    const titleLines = splitTextLines(slide.title, 34, 2);
    const bulletLines = slide.bullets
        .flatMap((bullet) => splitTextLines(bullet, 54, 2))
        .slice(0, 6);
    const noteLines = splitTextLines(slide.visualNotes || '', 70, 2);

    const titleSvg = titleLines
        .map(
            (line, index) =>
                `<text x="120" y="${170 + index * 58}" fill="#F8FAFC" font-size="50" font-weight="800">${escapeXml(line)}</text>`,
        )
        .join('');
    const bulletsSvg = bulletLines
        .map(
            (line, index) =>
                `<text x="168" y="${370 + index * 56}" fill="#E2E8F0" font-size="34" font-weight="500">${escapeXml(line)}</text>`,
        )
        .join('');
    const bulletsDotsSvg = bulletLines
        .map(
            (_line, index) =>
                `<circle cx="130" cy="${358 + index * 56}" r="9" fill="#38BDF8" />`,
        )
        .join('');
    const notesSvg = noteLines
        .map(
            (line, index) =>
                `<text x="120" y="${900 + index * 34}" fill="#94A3B8" font-size="24">${escapeXml(line)}</text>`,
        )
        .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#1E293B"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#38BDF8"/>
      <stop offset="100%" stop-color="#818CF8"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <rect x="72" y="72" width="1776" height="936" rx="44" fill="#1E293B" stroke="#334155" stroke-width="2"/>
  <rect x="72" y="72" width="14" height="936" rx="7" fill="url(#accent)"/>
  <text x="120" y="118" fill="#38BDF8" font-size="24" font-weight="700" letter-spacing="3">COURSEFORGE</text>
  <text x="1700" y="118" fill="#94A3B8" font-size="28" font-weight="700">${String(slide.index).padStart(2, '0')}</text>
  ${titleSvg}
  ${bulletsDotsSvg}
  ${bulletsSvg}
  ${notesSvg}
</svg>`;
}

async function uploadRenderableSlideImages(params: {
    admin: ReturnType<typeof getServiceRoleClient>;
    componentId: string;
    slides: Array<{
        index: number;
        title: string;
        bullets: string[];
        visualNotes: string;
    }>;
}) {
    const images: RenderableSlideAsset[] = [];

    for (const slide of params.slides) {
        const svg = buildSlideSvg(slide);
        const png = await rasterizeSlideSvgToPng(svg);
        const storagePath = `slides/${params.componentId}-slide-${String(slide.index).padStart(2, '0')}.png`;
        const { error } = await params.admin.storage
            .from('production-assets')
            .upload(storagePath, png, {
                contentType: 'image/png',
                upsert: true,
            });

        if (error) {
            throw new Error(`No se pudo guardar la slide renderizable ${slide.index}: ${error.message}`);
        }

        const { data: { publicUrl } } = params.admin.storage
            .from('production-assets')
            .getPublicUrl(storagePath);

        images.push({
            slide_index: slide.index,
            storage_path: `production-assets/${storagePath}`,
            public_url: publicUrl,
            content_type: 'image/png',
        });
    }

    return images;
}

export async function POST(request: Request) {
    try {
        const { componentId } = await request.json() as { componentId?: string };

        if (!componentId) {
            return NextResponse.json(
                { error: 'El parámetro componentId es requerido' },
                { status: 400 },
            );
        }

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
        if (!authorizedComponent) {
            return NextResponse.json(
                { error: 'Componente no encontrado para esta empresa' },
                { status: 404 },
            );
        }

        const admin = authorizedComponent.admin;
        const component = authorizedComponent.component;
        const content = (component.content || {}) as Record<string, any>;

        // Extract slides data from storyboard or script sections
        const slides: Array<{
            index: number;
            title: string;
            bullets: string[];
            narration: string;
            visualNotes: string;
        }> = [];

        const rawStoryboard = content.storyboard as StoryboardItem[] | undefined;
        const rawScriptSections = content.script?.sections as ScriptSection[] | undefined;

        if (Array.isArray(rawStoryboard) && rawStoryboard.length > 0) {
            rawStoryboard.forEach((item, idx) => {
                const text = item.on_screen_text || '';
                const lines = text.split('\n').map(l => l.trim().replace(/^[-*•]\s*/, '')).filter(Boolean);
                const title = lines[0] || `Diapositiva ${idx + 1}`;
                const bullets = lines.slice(1);

                slides.push({
                    index: item.slide_index || idx + 1,
                    title,
                    bullets: bullets.length > 0 ? bullets : [text],
                    narration: item.narration_text || '',
                    visualNotes: item.visual_content || '',
                });
            });
        } else if (Array.isArray(rawScriptSections) && rawScriptSections.length > 0) {
            rawScriptSections.forEach((section, idx) => {
                const text = section.on_screen_text || '';
                const lines = text.split('\n').map(l => l.trim().replace(/^[-*•]\s*/, '')).filter(Boolean);
                const title = lines[0] || `Sección ${idx + 1}`;
                const bullets = lines.slice(1);

                slides.push({
                    index: section.section_number || idx + 1,
                    title,
                    bullets: bullets.length > 0 ? bullets : [text],
                    narration: section.narration_text || '',
                    visualNotes: section.visual_notes || '',
                });
            });
        } else {
            // Fallback slide
            slides.push({
                index: 1,
                title: 'Introducción',
                bullets: ['Presentación del tema de la lección.'],
                narration: 'Bienvenidos a la lección.',
                visualNotes: 'Fondo corporativo limpio.',
            });
        }

        // Generate corporate slide design (Premium look & feel)
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Presentación generada - Export</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Plus+Jakarta+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0F172A;
      --bg-card: #1E293B;
      --accent-color: #38BDF8;
      --text-main: #F8FAFC;
      --text-muted: #94A3B8;
      --border-color: #334155;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-main);
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      padding: 2rem;
    }
    .presentation-container {
      max-width: 1000px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1rem;
    }
    .header-title {
      font-family: 'Outfit', sans-serif;
      font-weight: 800;
      font-size: 1.5rem;
      letter-spacing: -0.025em;
      background: linear-gradient(135deg, #38BDF8, #818CF8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .slide-count {
      font-size: 0.875rem;
      color: var(--text-muted);
      font-weight: 600;
      background-color: var(--bg-card);
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      border: 1px solid var(--border-color);
    }
    .slide {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 1.5rem;
      padding: 3rem;
      aspect-ratio: 16 / 9;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
    }
    .slide::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 6px;
      height: 100%;
      background-color: var(--accent-color);
    }
    .slide-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1.5rem;
    }
    .slide-title {
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
      font-size: 2.25rem;
      color: var(--text-main);
      line-height: 1.2;
    }
    .slide-number {
      font-family: 'Outfit', sans-serif;
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--accent-color);
      opacity: 0.8;
    }
    .slide-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .bullet-list {
      list-style-type: none;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .bullet-item {
      font-size: 1.25rem;
      line-height: 1.6;
      color: var(--text-main);
      position: relative;
      padding-left: 1.75rem;
    }
    .bullet-item::before {
      content: '✦';
      position: absolute;
      left: 0;
      color: var(--accent-color);
    }
    .slide-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 0.875rem;
      color: var(--text-muted);
    }
    .notes-container {
      background-color: #0B0F19;
      border: 1px solid var(--border-color);
      border-radius: 1rem;
      padding: 1.5rem;
      margin-top: -1rem;
      font-size: 0.875rem;
      line-height: 1.6;
    }
    .notes-heading {
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
      color: var(--accent-color);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .notes-content {
      color: var(--text-main);
    }
    @media (max-width: 768px) {
      body {
        padding: 1rem;
      }
      .slide {
        padding: 1.5rem;
        aspect-ratio: auto;
        min-height: 300px;
      }
      .slide-title {
        font-size: 1.75rem;
      }
      .bullet-item {
        font-size: 1.1rem;
      }
    }
  </style>
</head>
<body>
  <div class="presentation-container">
    <div class="header-bar">
      <h1 class="header-title">Presentación generada</h1>
      <span class="slide-count">${slides.length} diapositivas</span>
    </div>

    ${slides.map((slide) => `
    <div class="slide">
      <div class="slide-header">
        <h2 class="slide-title">${slide.title}</h2>
        <span class="slide-number">${String(slide.index).padStart(2, '0')}</span>
      </div>
      <div class="slide-body">
        <ul class="bullet-list">
          ${slide.bullets.map(b => `<li class="bullet-item">${b}</li>`).join('')}
        </ul>
      </div>
      <div class="slide-footer">
        <span>SofLIA - Engine</span>
        <span>Plantilla Corporativa</span>
      </div>
    </div>

    <div class="notes-container">
      <div class="notes-heading">Locución / Notas del Orador</div>
      <p class="notes-content">${slide.narration || 'Sin locución para esta diapositiva.'}</p>
      ${slide.visualNotes ? `
      <div class="notes-heading" style="margin-top: 1rem;">Contexto Visual</div>
      <p class="notes-content" style="color: var(--text-muted);">${slide.visualNotes}</p>
      ` : ''}
    </div>
    `).join('<hr style="border-color: var(--border-color); margin: 2rem 0; opacity: 0.3;" />')}
  </div>
</body>
</html>`;

        const slideImages = await uploadRenderableSlideImages({
            admin,
            componentId,
            slides,
        });

        // Keep the legacy storage field for compatibility with existing assets.
        const currentAssets = component.assets || {};
        const generatedSlidesId = currentAssets.slides?.open_design_project_id || `slides-${componentId}-${Date.now().toString(36)}`;
        
        const updatedAssets = {
            ...currentAssets,
            slides: {
                ...currentAssets.slides,
                open_design_project_id: generatedSlidesId,
                // We mock saving the html content path directly to storage path as reference
                html_content_path: `production-assets/slides/${componentId}-slides.html`,
                images: slideImages,
            },
            updated_at: new Date().toISOString(),
        };

        // Also save this HTML to the Supabase Storage production-assets bucket so it can be downloaded/viewed
        const htmlBuffer = Buffer.from(html, 'utf-8');
        const storagePath = `slides/${componentId}-slides.html`;

        const { error: uploadError } = await admin.storage
            .from('production-assets')
            .upload(storagePath, htmlBuffer, {
                contentType: 'text/html',
                upsert: true,
            });

        if (uploadError) {
            console.error('[API /open-design/export] Storage upload error:', uploadError);
        } else {
            const { data: { publicUrl } } = admin.storage
                .from('production-assets')
                .getPublicUrl(storagePath);
            updatedAssets.slides.html_public_url = publicUrl;
        }

        // Save updated assets to material_component
        await admin
            .from('material_components')
            .update({ assets: updatedAssets })
            .eq('id', componentId);

        return NextResponse.json({
            success: true,
            html,
            generatedSlidesId,
            openDesignProjectId: generatedSlidesId,
            htmlPublicUrl: updatedAssets.slides.html_public_url || null,
            slideImages,
        });

    } catch (error: unknown) {
        console.error('[API /open-design/export] Unexpected error:', error);
        return NextResponse.json(
            { error: 'Error interno del servidor al exportar presentacion' },
            { status: 500 },
        );
    }
}
