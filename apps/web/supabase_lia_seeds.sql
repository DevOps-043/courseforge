-- Script corregido para evitar duplicados y errores de secuencia

-- 1. Sincronizar la secuencia del ID (Corrige el error "Key (id)=(1) already exists")
-- Esto asegura que el próximo ID generado sea mayor que el máximo actual.
SELECT setval(pg_get_serial_sequence('model_settings', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM model_settings;

-- 2. Eliminar configuraciones antiguas de Lia para evitar conflictos (Limpieza)
DELETE FROM model_settings WHERE setting_type IN ('LIA_REASONING', 'LIA_COMPUTER_USE');

-- 3. Insertar Nuevas Configuraciones
INSERT INTO model_settings (setting_type, model_name, fallback_model, temperature, thinking_level, is_active)
VALUES 
(
  'LIA_REASONING', 
  'gemini-2.0-pro-exp', 
  'gemini-2.0-flash-exp', 
  0.7, 
  'medium', 
  true
),
(
  'LIA_COMPUTER_USE', 
  'computer-use-preview', 
  'gemini-2.0-flash-exp', 
  0.4, 
  'low', 
  true
);

