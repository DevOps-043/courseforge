'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Loader2, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { EngineSelect } from '@/components/ui/EngineSelect';
import { HelpTooltip } from '@/components/ui/HelpTooltip';
import { SoundEffectPreviewButton } from '@/components/production/SoundEffectPreviewButton';

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const CATEGORY_OPTIONS = [
    { value: 'TRANSITION', label: 'Transición' },
    { value: 'EMPHASIS', label: 'Énfasis' },
    { value: 'UI', label: 'Interfaz' },
    { value: 'IMPACT', label: 'Impacto' },
    { value: 'AMBIENCE', label: 'Ambiente' },
    { value: 'OTHER', label: 'Otro' },
] as const;

type SoundEffectCategory = (typeof CATEGORY_OPTIONS)[number]['value'];

type SoundEffect = {
    category: SoundEffectCategory;
    durationMilliseconds: number;
    id: string;
    licenseType: string;
    name: string;
    tags: string[];
};

function formatDuration(durationMilliseconds: number) {
    return `${(durationMilliseconds / 1000).toLocaleString('es-MX', {
        maximumFractionDigits: 1,
    })} s`;
}

function categoryLabel(category: SoundEffectCategory) {
    return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category;
}

export function SoundEffectLibraryPanel() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [effects, setEffects] = useState<SoundEffect[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isUploading, setIsUploading] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState('');
    const [category, setCategory] = useState<SoundEffectCategory>('TRANSITION');
    const [tags, setTags] = useState('');
    const [licenseType, setLicenseType] = useState('INTERNAL');
    const [licenseReference, setLicenseReference] = useState('');
    const [description, setDescription] = useState('');

    const loadEffects = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetch('/api/production/sound-effects?limit=50', { cache: 'no-store' });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'No se pudo cargar la biblioteca.');
            setEffects(body.data);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'No se pudo cargar la biblioteca.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadEffects();
    }, [loadEffects]);

    const selectFile = (selectedFile: File | null) => {
        if (!selectedFile) return;
        if (!selectedFile.name.toLowerCase().endsWith('.wav')) {
            toast.error('Esta prueba solo admite archivos WAV.');
            return;
        }
        if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
            toast.error('El audio no puede superar 25 MB.');
            return;
        }
        setFile(selectedFile);
        if (!name) setName(selectedFile.name.replace(/\.wav$/i, ''));
    };

    const uploadEffect = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!file) {
            toast.error('Selecciona un archivo WAV antes de subirlo.');
            return;
        }
        setIsUploading(true);
        try {
            const payload = new FormData();
            payload.set('file', file);
            payload.set('name', name);
            payload.set('category', category);
            payload.set('tags', tags);
            payload.set('licenseType', licenseType);
            payload.set('licenseReference', licenseReference);
            payload.set('description', description);
            const response = await fetch('/api/production/sound-effects', { method: 'POST', body: payload });
            const body = await response.json();
            if (!response.ok || !body.success) throw new Error(body.error || 'No se pudo subir el efecto.');
            toast.success(`“${body.data.name}” ya está disponible en el editor.`);
            setFile(null);
            setName('');
            setTags('');
            setLicenseReference('');
            setDescription('');
            if (fileInputRef.current) fileInputRef.current.value = '';
            await loadEffects();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'No se pudo subir el efecto.');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)]">
                <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-[var(--engine-accent)]/10 text-[var(--engine-accent)]">
                        <Upload size={19} />
                    </span>
                    <div>
                        <h2 className="font-semibold text-slate-900 dark:text-white">Subir efecto de sonido</h2>
                        <p className="mt-1 text-sm text-slate-600 dark:text-gray-500">Piloto: WAV RIFF, hasta 25 MB y 30 segundos.</p>
                    </div>
                </div>

                <form onSubmit={uploadEffect} className="mt-5 space-y-4">
                    <label className="block">
                        <FieldLabel hint="Selecciona el archivo fuente del efecto. En esta fase piloto solo se aceptan WAV RIFF de hasta 25 MB y 30 segundos.">Archivo WAV</FieldLabel>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="audio/wav,.wav"
                            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
                            className="mt-1 block w-full rounded-lg border border-dashed border-[var(--engine-muted)]/30 bg-[var(--engine-canvas)] px-3 py-3 text-sm text-slate-700 dark:text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-[var(--engine-accent)]/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--engine-accent)]"
                        />
                        {file && <span className="mt-1 block truncate text-xs text-slate-600 dark:text-gray-400">{file.name}</span>}
                    </label>

                    <label className="block">
                        <FieldLabel hint="Es el nombre que verás al buscar y añadir este efecto desde el editor.">Nombre</FieldLabel>
                        <input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--engine-muted)]/20 bg-[var(--engine-canvas)] px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[var(--engine-accent)] focus:outline-none" />
                    </label>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <FieldLabel hint="Agrupa el efecto para encontrarlo rápidamente en el panel SFX del editor.">Categoría</FieldLabel>
                            <div className="mt-1"><EngineSelect value={category} onValueChange={(value) => setCategory(value as SoundEffectCategory)} options={CATEGORY_OPTIONS} /></div>
                        </label>
                        <label className="block">
                            <FieldLabel tooltipAlign="end" hint="Indica el tipo de permiso de uso del audio, por ejemplo INTERNAL o una licencia comercial.">Licencia</FieldLabel>
                            <input required maxLength={80} value={licenseType} onChange={(event) => setLicenseType(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--engine-muted)]/20 bg-[var(--engine-canvas)] px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[var(--engine-accent)] focus:outline-none" />
                        </label>
                    </div>

                    <label className="block">
                        <FieldLabel hint="Añade palabras clave separadas por coma, como whoosh, rápido o limpio, para facilitar la búsqueda.">Etiquetas</FieldLabel>
                        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="whoosh, rápido, limpio" className="mt-1 w-full rounded-lg border border-[var(--engine-muted)]/20 bg-[var(--engine-canvas)] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 dark:text-white dark:placeholder:text-gray-600 focus:border-[var(--engine-accent)] focus:outline-none" />
                    </label>
                    <label className="block">
                        <FieldLabel hint="Registra la URL, contrato, factura o identificador que demuestra la licencia del audio.">Referencia de licencia (opcional)</FieldLabel>
                        <input maxLength={1000} value={licenseReference} onChange={(event) => setLicenseReference(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--engine-muted)]/20 bg-[var(--engine-canvas)] px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[var(--engine-accent)] focus:outline-none" />
                    </label>
                    <label className="block">
                        <FieldLabel hint="Describe cuándo usar este efecto o qué sensación produce. Ayuda a otros editores a elegirlo bien.">Descripción (opcional)</FieldLabel>
                        <textarea maxLength={1000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full resize-y rounded-lg border border-[var(--engine-muted)]/20 bg-[var(--engine-canvas)] px-3 py-2 text-sm text-slate-900 dark:text-white focus:border-[var(--engine-accent)] focus:outline-none" />
                    </label>
                    <button type="submit" disabled={isUploading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--engine-accent)] px-4 py-3 text-sm font-bold text-[var(--engine-primary)] disabled:cursor-not-allowed disabled:opacity-60">
                        {isUploading ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}
                        Subir y publicar en la biblioteca
                    </button>
                </form>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--engine-muted)]/10 p-5">
                    <div>
                        <h2 className="font-semibold text-slate-900 dark:text-white">Efectos disponibles</h2>
                        <p className="mt-1 text-sm text-slate-600 dark:text-gray-500">Se mostrarán en la pestaña SFX del editor de composición.</p>
                    </div>
                    <button type="button" onClick={() => void loadEffects()} disabled={isLoading} className="rounded-lg p-2 text-slate-600 hover:bg-[var(--engine-surface-hover)] hover:text-slate-900 dark:text-gray-400 dark:hover:text-white disabled:opacity-50" aria-label="Actualizar efectos">
                        <RefreshCw size={17} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
                <div className="divide-y divide-[var(--engine-muted)]/10">
                    {isLoading ? (
                        <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-600 dark:text-gray-500"><Loader2 size={16} className="animate-spin" /> Cargando efectos…</div>
                    ) : effects.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 p-12 text-center text-slate-600 dark:text-gray-500"><AudioLines size={28} /><p className="text-sm">Aún no hay efectos de sonido cargados.</p></div>
                    ) : effects.map((effect) => (
                        <article key={effect.id} className="flex items-start justify-between gap-4 p-4">
                            <div className="min-w-0">
                                <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{effect.name}</h3>
                                <p className="mt-1 text-xs text-slate-600 dark:text-gray-500">{categoryLabel(effect.category)} · {formatDuration(effect.durationMilliseconds)} · {effect.licenseType}</p>
                                {effect.tags.length > 0 && <p className="mt-2 truncate text-xs text-[var(--engine-accent)]">{effect.tags.join(' · ')}</p>}
                            </div>
                            <div className="flex flex-none items-center gap-2">
                                <SoundEffectPreviewButton soundEffectId={effect.id} />
                                <span className="rounded border border-[var(--engine-accent)]/20 bg-[var(--engine-accent)]/10 px-2 py-1 text-[10px] font-bold uppercase text-[var(--engine-accent)]">Listo</span>
                            </div>
                        </article>
                    ))}
                </div>
            </section>
        </div>
    );
}

function FieldLabel({
    children,
    hint,
    tooltipAlign = 'start',
}: {
    children: React.ReactNode;
    hint: string;
    tooltipAlign?: 'end' | 'start';
}) {
    return (
        <span className="flex items-center gap-1 text-xs font-medium uppercase text-slate-600 dark:text-gray-500">
            {children}
            <HelpTooltip align={tooltipAlign} ariaLabel={`Ver ayuda de ${typeof children === 'string' ? children : 'este campo'}`}>{hint}</HelpTooltip>
        </span>
    );
}
