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
  ProductionAssetPreviewModal,
  ProductionAssetPromptsSection,
  ProductionAssetScreencastSection,
} from "./ProductionAssetSections";
import {
  VoiceAudioSection,
  BackgroundMusicSection,
  OpenDesignSlidesSection,
  BRollClipsSection,
  AvatarVideoSection,
} from "./ProductionStructuredAssetSections";

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
    copyToClipboard,
    finalVideoUrl,
    handleGeneratePrompts,
    handleSave,
    isGenerating,
    isSaving,
    screencastUrl,
    setBRollPrompts,
    setShowPreview,
    showPreview,
    slidesUrl,
    updateAsset,
    setScreencastUrl,

    // Structured states & loaders
    voiceAudio,
    backgroundMusic,
    bRollClips,
    avatarVideo,
    slidesAsset,
    isUploadingVoice,
    isUploadingMusic,
    isUploadingBroll,
    isUploadingAvatar,
    isUploadingSlides,
    isExportingOpenDesign,

    // Refs
    voiceFileRef,
    musicFileRef,
    brollFileRef,
    avatarFileRef,
    slidesFileRef,

    // Heygen sync
    isSyncingHeygen,
    heygenSyncProgress,
    heygenError,
    handleHeygenSync,

    // Sub-handlers
    handleVoiceUpload,
    handleMusicUpload,
    handleVolumeChange,
    handleOpenDesignExport,
    handleSlidesZipUpload,
    handleBrollClipUpload,
    removeBrollClip,
    clearVoiceAudio,
    clearBackgroundMusic,
    clearAvatarVideo,
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
    onSaveAssets,
  });

  const productionStatus =
    (component.assets?.production_status as ProductionStatus) || "PENDING";
  const gammaEmbedUrl = resolveGammaEmbedUrl(slidesUrl);
  const { needsFinalVideo, needsScreencast, needsSlides, needsVideo } =
    getProductionRequirements(component.type);
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
        voiceAudio={voiceAudio}
        backgroundMusic={backgroundMusic}
        bRollClips={bRollClips}
        avatarVideo={avatarVideo}
        onSave={handleSave}
      />

      <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
        <div className="space-y-4">
          <ProductionStoryboardViewer
            content={component.content as Record<string, unknown>}
          />
        </div>

        <div className="space-y-6">
          {/* Structured Asset Form for Video Components */}
          {component.type.includes("VIDEO") && (
            <div className="space-y-4 border-b pb-4 dark:border-[#6C757D]/10">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Recursos del Video
              </h4>
              
              <VoiceAudioSection
                voiceAudio={voiceAudio}
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
                onVolumeChange={handleVolumeChange}
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
              
              <OpenDesignSlidesSection
                slides={slidesAsset}
                isExporting={isExportingOpenDesign}
                isUploading={isUploadingSlides}
                fileRef={slidesFileRef}
                onExport={handleOpenDesignExport}
                onUpload={handleSlidesZipUpload}
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
                avatarVideo={avatarVideo}
                isUploading={isUploadingAvatar}
                isSyncing={isSyncingHeygen}
                syncProgress={heygenSyncProgress}
                syncError={heygenError}
                fileRef={avatarFileRef}
                onUpload={handleAvatarUpload}
                onHeygenSync={handleHeygenSync}
                onClear={clearAvatarVideo}
                isSearchingDrive={isSearchingGoogleDrive}
                isImportingDrive={isImportingGoogleDrive}
                driveSearchResults={googleDriveSearchResults}
                searchDrive={searchGoogleDrive}
                importDriveAsset={importGoogleDriveAsset}
                clearDriveSearchResults={() => setGoogleDriveSearchResults([])}
              />
            </div>
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
