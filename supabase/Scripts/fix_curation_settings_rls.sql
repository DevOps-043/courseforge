-- ==============================================================================
-- SCRIPT: FIX RLS FOR CURATION SETTINGS
-- ==============================================================================

-- Permitir update a usuarios autenticados (para que el Admin Panel funcione)
-- La política anterior solo permitía 'service_role', lo cual bloquea el cliente web.

DROP POLICY IF EXISTS "Allow update for service role only" ON public.curation_settings;
DROP POLICY IF EXISTS "Allow update for authenticated users" ON public.curation_settings;

CREATE POLICY "Allow update for authenticated users" 
ON public.curation_settings 
FOR UPDATE 
USING (auth.role() = 'authenticated');

-- También aseguramos insert (aunque solo debería haber una fila)
CREATE POLICY "Allow insert for authenticated users" 
ON public.curation_settings 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');
