"use client";

import type {
  MaterialAssets,
  MaterialComponent,
  ProductionStatus,
  StoryboardItem,
} from "../types/materials.types";
import { getGammaEmbedUrl as resolveGammaEmbedUrl } from "../lib/production-formatters";
import { useProductionAssetState } from "../hooks/useProductionAssetState";
import {
  getProductionRequirements,
  ProductionStoryboardViewer,
  PRODUCTION_THEME,
} from "./production-asset-ui";
import { ProductionAssetHeader } from "./ProductionAssetHeader";
import {
  ProductionAssetFinalVideoSection,
  ProductionAssetGammaSection,
  ProductionAssetPreviewModal,
  ProductionAssetPromptsSection,
  ProductionAssetScreencastSection,
} from "./ProductionAssetSections";

interface ProductionAssetCardProps {
  component: MaterialComponent;
  lessonTitle: string;
  onAssetChange?: (
    componentId: string,
    assets: Partial<MaterialAssets>,
  ) => void;
  onGeneratePrompts: (
    componentId: string,
    storyboard: StoryboardItem[],
  ) => Promise<string>;
  onSaveAssets: (
    componentId: string,
    assets: Partial<MaterialAssets>,
  ) => Promise<void>;
}

const VIDEO_SECTION_TYPES = new Set([
  "VIDEO_THEORETICAL",
  "VIDEO_DEMO",
  "VIDEO_GUIDE",
]);

export function ProductionAssetCard({
  component,
  lessonTitle,
  onAssetChange,
  onGeneratePrompts,
  onSaveAssets,
}: ProductionAssetCardProps) {
  const {
    bRollPrompts,
    copyFeedback,
    copyToClipboard,
    fileRef,
    finalVideoSource,
    finalVideoUrl,
    handleGeneratePrompts,
    handleSave,
    handleVideoUpload,
    isGenerating,
    isSaving,
    isUploading,
    openInGamma,
    screencastUrl,
    setFinalVideoSource,
    setBRollPrompts,
    setShowPreview,
    setUrlError,
    showPreview,
    slidesUrl,
    updateAsset,
    urlError,
    setFinalVideoUrl,
    setScreencastUrl,
    setSlidesUrl,
    isValidHttpUrl,
  } = useProductionAssetState({
    component,
    onAssetChange,
    onGeneratePrompts,
    onSaveAssets,
  });

  const productionStatus =
    (component.assets?.production_status as ProductionStatus) || "PENDING";
  const gammaEmbedUrl = resolveGammaEmbedUrl(slidesUrl);
  const { needsFinalVideo, needsScreencast, needsSlides, needsVideo } =
    getProductionRequirements(component.type);
  const requiresGamma = VIDEO_SECTION_TYPES.has(component.type);
  const requiresPrompts = VIDEO_SECTION_TYPES.has(component.type);

  return (
    <div
      className={`${PRODUCTION_THEME.card} ${
        productionStatus === "COMPLETED"
          ? PRODUCTION_THEME.cardBorder.completed
          : PRODUCTION_THEME.cardBorder.default
      }`}
    >
      <ProductionAssetHeader
        componentType={component.type}
        lessonTitle={lessonTitle}
        productionStatus={productionStatus}
        isSaving={isSaving}
        needsFinalVideo={needsFinalVideo}
        needsScreencast={needsScreencast}
        needsSlides={needsSlides}
        needsVideo={needsVideo}
        slidesUrl={slidesUrl}
        bRollPrompts={bRollPrompts}
        screencastUrl={screencastUrl}
        finalVideoUrl={finalVideoUrl}
        onSave={handleSave}
      />

      <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
        <div className="space-y-4">
          <ProductionStoryboardViewer
            content={component.content as Record<string, unknown>}
          />
        </div>

        <div className="space-y-6">
          {requiresGamma && (
            <ProductionAssetGammaSection
              component={component}
              copyFeedback={copyFeedback}
              copyToClipboard={copyToClipboard}
              gammaEmbedUrl={gammaEmbedUrl}
              onOpenInGamma={openInGamma}
              onOpenPreview={() => setShowPreview(true)}
              onSlidesUrlChange={(value) =>
                updateAsset("slides_url", value, setSlidesUrl)
              }
              slidesUrl={slidesUrl}
            />
          )}

          {requiresPrompts && (
            <ProductionAssetPromptsSection
              bRollPrompts={bRollPrompts}
              copyToClipboard={copyToClipboard}
              isGenerating={isGenerating}
              onGeneratePrompts={handleGeneratePrompts}
              onPromptsChange={(value) =>
                updateAsset("b_roll_prompts", value, setBRollPrompts)
              }
            />
          )}

          {(component.type === "DEMO_GUIDE" || component.type === "VIDEO_GUIDE") && (
            <ProductionAssetScreencastSection
              screencastUrl={screencastUrl}
              onScreencastUrlChange={(value) =>
                updateAsset("screencast_url", value, setScreencastUrl)
              }
            />
          )}

          {component.type.includes("VIDEO") && (
            <ProductionAssetFinalVideoSection
              fileRef={fileRef}
              finalVideoSource={finalVideoSource}
              finalVideoUrl={finalVideoUrl}
              isSaving={isSaving}
              isUploading={isUploading}
              isValidUrl={isValidHttpUrl}
              onClearVideo={() => {
                updateAsset("final_video_url", "", setFinalVideoUrl);
                setFinalVideoSource(null);
                setUrlError(null);
              }}
              onTriggerFilePicker={() => fileRef.current?.click()}
              onUploadVideo={handleVideoUpload}
              onVideoUrlChange={(value) => {
                updateAsset("final_video_url", value, setFinalVideoUrl);
                setFinalVideoSource(value ? "link" : null);
                if (urlError) {
                  setUrlError(null);
                }
              }}
              urlError={urlError}
            />
          )}
        </div>
      </div>

      {showPreview && gammaEmbedUrl && (
        <ProductionAssetPreviewModal
          gammaEmbedUrl={gammaEmbedUrl}
          onClose={() => setShowPreview(false)}
          slidesUrl={slidesUrl}
        />
      )}
    </div>
  );
}
