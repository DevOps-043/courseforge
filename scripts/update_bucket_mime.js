const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Read env variables from apps/web/.env.local
const envPath = path.join(__dirname, 'apps', 'web', '.env.local');
if (!fs.existsSync(envPath)) {
    console.error('No se encontró el archivo .env.local en:', envPath);
    process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split('=');
    if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        env[key] = value;
    }
});

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY'] || env['NEXT_PUBLIC_SUPABASE_ROLE_KEY'];

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
    process.exit(1);
}

console.log('Inicializando cliente Supabase...');
console.log('URL:', supabaseUrl);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

async function main() {
    console.log('Actualizando configuración del bucket "production-assets"...');
    
    // Intenta actualizar el bucket con los MIME types correspondientes
    const { data, error } = await supabase.storage.updateBucket('production-assets', {
        public: true,
        fileSizeLimit: 524288000, // 500MB
        allowedMimeTypes: [
            'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-wav',
            'image/png', 'image/jpeg', 'image/webp',
            'text/html', 'application/json', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'
        ]
    });

    if (error) {
        console.error('Error al actualizar el bucket:', error);
        process.exit(1);
    }

    console.log('¡Bucket actualizado con éxito!');
    console.log('Configuración actual:', data);
}

main().catch(err => {
    console.error('Error no controlado:', err);
    process.exit(1);
});
