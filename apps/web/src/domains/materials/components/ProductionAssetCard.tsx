"use client";

import { useEffect, useMemo, useState } from "react";
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
  ProductionAssetPreviewModal,
  ProductionAssetPromptsSection,
  ProductionAssetScreencastSection,
} from "./ProductionAssetSections";
import {
  VoiceAudioSection,
  BackgroundMusicSection,
  SofliaHtmlSlidesSection,
  BRollClipsSection,
  AvatarVideoSection,
} from "./ProductionStructuredAssetSections";
import {
  getSlideTemplatePackagesAction,
  type SlideTemplateLibraryItem,
} from "@/domains/production/slides/slide-template-library.actions";
import { ProductionMediaPreview } from "./ProductionMediaPreview";

interface ProductionAssetCardProps {
  component: MaterialComponent;
  hideGeneratedAssetTools?: boolean;
  hideStoryboard?: boolean;
  lessonTitle: string;
  onAssetChange?: (
    componentId: string,
    assets: Partial<MaterialAssets>,
  ) => Promise<void> | void;
  onGeneratePrompts: (
    componentId: string,
    storyboard: StoryboardItem[],
  ) => Promise<string>;
  slideTemplatesHref?: string;
  slideTemplateStudioHref?: string;
  sofliaSlidesHref?: string;
}

const VIDEO_SECTION_TYPES = new Set([
  "VIDEO_THEORETICAL",
  "VIDEO_DEMO",
  "VIDEO_GUIDE",
]);

let slideTemplateLibraryCache: SlideTemplateLibraryItem[] | null = null;
let slideTemplateLibraryRequest: Promise<SlideTemplateLibraryItem[]> | null = null;

async function loadSlideTemplateLibrary() {
  if (slideTemplateLibraryCache) {
    return slideTemplateLibraryCache;
  }

  slideTemplateLibraryRequest ||= getSlideTemplatePackagesAction()
    .then((response) => {
      if (!response.success) {
        throw new Error(response.error || "No se pudieron cargar las plantillas de slides");
      }
      slideTemplateLibraryCache = response.slideTemplates || [];
      return slideTemplateLibraryCache;
    })
    .catch((error) => {
      slideTemplateLibraryRequest = null;
      throw error;
    });

  return slideTemplateLibraryRequest;
}

