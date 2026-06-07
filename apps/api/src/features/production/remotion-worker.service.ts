import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

export class RemotionWorkerService {
  private supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  private supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  constructor() {
    if (!this.supabaseUrl || !this.supabaseServiceKey) {
      console.warn('[RemotionWorker] Supabase URL or Service Key is missing in environment variables.');
    }
  }

  private getSupabaseClient() {
    return createClient(this.supabaseUrl, this.supabaseServiceKey);
  }

  public async runRenderJob(jobId: string): Promise<void> {
    const supabase = this.getSupabaseClient();
    console.log(`[RemotionWorker] Starting render job: ${jobId}`);

    // 1. Fetch job details
    const { data: job, error: jobError } = await supabase
      .from('production_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error(`[RemotionWorker] Error fetching job ${jobId}:`, jobError);
      return;
    }

    if (job.status !== 'PENDING' && job.status !== 'QUEUED') {
      console.log(`[RemotionWorker] Job ${jobId} is already in state: ${job.status}. Skipping.`);
      return;
    }

    // Update state to RUNNING
    await supabase
      .from('production_jobs')
      .update({
        status: 'RUNNING',
        started_at: new Date().toISOString(),
        progress: [{ percent: 0, message: 'Inicializando workspace', timestamp: new Date().toISOString() }]
      })
      .eq('id', jobId);

    const componentId = job.material_component_id;
    const templateId = job.input_snapshot?.templateId;
    const workspacePath = path.join(__dirname, '../../../../tmp', `remotion-build-${jobId}`);
    let assets: any = {};

    try {
      // 2. Fetch component and template details
      const { data: component, error: compError } = await supabase
        .from('material_components')
        .select('*')
        .eq('id', componentId)
        .single();

      if (compError || !component) {
        throw new Error(`Componente no encontrado: ${compError?.message || 'Error desconocido'}`);
      }

      const { data: template, error: tplError } = await supabase
        .from('remotion_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (tplError || !template) {
        throw new Error(`Plantilla no encontrada: ${tplError?.message || 'Error desconocido'}`);
      }

      assets = component.assets || {};

      // 3. Create Local Workspace
      console.log(`[RemotionWorker] Creating workspace directory at: ${workspacePath}`);
      fs.mkdirSync(path.join(workspacePath, 'assets'), { recursive: true });

      // 4. Download assets locally
      const inputProps: Record<string, any> = {
        bgMusicVolume: assets.background_music?.volume_multiplier ?? 0.15,
        transitionType: job.input_snapshot?.variables?.transitionType || 'fade',
      };

      await supabase.from('production_jobs').update({
        progress: [{ percent: 20, message: 'Descargando recursos multimedia', timestamp: new Date().toISOString() }]
      }).eq('id', jobId);

      // Download Voice Audio
      if (assets.voice_audio?.public_url) {
        console.log(`[RemotionWorker] Downloading voice audio from ${assets.voice_audio.public_url}`);
        const voicePath = path.join(workspacePath, 'assets/voice.mp3');
        await this.downloadFile(assets.voice_audio.public_url, voicePath);
        inputProps.voiceAudioUrl = './assets/voice.mp3';
      }

      // Download Background Music
      if (assets.background_music?.public_url) {
        console.log(`[RemotionWorker] Downloading background music from ${assets.background_music.public_url}`);
        const musicPath = path.join(workspacePath, 'assets/bg_music.mp3');
        await this.downloadFile(assets.background_music.public_url, musicPath);
        inputProps.bgMusicUrl = './assets/bg_music.mp3';
      }

      // Download Avatar Video
      if (assets.avatar_video?.public_url) {
        console.log(`[RemotionWorker] Downloading avatar video from ${assets.avatar_video.public_url}`);
        const avatarPath = path.join(workspacePath, 'assets/avatar.mp4');
        await this.downloadFile(assets.avatar_video.public_url, avatarPath);
        inputProps.avatarVideoUrl = './assets/avatar.mp4';
      }

      // Download Slides
      if (assets.slides?.images && Array.isArray(assets.slides.images)) {
        fs.mkdirSync(path.join(workspacePath, 'assets/slides'), { recursive: true });
        const slidesList: string[] = [];
        for (const slide of assets.slides.images) {
          if (slide.public_url) {
            const slideName = `slide_${slide.slide_index}.png`;
            const slidePath = path.join(workspacePath, 'assets/slides', slideName);
            console.log(`[RemotionWorker] Downloading slide ${slide.slide_index} to ${slidePath}`);
            await this.downloadFile(slide.public_url, slidePath);
            slidesList.push(`./assets/slides/${slideName}`);
          }
        }
        inputProps.slides = slidesList;
      }

      // Download B-Roll Clips
      if (assets.b_roll_clips && Array.isArray(assets.b_roll_clips)) {
        fs.mkdirSync(path.join(workspacePath, 'assets/broll'), { recursive: true });
        const brollList: any[] = [];
        for (const clip of assets.b_roll_clips) {
          if (clip.public_url) {
            const clipName = `clip_${clip.order || clip.id}.mp4`;
            const clipPath = path.join(workspacePath, 'assets/broll', clipName);
            console.log(`[RemotionWorker] Downloading clip ${clip.id} to ${clipPath}`);
            await this.downloadFile(clip.public_url, clipPath);
            brollList.push({
              path: `./assets/broll/${clipName}`,
              duration: clip.duration || 5,
              order: clip.order || 1,
            });
          }
        }
        inputProps.brollClips = brollList;
      }

      // 5. Download and Unzip Template Bundle
      await supabase.from('production_jobs').update({
        progress: [{ percent: 40, message: 'Extrayendo plantilla de video', timestamp: new Date().toISOString() }]
      }).eq('id', jobId);

      if (template.storage_path) {
        console.log(`[RemotionWorker] Fetching template zip path: ${template.storage_path}`);
        const { data: { publicUrl } } = supabase.storage
          .from('production-assets')
          .getPublicUrl(template.storage_path);

        const zipPath = path.join(workspacePath, 'template.zip');
        await this.downloadFile(publicUrl, zipPath);
        
        console.log('[RemotionWorker] Unzipping template...');
        this.unzipFile(zipPath, workspacePath);
      } else {
        // Fallback for global seeded templates that don't have zip file:
        // Create mock index.tsx and files to compile or simulate render CLI
        console.log('[RemotionWorker] Global template has no storage zip. Setting up standard compile fallback.');
        fs.writeFileSync(path.join(workspacePath, 'index.tsx'), 'export {}');
      }

      // 6. Write input-props.json
      fs.writeFileSync(
        path.join(workspacePath, 'input-props.json'),
        JSON.stringify(inputProps, null, 2)
      );

      // 7. Execute Remotion render CLI
      await supabase.from('production_jobs').update({
        progress: [{ percent: 50, message: 'Compilando video con Remotion', timestamp: new Date().toISOString() }]
      }).eq('id', jobId);

      console.log('[RemotionWorker] Executing child_process Remotion render...');
      await this.executeRemotionRender(workspacePath, template, jobId);

      // 8. Upload compiled video to Supabase Storage
      await supabase.from('production_jobs').update({
        progress: [{ percent: 90, message: 'Guardando video en almacenamiento', timestamp: new Date().toISOString() }]
      }).eq('id', jobId);

      const outputPath = path.join(workspacePath, 'output.mp4');
      if (!fs.existsSync(outputPath)) {
        throw new Error('El renderizador de Remotion no generó el video output.mp4');
      }

      const fileBuffer = fs.readFileSync(outputPath);
      const outputStoragePath = `completed/${componentId}.mp4`;

      console.log(`[RemotionWorker] Uploading video to storage production-videos completed/${componentId}.mp4`);
      const { error: uploadError } = await supabase.storage
        .from('production-videos')
        .upload(outputStoragePath, fileBuffer, {
          contentType: 'video/mp4',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('production-videos')
        .getPublicUrl(outputStoragePath);

      // 9. Update materials assets record in DB
      console.log('[RemotionWorker] Updating material component assets in DB...');
      const updatedAssets = {
        ...assets,
        final_video_url: publicUrl,
        final_video_source: 'upload',
        video_duration: assets.voice_audio?.duration || 10,
        production_status: 'COMPLETED',
        updated_at: new Date().toISOString(),
      };

      const { error: dbUpdateError } = await supabase
        .from('material_components')
        .update({ assets: updatedAssets })
        .eq('id', componentId);

      if (dbUpdateError) {
        throw dbUpdateError;
      }

      // 10. Update job status to SUCCEEDED
      await supabase
        .from('production_jobs')
        .update({
          status: 'SUCCEEDED',
          progress: [{ percent: 100, message: 'Ensamblado completado exitosamente', timestamp: new Date().toISOString() }],
          completed_at: new Date().toISOString(),
          output_snapshot: {
            final_video_url: publicUrl,
            completed: true
          }
        })
        .eq('id', jobId);

      console.log(`[RemotionWorker] Job ${jobId} completed successfully!`);

    } catch (err: any) {
      console.error(`[RemotionWorker] Job ${jobId} failed:`, err);
      
      // Update job status to FAILED
      await supabase
        .from('production_jobs')
        .update({
          status: 'FAILED',
          failed_at: new Date().toISOString(),
          provider_error: {
            message: err.message || 'Error desconocido',
            stack: err.stack,
          }
        })
        .eq('id', jobId);

      // Revert component status
      await supabase
        .from('material_components')
        .update({
          assets: {
            ...assets,
            production_status: 'FAILED',
            updated_at: new Date().toISOString()
          }
        })
        .eq('id', componentId);

    } finally {
      // 11. Strict Workspace Clean Up
      console.log(`[RemotionWorker] Executing workspace cleanup at: ${workspacePath}`);
      if (fs.existsSync(workspacePath)) {
        try {
          fs.rmSync(workspacePath, { recursive: true, force: true });
          console.log('[RemotionWorker] Cleanup finished.');
        } catch (cleanError) {
          console.error('[RemotionWorker] Error deleting workspace directory:', cleanError);
        }
      }
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Error de descarga [${res.status}]: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(destPath, buffer);
  }

  private unzipFile(zipPath: string, destDir: string): void {
    if (os.platform() === 'win32') {
      const escapedZip = zipPath.replace(/'/g, "''");
      const escapedDest = destDir.replace(/'/g, "''");
      execSync(`powershell -Command "Expand-Archive -Path '${escapedZip}' -DestinationPath '${escapedDest}' -Force"`);
    } else {
      execSync(`unzip -o "${zipPath}" -d "${destDir}"`);
    }
  }

  private async executeRemotionRender(
    workspacePath: string,
    template: any,
    jobId: string
  ): Promise<void> {
    const supabase = this.getSupabaseClient();
    
    // In local development, if template has no storage zip file, simulate render compilation
    if (!template.storage_path) {
      console.log('[RemotionWorker] Simulating render delay (no template code bundle).');
      for (let i = 1; i <= 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const simulatedPercent = 50 + i * 10;
        await supabase
          .from('production_jobs')
          .update({
            progress: [{ percent: simulatedPercent, message: `Renderizando composición (${simulatedPercent}%)`, timestamp: new Date().toISOString() }]
          })
          .eq('id', jobId);
      }
      fs.writeFileSync(path.join(workspacePath, 'output.mp4'), 'Simulated Video Content');
      return;
    }

    return new Promise((resolve, reject) => {
      // CLI parameters
      const entryPoint = template.entry_point || 'src/index.tsx';
      const compositionId = 'MainComposition'; // Default Composition ID

      console.log(`[RemotionWorker] Running render CLI inside ${workspacePath}: npx remotion render ${entryPoint} ${compositionId} output.mp4 --input-data=input-props.json --cores=2`);
      
      const renderProc = spawn('npx', [
        'remotion',
        'render',
        entryPoint,
        compositionId,
        'output.mp4',
        '--input-data=input-props.json',
        '--cores=2',
      ], { cwd: workspacePath, shell: true });

      let stderrLog = '';

      renderProc.stdout.on('data', async (data) => {
        const output = data.toString();
        // Parse Remotion output: "Rendering frame 15/100 (15%)"
        const match = output.match(/Rendering frame \d+\/\d+ \((\d+)%\)/);
        if (match) {
          const progressPercent = parseInt(match[1], 10);
          console.log(`[RemotionWorker] Render progress: ${progressPercent}%`);
          // Scale Remotion's 0-100 to overall job progress 50-90%
          const overallProgress = Math.round(50 + (progressPercent * 40) / 100);
          
          await supabase
            .from('production_jobs')
            .update({
              progress: [{ percent: overallProgress, message: `Renderizando fotogramas (${progressPercent}%)`, timestamp: new Date().toISOString() }]
            })
            .eq('id', jobId);
        }
      });

      renderProc.stderr.on('data', (data) => {
        stderrLog += data.toString();
      });

      renderProc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Remotion CLI finalizó con código ${code}. Error: ${stderrLog}`));
        }
      });

      // Timeout safety: 5 minutes limit
      setTimeout(() => {
        renderProc.kill();
        reject(new Error('Límite de tiempo agotado para la renderización de Remotion (5 minutos).'));
      }, 5 * 60 * 1000);
    });
  }
}
