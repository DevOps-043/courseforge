import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";

export interface ArtlistTrack {
  id: string;
  title: string;
  artist: string;
  genre: string;
  mood: string;
  public_url: string;
  duration_seconds: number;
}

export interface ArtlistVideo {
  id: string;
  title: string;
  tags: string[];
  public_url: string;
  duration_seconds: number;
  thumbnail_url?: string;
}

// ---------------------------------------------------------
// HIGH-QUALITY MOCK DATA (Mixkit & SoundHelix stable assets)
// ---------------------------------------------------------
const MOCK_MUSIC_CATALOG: ArtlistTrack[] = [
  {
    id: "artlist-song-1",
    title: "Summer Breeze",
    artist: "Acoustic Vibes",
    genre: "Acoustic",
    mood: "Happy",
    public_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    duration_seconds: 372,
  },
  {
    id: "artlist-song-2",
    title: "Synthwave Dreams",
    artist: "Cyber Runner",
    genre: "Synthwave",
    mood: "Energetic",
    public_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    duration_seconds: 425,
  },
  {
    id: "artlist-song-3",
    title: "Cinematic Journey",
    artist: "Orchestra Modern",
    genre: "Cinematic",
    mood: "Inspiring",
    public_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    duration_seconds: 302,
  },
  {
    id: "artlist-song-4",
    title: "Lo-Fi Study Session",
    artist: "Chill Beats",
    genre: "Lo-Fi",
    mood: "Relaxed",
    public_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3",
    duration_seconds: 318,
  },
  {
    id: "artlist-song-5",
    title: "Corporate Innovation",
    artist: "Tech Ensemble",
    genre: "Corporate",
    mood: "Professional",
    public_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    duration_seconds: 362,
  }
];

const MOCK_VIDEO_CATALOG: ArtlistVideo[] = [
  {
    id: "artlist-video-1",
    title: "Hands of a programmer typing",
    tags: ["workspace", "coding", "developer", "typing", "keyboard", "code"],
    public_url: "https://assets.mixkit.co/videos/preview/mixkit-hands-of-a-programmer-typing-on-a-keyboard-40040-large.mp4",
    duration_seconds: 9,
  },
  {
    id: "artlist-video-2",
    title: "Business meeting in office",
    tags: ["meeting", "office", "collaboration", "business", "workspace", "team"],
    public_url: "https://assets.mixkit.co/videos/preview/mixkit-business-people-meeting-in-a-modern-office-42774-large.mp4",
    duration_seconds: 14,
  },
  {
    id: "artlist-video-3",
    title: "Digital network nodes",
    tags: ["ai", "artificial intelligence", "tech", "network", "visualization", "nodes"],
    public_url: "https://assets.mixkit.co/videos/preview/mixkit-abstract-glowing-digital-network-nodes-42289-large.mp4",
    duration_seconds: 8,
  },
  {
    id: "artlist-video-4",
    title: "Designer working on tablet",
    tags: ["design", "tablet", "drawing", "writing", "office", "sketching"],
    public_url: "https://assets.mixkit.co/videos/preview/mixkit-designer-working-on-a-graphic-tablet-40436-large.mp4",
    duration_seconds: 10,
  },
  {
    id: "artlist-video-5",
    title: "Developer working at coffee shop",
    tags: ["workspace", "laptop", "casual", "typing", "coffee", "coding"],
    public_url: "https://assets.mixkit.co/videos/preview/mixkit-woman-working-on-a-laptop-in-a-coffee-shop-40294-large.mp4",
    duration_seconds: 12,
  }
];

export class ArtlistService {
  private clientId: string | null;
  private clientSecret: string | null;

  constructor() {
    this.clientId = process.env.ARTLIST_CLIENT_ID || null;
    this.clientSecret = process.env.ARTLIST_CLIENT_SECRET || null;
  }

