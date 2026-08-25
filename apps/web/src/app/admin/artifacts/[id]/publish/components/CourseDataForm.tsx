'use client';

import { useState, useRef } from 'react';
import { BookOpen, Image as ImageIcon, Loader2, Upload } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { uploadWithSignedUrl } from '@/lib/storage-upload';
import { toast } from 'sonner';
import {
    formatThumbnailUrl,
} from '@/domains/publication/lib/publication-client';
import type { PublicationCourseData } from '@/domains/publication/types/publication.types';
import { EngineSelect } from '@/components/ui/EngineSelect';
import styles from '../PublicationWorkspace.module.css';

interface CourseDataFormProps {
    initialData?: PublicationCourseData;
    onDataChange: (data: PublicationCourseData) => void;
    lockedEmail?: string;
}

export function CourseDataForm({ initialData, onDataChange, lockedEmail }: CourseDataFormProps) {
    const [formData, setFormData] = useState<PublicationCourseData>({
        category: initialData?.category || 'ia',
        level: initialData?.level || 'beginner',
        instructor_email: initialData?.instructor_email || '',
        slug: initialData?.slug || '',
        price: initialData?.price || 0,
        thumbnail_url: formatThumbnailUrl(initialData?.thumbnail_url) || '',
    });

    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            toast.error("La imagen no debe superar los 5MB");
            return;
        }

        setIsUploading(true);

        try {
            const fileExt = file.name.split('.').pop();
            const filePath = `thumb-${Date.now()}.${fileExt}`;

            const { publicUrl } = await uploadWithSignedUrl('thumbnails', filePath, file);

            handleChange('thumbnail_url', publicUrl);
            toast.success("Imagen subida correctamente");
        } catch (error: unknown) {
            console.error('Upload error:', error);
            toast.error(
                `Error al subir imagen: ${getErrorMessage(error, 'Error desconocido')}`,
            );
        } finally {
            setIsUploading(false);
        }
    };

    const handleChange = (
        field: keyof PublicationCourseData,
        value: string | number,
    ) => {
        let finalValue: string | number | undefined = value;
        
        // Fix for Google Drive view links to display as image correctly
        if (field === 'thumbnail_url' && typeof finalValue === 'string') {
            finalValue = formatThumbnailUrl(finalValue);
        }

        const newData: PublicationCourseData = { ...formData, [field]: finalValue };
        setFormData(newData);
        onDataChange(newData);
    };

    return (
        <section className={styles.settingsPanel}>
            <div className={styles.panelHeading}>
                <span className={styles.panelIcon} aria-hidden="true">
                    <BookOpen size={17} />
                </span>
                <div>
                    <span className={styles.eyebrow}>Configuración</span>
                    <h3>Datos del curso</h3>
                </div>
            </div>

            <div className={styles.formGrid}>
                {/* Category */}
                <div className={styles.fieldGroup}>
                    <label>
                        Categoría
                    </label>
                    <EngineSelect
                        value={formData.category}
                        onValueChange={(value) => handleChange('category', value)}
                        options={[
                            { value: 'ia', label: 'Inteligencia Artificial' },
                            { value: 'programming', label: 'Programación' },
                            { value: 'data', label: 'Data Science' },
                            { value: 'design', label: 'Diseño' },
                            { value: 'business', label: 'Negocios' },
                            { value: 'marketing', label: 'Marketing' },
                        ]}
                    />
                </div>

                {/* Level */}
                <div className={styles.fieldGroup}>
                    <label>
                        Nivel
                    </label>
                    <EngineSelect
                        value={formData.level}
                        onValueChange={(value) => handleChange('level', value)}
                        options={[
                            { value: 'beginner', label: 'Principiante' },
                            { value: 'intermediate', label: 'Intermedio' },
                            { value: 'advanced', label: 'Avanzado' },
                        ]}
                    />
                </div>

                {/* Instructor Email */}
                <div className={styles.fieldGroup}>
                    <label>
                        Email del Instructor (Soflia)
                    </label>
                    <input
                        type="email"
                        placeholder="instructor@soflia.com"
                        readOnly={Boolean(lockedEmail)}
                        className={`${styles.textInput} ${lockedEmail ? styles.lockedInput : ''}`}
                        value={formData.instructor_email}
                        onChange={(e) => {
                            if (!lockedEmail) handleChange('instructor_email', e.target.value);
                        }}
                    />
                    <p className={styles.fieldHint}>
                        {lockedEmail
                            ? "Asociado a tu cuenta de Soflia."
                            : "Debe coincidir con un usuario registrado en Soflia."}
                    </p>
                </div>

                {/* Slug */}
                <div className={styles.fieldGroup}>
                    <label>
                        Slug URL
                    </label>
                    <input
                        type="text"
                        placeholder="intro-machine-learning"
                        className={styles.textInput}
                        value={formData.slug}
                        onChange={(e) => handleChange('slug', e.target.value)}
                    />
                </div>

                {/* Price */}
                <div className={styles.fieldGroup}>
                    <label>
                        Precio (USD)
                    </label>
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={styles.textInput}
                        value={formData.price}
                        onChange={(e) => handleChange('price', parseFloat(e.target.value))}
                    />
                </div>

                {/* Thumbnail URL */}
                <div className={`${styles.fieldGroup} ${styles.coverField}`}>
                    <label>
                        Portada del curso
                    </label>

                    <div className={styles.coverControls}>
                        {/* Drag & Drop / Upload Area */}
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleImageUpload}
                            className={styles.hiddenInput}
                            accept="image/png, image/jpeg, image/webp"
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className={styles.coverUpload}
                        >
                            {formData.thumbnail_url ? (
                                <>
                                    <div className={styles.coverPreview}>
                                        <img src={formData.thumbnail_url} alt="Vista previa de la portada" />
                                        <div className={styles.coverOverlay} />
                                    </div>
                                    <div className={styles.coverAction}>
                                        {isUploading ? (
                                            <Loader2 className="animate-spin" size={24} />
                                        ) : (
                                            <ImageIcon size={24} className="group-hover:scale-110 transition-transform" />
                                        )}
                                        <p>Cambiar portada</p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className={styles.uploadIcon}>
                                        {isUploading ? <Loader2 className="animate-spin" size={24} /> : <Upload size={24} />}
                                    </div>
                                    <div className={styles.uploadCopy}>
                                        <p>
                                            {isUploading ? 'Subiendo...' : 'Subir portada'}
                                        </p>
                                        <small>PNG, JPG o WEBP · máximo 5 MB</small>
                                    </div>
                                </>
                            )}
                        </button>

                        {/* Fallback URL Input */}
                        <div className={styles.urlInputWrap}>
                            <input
                                type="url"
                                placeholder="O pega una URL externa..."
                                className={`${styles.textInput} ${styles.urlInput}`}
                                value={formData.thumbnail_url}
                                onChange={(e) => handleChange('thumbnail_url', e.target.value)}
                            />
                            <div className={styles.inputIcon}>
                                <ImageIcon size={14} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
