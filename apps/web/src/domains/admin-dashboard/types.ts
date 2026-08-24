export interface DashboardStat {
  label: string;
  value: number;
  hint: string;
  tone: "neutral" | "positive" | "attention";
}

export interface PipelineBucket {
  key: "DRAFT" | "GENERATING" | "REVIEW" | "APPROVED" | "REJECTED";
  label: string;
  count: number;
  colorVar: string;
}

export interface CreationTrendPoint {
  date: string;
  label: string;
  count: number;
}

export type AttentionItemType = "ESCALATED" | "PUBLICATION_REJECTED" | "SCORM_FAILED";

export interface AttentionItem {
  type: AttentionItemType;
  id: string;
  title: string;
  timestamp: string;
  href: string;
}

export type ProductionStatusTone = "active" | "done" | "failed";

export interface ProductionStatus {
  label: string;
  tone: ProductionStatusTone;
}

export interface RecentArtifactItem {
  id: string;
  title: string;
  state: string;
  productionComplete: boolean;
  updatedAt: string;
  ownerName: string | null;
  href: string;
  productionStatus: ProductionStatus | null;
}

export interface AdminDashboardData {
  stats: {
    activeUsers: number;
    totalArtifacts: number;
    artifactsCreatedThisWeek: number;
    inProgressCount: number;
    activeRenderCount: number;
    escalatedCount: number;
    publicationReadyCount: number;
    publicationSentCount: number;
  };
  pipelineDistribution: PipelineBucket[];
  creationTrend: CreationTrendPoint[];
  attentionItems: AttentionItem[];
  recentArtifacts: RecentArtifactItem[];
}