  // Check if we use real API credentials
  private isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  /**
   * Search Artlist Catalog (Music or Video)
   */
  async search(query: string, type: "music" | "video"): Promise<any[]> {
    const cleanQuery = query.trim().toLowerCase();

    if (this.isConfigured()) {
      try {
        // Real Enterprise API search logic here
        const token = await this.getAccessToken();
        const response = await fetch(`https://api.artlist.io/v1/${type}/search?q=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          return data.results || [];
        }
      } catch (err) {
        console.error("[ArtlistService] Real API search failed, falling back to mock:", err);
      }
    }

    // Falls back to high-quality Mock Catalog
    if (type === "music") {
      if (!cleanQuery) return MOCK_MUSIC_CATALOG;
      return MOCK_MUSIC_CATALOG.filter(
        (track) =>
          track.title.toLowerCase().includes(cleanQuery) ||
          track.artist.toLowerCase().includes(cleanQuery) ||
          track.genre.toLowerCase().includes(cleanQuery) ||
          track.mood.toLowerCase().includes(cleanQuery)
      );
    } else {
      if (!cleanQuery) return MOCK_VIDEO_CATALOG;
      return MOCK_VIDEO_CATALOG.filter(
        (video) =>
          video.title.toLowerCase().includes(cleanQuery) ||
          video.tags.some((tag) => tag.toLowerCase().includes(cleanQuery))
      );
    }
  }

  /**
   * Import asset direct server-to-server stream from Artlist to Supabase Storage
   */
  async importAsset(
    assetId: string,
    type: "music" | "video",
    componentId: string
  ): Promise<{ publicUrl: string; storagePath: string; duration: number }> {
    let sourceUrl = "";
    let duration = 0;
    let title = "";

    // Resolve URL from mock data first
    if (type === "music") {
      const track = MOCK_MUSIC_CATALOG.find((t) => t.id === assetId);
      if (track) {
        sourceUrl = track.public_url;
        duration = track.duration_seconds;
        title = track.title;
      }
    } else {
      const video = MOCK_VIDEO_CATALOG.find((v) => v.id === assetId);
      if (video) {
        sourceUrl = video.public_url;
        duration = video.duration_seconds;
        title = video.title;
      }
    }

    // If not found in mock and Enterprise API is configured, search real catalog
    if (!sourceUrl && this.isConfigured()) {
      try {
        const token = await this.getAccessToken();
        const response = await fetch(`https://api.artlist.io/v1/${type}/${assetId}/download`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          sourceUrl = data.download_url;
          duration = data.duration || 0;
        }
      } catch (err) {
        console.error("[ArtlistService] Real API import failed:", err);
      }
    }

    if (!sourceUrl) {
      throw new Error(`No se pudo resolver el recurso de Artlist para el ID: ${assetId}`);
    }

    // 1. Fetch file from source in streaming
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo desde el CDN de Artlist: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Upload to Supabase Storage
    const admin = getServiceRoleClient();
    const fileExt = type === "music" ? "mp3" : "mp4";
    const subfolder = type === "music" ? "music" : "broll";
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const storagePath = `${subfolder}/${componentId}-${cleanTitle}.${fileExt}`;

    const { error: uploadError } = await admin.storage
      .from("production-assets")
      .upload(storagePath, buffer, {
        contentType: type === "music" ? "audio/mp3" : "video/mp4",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Error subiendo el recurso al Storage de Supabase: ${uploadError.message}`);
    }

    // 3. Resolve public URL
    const { data: { publicUrl } } = admin.storage
      .from("production-assets")
      .getPublicUrl(storagePath);

    return {
      publicUrl,
      storagePath: `production-assets/${storagePath}`,
      duration,
    };
  }

  /**
   * OAuth credentials validation helper
   */
  private async getAccessToken(): Promise<string> {
    const response = await fetch("https://id.artlist.io/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      throw new Error("No se pudo obtener el Access Token de Artlist");
    }

    const data = await response.json();
    return data.access_token;
  }
}
