import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { prepareOpenDesignDeckForHtmlToPng } from "./open-design-slide-test.service";

export interface RenderableSlideAsset {
  file_name?: string;
  slide_index: number;
  storage_path: string;
  public_url: string;
  content_type?: string;
}

export interface OpenDesignHtmlRasterizeResult {
  images: RenderableSlideAsset[];
  cleanup: {
    slideCount: number;
    removedScripts: number;
    removedOpenDesignScripts: number;
    removedControllerNodes: number;
    removedDynamicVisibilityRules: number;
    hasSceneControllerResidue: boolean;
  };
}

type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

const BUCKET = "production-assets";

export function isHtmlSlideSource(params: {
  fileName?: string;
  mimeType?: string;
  publicUrl?: string;
  storagePath?: string;
}) {
  const mimeType = params.mimeType?.toLowerCase() || "";
  const candidates = [
    params.fileName,
    params.publicUrl,
    params.storagePath,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase().split("?")[0]);

  return (
    mimeType === "text/html" ||
    mimeType === "application/xhtml+xml" ||
    candidates.some((value) => value.endsWith(".html") || value.endsWith(".htm"))
  );
}

export function normalizeProductionAssetStoragePath(rawPath: string): string {
  const storagePath = rawPath.replace(/^production-assets\//, "");
  if (!/^slides\/[a-zA-Z0-9._-]+$/.test(storagePath)) {
    throw new Error("Ruta de HTML de slides invalida.");
  }
  if (!/\.html?$/i.test(storagePath)) {
    throw new Error("El archivo de slides debe ser HTML.");
  }
  return storagePath;
}

function dataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function rasterizeOpenDesignHtmlToStorage(params: {
  admin: ServiceRoleClient;
  componentId: string;
  html: string;
  outputPrefix?: string;
}): Promise<OpenDesignHtmlRasterizeResult> {
  const { openBrowser } = await import("@remotion/renderer");
  const prepared = prepareOpenDesignDeckForHtmlToPng(params.html);

  if (prepared.cleanup.hasSceneControllerResidue) {
    throw new Error("OPEN_DESIGN_CLEANUP_FAILED: quedaron residuos del controlador de escenas.");
  }

  const browser = await openBrowser("chrome", {
    logLevel: "error",
    chromiumOptions: { headless: true },
    forceDeviceScaleFactor: 1,
  });
  const images: RenderableSlideAsset[] = [];
  const outputPrefix = params.outputPrefix || `slides/${params.componentId}-html-slide`;

  try {
    for (const slide of prepared.slides) {
      const page = await (browser as any).newPage({
        context: undefined,
        logLevel: "error",
        indent: false,
        pageIndex: slide.index,
        onBrowserLog: undefined,
        onLog: undefined,
      });

      try {
        await page.setViewport({
          width: slide.width,
          height: slide.height,
          deviceScaleFactor: 1,
        });
        await page.goto({
          url: dataUrl(slide.html),
          timeout: 30000,
          options: {},
        });
        await page.evaluate(() =>
          document.fonts?.ready ? document.fonts.ready : Promise.resolve(),
        );
        await wait(250);

        const response = await page._client().send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          clip: {
            x: 0,
            y: 0,
            width: slide.width,
            height: slide.height,
            scale: 1,
          },
        }) as any;
        const base64 = response.value?.data || response.data;
        const png = Buffer.from(base64, "base64");
        const storagePath = `${outputPrefix}-${pad2(slide.index)}.png`;

        const { error } = await params.admin.storage
          .from(BUCKET)
          .upload(storagePath, png, {
            contentType: "image/png",
            upsert: true,
          });

        if (error) {
          throw new Error(`No se pudo guardar la slide ${slide.index}: ${error.message}`);
        }

        const {
          data: { publicUrl },
        } = params.admin.storage.from(BUCKET).getPublicUrl(storagePath);

        images.push({
          file_name: storagePath.split("/").pop(),
          slide_index: slide.index,
          storage_path: `${BUCKET}/${storagePath}`,
          public_url: publicUrl,
          content_type: "image/png",
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close({ silent: true });
  }

  return {
    images,
    cleanup: prepared.cleanup,
  };
}

export async function rasterizeStoredOpenDesignHtmlSlides(params: {
  admin: ServiceRoleClient;
  componentId: string;
  htmlStoragePath: string;
  deleteSourceHtml?: boolean;
}): Promise<OpenDesignHtmlRasterizeResult> {
  const storagePath = normalizeProductionAssetStoragePath(params.htmlStoragePath);
  const { data, error } = await params.admin.storage
    .from(BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new Error(`No se pudo descargar el HTML de slides: ${error?.message || "archivo no encontrado"}`);
  }

  const html = await data.text();
  const result = await rasterizeOpenDesignHtmlToStorage({
    admin: params.admin,
    componentId: params.componentId,
    html,
  });

  if (params.deleteSourceHtml ?? true) {
    const { error: removeError } = await params.admin.storage
      .from(BUCKET)
      .remove([storagePath]);

    if (removeError) {
      console.warn("[open-design-html-rasterizer] No se pudo eliminar el HTML fuente:", removeError.message);
    }
  }

  return result;
}