export function ProductionAssetCard({
  component,
  hideGeneratedAssetTools = false,
  hideStoryboard = false,
  lessonTitle,
  onAssetChange,
  onGeneratePrompts,
  slideTemplatesHref = "/admin/slides/templates",
  slideTemplateStudioHref = "/admin/slides/templates",
  sofliaSlidesHref,
}: ProductionAssetCardProps) {
  const {
    bRollPrompts,
    copyToClipboard,
    finalVideoUrl,
    handleGeneratePrompts,
    isGenerating,
    screencastUrl,
    setBRollPrompts,
    setShowPreview,
    showPreview,
    slidesUrl,
    updateAsset,
    setScreencastUrl,

    // Structured states & loaders
    voiceAudio,
    voiceClips,
    voiceUploadError,
    voiceUploadFileName,
    voiceUploadStatus,
    backgroundMusic,
    bRollClips,
    avatarClips,
    avatarGenerationMode,
    avatarVideo,
    slidesAsset,
    isUploadingVoice,
    isUploadingMusic,
    isUploadingBroll,
    isUploadingAvatar,
    isUploadingSlides,
    isGeneratingSofliaSlides,
    isPreparingAnimatedDeck,

    // Refs
    voiceFileRef,
    musicFileRef,
    brollFileRef,
    avatarFileRef,
    slidesFileRef,

    // Heygen sync
    heygenAspectRatio,
    heygenAvatarPresets,
    heygenCaptionEnabled,
    heygenEngine,
    heygenJobId,
    heygenJobStatus,
    heygenProviderJobId,
    heygenResolution,
    isSyncingHeygen,
    isLoadingHeygenPresets,
    selectedHeygenAvatarPresetId,
    selectedHeygenVoicePresetId,
    setHeygenAspectRatio,
    setHeygenCaptionEnabled,
    setHeygenEngine,
    setHeygenResolution,
    setSelectedHeygenAvatarPresetId,
    setSelectedHeygenVoicePresetId,
    heygenVoicePresets,
    heygenSyncProgress,
    heygenError,
    loadHeygenPresets,
    handleHeygenStatusCheck,

    // Sub-handlers
    handleVoiceUpload,
    handleMusicUpload,
    handleSofliaEngineSlideGeneration,
    prepareUploadedHtmlSlidesAsAnimatedDeck,
    handleSlidesZipUpload,
    handleBrollClipUpload,
    removeBrollClip,
    clearVoiceAudio,
    clearBackgroundMusic,
    clearAvatarVideo,
    removeAvatarClip,
    clearSlidesAsset,
    handleAvatarUpload,

    // Artlist integration
    isSearchingArtlist,
    isImportingArtlist,
    artlistSearchResults,
    searchArtlist,
    importArtlistAsset,
    setArtlistSearchResults,

    // Google Drive integration
    isSearchingGoogleDrive,
    isImportingGoogleDrive,
    googleDriveSearchResults,
    searchGoogleDrive,
    importGoogleDriveAsset,
    setGoogleDriveSearchResults,
  } = useProductionAssetState({
    component,
    onAssetChange,
    onGeneratePrompts,
  });

  const productionStatus =
    (component.assets?.production_status as ProductionStatus) || "PENDING";
  const gammaEmbedUrl = resolveGammaEmbedUrl(slidesUrl);
  const { needsFinalVideo, needsScreencast, needsSlides, needsVideo } =
    getProductionRequirements(component.type);
  const requiresPrompts = VIDEO_SECTION_TYPES.has(component.type);
  const [slideTemplates, setSlideTemplates] = useState<SlideTemplateLibraryItem[]>([]);
  const [isLoadingSlideTemplates, setIsLoadingSlideTemplates] = useState(false);
  const [selectedSlideTemplateRunId, setSelectedSlideTemplateRunId] = useState<string | null>(
    slidesAsset?.selected_slide_template_run_id || null,
  );
  const availableSlideTemplates = useMemo(
    () => slideTemplates.filter((template) => template.status === "PACKAGED" && template.bundle_storage_path),
    [slideTemplates],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadSlideTemplates() {
      setIsLoadingSlideTemplates(true);
      try {
        const templates = await loadSlideTemplateLibrary();
        if (isMounted) {
          setSlideTemplates(templates);
        }
      } catch (error) {
        console.warn("Could not load slide templates:", error);
      } finally {
        if (isMounted) {
          setIsLoadingSlideTemplates(false);
        }
      }
    }

    void loadSlideTemplates();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!slidesAsset?.selected_slide_template_run_id) return;
    setSelectedSlideTemplateRunId((current) =>
      current || slidesAsset.selected_slide_template_run_id || null,
    );
  }, [slidesAsset?.selected_slide_template_run_id]);

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
        needsFinalVideo={needsFinalVideo}
        needsScreencast={needsScreencast}
        needsSlides={needsSlides}
        needsVideo={needsVideo}
        slidesUrl={slidesUrl}
        bRollPrompts={bRollPrompts}
        screencastUrl={screencastUrl}
        finalVideoUrl={finalVideoUrl}
        voiceAudio={voiceAudio}
        voiceClips={voiceClips}
        backgroundMusic={backgroundMusic}
        bRollClips={bRollClips}
        avatarVideo={avatarVideo}
      />

      <div className={`grid grid-cols-1 gap-6 p-6 ${hideStoryboard ? "" : "md:grid-cols-2"}`}>
        {!hideStoryboard && (
          <div className="space-y-4">
            <ProductionStoryboardViewer
              content={component.content as Record<string, unknown>}
            />
          </div>
        )}

        <div className="space-y-6">
          {/* Structured Asset Form for Video Components */}
          {component.type.includes("VIDEO") && (
            <div className="space-y-4 border-b pb-4 dark:border-[var(--engine-muted)]/10">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Recursos del Video
              </h4>
              
              <VoiceAudioSection
                voiceAudio={voiceAudio}
                voiceClips={voiceClips}
                uploadError={voiceUploadError}
                uploadFileName={voiceUploadFileName}
                uploadStatus={voiceUploadStatus}
                isUploading={isUploadingVoice}
                fileRef={voiceFileRef}
                onUpload={handleVoiceUpload}
                onClear={clearVoiceAudio}
                isSearchingDrive={isSearchingGoogleDrive}
                isImportingDrive={isImportingGoogleDrive}
                driveSearchResults={googleDriveSearchResults}
                searchDrive={searchGoogleDrive}
                importDriveAsset={importGoogleDriveAsset}
                clearDriveSearchResults={() => setGoogleDriveSearchResults([])}
              />
              
              <BackgroundMusicSection
                backgroundMusic={backgroundMusic}
                isUploading={isUploadingMusic}
                fileRef={musicFileRef}
                onUpload={handleMusicUpload}
                onClear={clearBackgroundMusic}
                isSearchingArtlist={isSearchingArtlist}
                isImportingArtlist={isImportingArtlist}
                artlistSearchResults={artlistSearchResults}
                searchArtlist={searchArtlist}
                importArtlistAsset={importArtlistAsset}
                clearArtlistSearchResults={() => setArtlistSearchResults([])}
                isSearchingDrive={isSearchingGoogleDrive}
                isImportingDrive={isImportingGoogleDrive}
                driveSearchResults={googleDriveSearchResults}
                searchDrive={searchGoogleDrive}
                importDriveAsset={importGoogleDriveAsset}
                clearDriveSearchResults={() => setGoogleDriveSearchResults([])}
              />
              
              <SofliaHtmlSlidesSection
                slides={slidesAsset}
                isGeneratingSofliaSlides={isGeneratingSofliaSlides}
                isUploading={isUploadingSlides}
                isPreparingAnimatedDeck={isPreparingAnimatedDeck}
                isLoadingSlideTemplates={isLoadingSlideTemplates}
                selectedSlideTemplateRunId={selectedSlideTemplateRunId}
                showSofliaGeneration={!hideGeneratedAssetTools}
                slideTemplates={availableSlideTemplates}
                slideTemplatesHref={slideTemplatesHref}
                slideTemplateStudioHref={slideTemplateStudioHref}
                sofliaSlidesHref={sofliaSlidesHref}
                fileRef={slidesFileRef}
                onGenerateSofliaSlides={handleSofliaEngineSlideGeneration}
                onSelectSlideTemplate={setSelectedSlideTemplateRunId}
                onUpload={handleSlidesZipUpload}
                onPrepareAnimatedDeck={prepareUploadedHtmlSlidesAsAnimatedDeck}
                onClear={clearSlidesAsset}
                isSearchingDrive={isSearchingGoogleDrive}
                isImportingDrive={isImportingGoogleDrive}
                driveSearchResults={googleDriveSearchResults}
                searchDrive={searchGoogleDrive}
                importDriveAsset={importGoogleDriveAsset}
                clearDriveSearchResults={() => setGoogleDriveSearchResults([])}
              />
              
              <BRollClipsSection
                clips={bRollClips}
                isUploading={isUploadingBroll}
                fileRef={brollFileRef}
                onUpload={handleBrollClipUpload}
                onDelete={removeBrollClip}
                isSearchingArtlist={isSearchingArtlist}
                isImportingArtlist={isImportingArtlist}
                artlistSearchResults={artlistSearchResults}
                searchArtlist={searchArtlist}
                importArtlistAsset={importArtlistAsset}
                clearArtlistSearchResults={() => setArtlistSearchResults([])}
                bRollPrompts={bRollPrompts}
                isSearchingDrive={isSearchingGoogleDrive}
                isImportingDrive={isImportingGoogleDrive}
                driveSearchResults={googleDriveSearchResults}
                searchDrive={searchGoogleDrive}
                importDriveAsset={importGoogleDriveAsset}
                clearDriveSearchResults={() => setGoogleDriveSearchResults([])}
              />
              
              <AvatarVideoSection
                componentId={component.id}
                avatarClips={avatarClips}
                avatarGenerationMode={avatarGenerationMode}
                avatarVideo={avatarVideo}
                aspectRatio={heygenAspectRatio}
                avatarPresets={heygenAvatarPresets}
                captionEnabled={heygenCaptionEnabled}
                engine={heygenEngine}
                jobId={heygenJobId}
                jobStatus={heygenJobStatus}
                providerJobId={heygenProviderJobId}
                resolution={heygenResolution}
                isUploading={isUploadingAvatar}
                isSyncing={isSyncingHeygen}
                isLoadingPresets={isLoadingHeygenPresets}
                selectedAvatarPresetId={selectedHeygenAvatarPresetId}
                selectedVoicePresetId={selectedHeygenVoicePresetId}
                syncProgress={heygenSyncProgress}
                syncError={heygenError}
                voicePresets={heygenVoicePresets}
                fileRef={avatarFileRef}
                onUpload={handleAvatarUpload}
                onHeygenStatusCheck={handleHeygenStatusCheck}
                onRefreshPresets={loadHeygenPresets}
                onClear={clearAvatarVideo}
                onDeleteClip={removeAvatarClip}
                onAspectRatioChange={setHeygenAspectRatio}
                onAvatarPresetChange={setSelectedHeygenAvatarPresetId}
                onCaptionEnabledChange={setHeygenCaptionEnabled}
                onEngineChange={setHeygenEngine}
                onResolutionChange={setHeygenResolution}
                onVoicePresetChange={setSelectedHeygenVoicePresetId}
                isSearchingDrive={isSearchingGoogleDrive}
                isImportingDrive={isImportingGoogleDrive}
                driveSearchResults={googleDriveSearchResults}
                searchDrive={searchGoogleDrive}
                importDriveAsset={importGoogleDriveAsset}
                clearDriveSearchResults={() => setGoogleDriveSearchResults([])}
              />
            </div>
          )}

          {requiresPrompts && !hideGeneratedAssetTools && (
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

          {finalVideoUrl ? (
            <section className="space-y-3">
              <h4 className={PRODUCTION_THEME.sectionTitle}>VIDEO FINAL</h4>
              <ProductionMediaPreview
                durationSeconds={component.assets?.video_duration}
                kind="video"
                label={component.assets?.final_video_file_name || "Video final de producción"}
                src={finalVideoUrl}
              />
            </section>
          ) : null}
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
