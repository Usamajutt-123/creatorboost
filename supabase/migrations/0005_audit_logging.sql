-- ============================================================
-- CreatorBoost Migration 0005 — Audit Logging
-- ------------------------------------------------------------
-- Provides a first-class `audit_action` RPC that service-role server
-- code uses to record administrative actions. Client roles cannot
-- call it (EXECUTE revoked).
--
-- Columns on audit_log: actor_id, action, entity_type, entity_id,
-- old_values, new_values, ip_address, user_agent, created_at
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_action(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL,
  p_ip TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_log (
    actor_id, action, entity_type, entity_id,
    old_values, new_values, ip_address, user_agent
  ) VALUES (
    COALESCE(p_actor_id, auth.uid()),
    p_action, p_entity_type, p_entity_id,
    p_old_values, p_new_values,
    NULLIF(p_ip, '')::inet,
    p_user_agent
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_action(TEXT, TEXT, UUID, JSONB, JSONB, TEXT, TEXT, UUID) FROM anon, authenticated;
