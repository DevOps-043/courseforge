'use client';

import { useState, useRef } from 'react';
import { Loader2, Upload, Image as ImageIcon, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { toast } from 'sonner';

interface CourseDataFormProps {
    initialData?: {
        category: string;
        level: string;
        instructor_email: string;
        slug: string;
        price: number;
        thumbnail_url?: string;
    };
    onDataChange: (data: any) => void;
}

export function CourseDataForm({ initialData, onDataChange }: CourseDataFormProps) {
    const [formData, setFormData] = useState({
        category: initialData?.category || 'ia',
        level: initialData?.level || 'beginner',
        instructor_email: initialData?.instructor_email || '',
        slug: initialData?.slug || '',
        price: initialData?.price || 0,
        thumbnail_url: initialData?.thumbnail_url || '',
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
        const supabase = createClient();

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `thumb-${Date.now()}.${fileExt}`;
            const filePath = `${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('thumbnails')
                .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
                .from('thumbnails')
                .getPublicUrl(filePath);

            handleChange('thumbnail_url', publicUrl);
            toast.success("Imagen subida correctamente");
        } catch (error: any) {
            console.error('Upload error:', error);
            toast.error("Error al subir imagen: " + error.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleChange = (field: string, value: any) => {
        const newData = { ...formData, [field]: value };
        setFormData(newData);
        onDataChange(newData);
    };

    return (
        <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                1. Datos del Curso
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Category */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Categoría
                    </label>
                    <select
                        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none transition-all"
                        value={formData.category}
                        onChange={(e) => handleChange('category', e.target.value)}
                    >
                        <option value="ia">Inteligencia Artificial</option>
                        <option value="programming">Programación</option>
                        <option value="data">Data Science</option>
                        <option value="design">Diseño</option>
                        <option value="business">Negocios</option>
                        <option value="marketing">Marketing</option>
                    </select>
                </div>

                {/* Level */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Nivel
                    </label>
                    <select
                        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none transition-all"
                        value={formData.level}
                        onChange={(e) => handleChange('level', e.target.value)}
                    >
                        <option value="beginner">Principiante</option>
                        <option value="intermediate">Intermedio</option>
                        <option value="advanced">Avanzado</option>
                    </select>
                </div>

                {/* Instructor Email */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Email del Instructor (Soflia)
                    </label>
                    <input
                        type="email"
                        placeholder="instructor@soflia.com"
                        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none transition-all"
                        value={formData.instructor_email}
                        onChange={(e) => handleChange('instructor_email', e.target.value)}
                    />
                    <p className="text-xs text-gray-500">Debe coincidir con un usuario registrado en Soflia.</p>
                </div>

                {/* Slug */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Slug URL
                    </label>
                    <input
                        type="text"
                        placeholder="intro-machine-learning"
                        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none transition-all"
                        value={formData.slug}
                        onChange={(e) => handleChange('slug', e.target.value)}
                    />
                </div>

                {/* Price */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Precio (USD)
                    </label>
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none transition-all"
                        value={formData.price}
                        onChange={(e) => handleChange('price', parseFloat(e.target.value))}
                    />
                </div>

                {/* Thumbnail URL */}
                <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        URL de Portada (Thumbnail)
                    </label>

                    <div className="space-y-3">
                        {/* Drag & Drop / Upload Area */}
                        <div
                            onClick={() => fileInputRef.current?.click()}
                            className="border-2 border-dashed border-gray-200 dark:border-[#6C757D]/20 hover:border-[#00D4B3]/50 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl p-6 cursor-pointer transition-all flex flex-col items-center justify-center gap-3 group relative overflow-hidden"
                        >
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleImageUpload}
                                className="hidden"
                                accept="image/png, image/jpeg, image/webp"
                            />

                            {formData.thumbnail_url ? (
                                <>
                                    <div className="absolute inset-0 z-0">
                                        <img src={formData.thumbnail_url} alt="Thumbnail Preview" className="w-full h-full object-cover opacity-50 group-hover:scale-105 transition-transform duration-500" />
                                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
                                    </div>
                                    <div className="relative z-10 flex flex-col items-center gap-2 text-white">
                                        {isUploading ? (
                                            <Loader2 className="animate-spin" size={24} />
                                        ) : (
                                            <ImageIcon size={24} className="group-hover:scale-110 transition-transform" />
                                        )}
                                        <p className="text-sm font-medium">Click para cambiar imagen</p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="p-3 bg-gray-100 dark:bg-white/5 rounded-full group-hover:bg-[#00D4B3]/10 group-hover:text-[#00D4B3] transition-colors">
                                        {isUploading ? <Loader2 className="animate-spin" size={24} /> : <Upload size={24} />}
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-[#00D4B3]">
                                            {isUploading ? 'Subiendo...' : 'Click para subir imagen'}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1">PNG, JPG, WEBP (Max 5MB)</p>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Fallback URL Input */}
                        <div className="relative">
                            <input
                                type="url"
                                placeholder="O pega una URL externa..."
                                className="w-full bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-xl px-4 py-2 text-xs text-gray-900 dark:text-white focus:ring-1 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none transition-all pl-9"
                                value={formData.thumbnail_url}
                                onChange={(e) => handleChange('thumbnail_url', e.target.value)}
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                <ImageIcon size={14} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
