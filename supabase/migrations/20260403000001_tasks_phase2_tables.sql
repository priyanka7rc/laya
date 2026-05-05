-- ============================================
-- TASKS PHASE 2: STUB RELATIONAL TABLES
-- ============================================
-- Purpose: Create infrastructure tables for relational task fields.
--   No API routes, no UI, no business logic — schema only.
--   RLS mirrors the tasks table pattern (app_user_id via app_users join).
-- Created: 2026-04-03
-- ============================================

-- ============================================
-- task_subtasks
-- ============================================
CREATE TABLE IF NOT EXISTS public.task_subtasks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  app_user_id UUID        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  is_done     BOOLEAN     NOT NULL DEFAULT false,
  position    INT         NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.set_task_subtasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_subtasks_updated_at ON public.task_subtasks;
CREATE TRIGGER trg_task_subtasks_updated_at
  BEFORE UPDATE ON public.task_subtasks
  FOR EACH ROW EXECUTE FUNCTION public.set_task_subtasks_updated_at();

CREATE INDEX IF NOT EXISTS idx_task_subtasks_task
  ON public.task_subtasks (task_id, position)
  WHERE deleted_at IS NULL;

ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_subtasks_select_own" ON public.task_subtasks;
CREATE POLICY "task_subtasks_select_own"
  ON public.task_subtasks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_subtasks.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_subtasks_insert_own" ON public.task_subtasks;
CREATE POLICY "task_subtasks_insert_own"
  ON public.task_subtasks FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_subtasks.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_subtasks_update_own" ON public.task_subtasks;
CREATE POLICY "task_subtasks_update_own"
  ON public.task_subtasks FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_subtasks.app_user_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_subtasks.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_subtasks_delete_own" ON public.task_subtasks;
CREATE POLICY "task_subtasks_delete_own"
  ON public.task_subtasks FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_subtasks.app_user_id AND u.auth_user_id = auth.uid()
  ));

-- ============================================
-- task_comments
-- ============================================
CREATE TABLE IF NOT EXISTS public.task_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  app_user_id UUID        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION public.set_task_comments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_comments_updated_at ON public.task_comments;
CREATE TRIGGER trg_task_comments_updated_at
  BEFORE UPDATE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_task_comments_updated_at();

CREATE INDEX IF NOT EXISTS idx_task_comments_task
  ON public.task_comments (task_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_comments_select_own" ON public.task_comments;
CREATE POLICY "task_comments_select_own"
  ON public.task_comments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_comments.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_comments_insert_own" ON public.task_comments;
CREATE POLICY "task_comments_insert_own"
  ON public.task_comments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_comments.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_comments_update_own" ON public.task_comments;
CREATE POLICY "task_comments_update_own"
  ON public.task_comments FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_comments.app_user_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_comments.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_comments_delete_own" ON public.task_comments;
CREATE POLICY "task_comments_delete_own"
  ON public.task_comments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_comments.app_user_id AND u.auth_user_id = auth.uid()
  ));

-- ============================================
-- task_assignees
-- ============================================
CREATE TABLE IF NOT EXISTS public.task_assignees (
  task_id     UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  app_user_id UUID        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'assignee'
    CHECK (role IN ('assignee', 'collaborator', 'observer')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, app_user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_user
  ON public.task_assignees (app_user_id);

ALTER TABLE public.task_assignees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_assignees_select_own" ON public.task_assignees;
CREATE POLICY "task_assignees_select_own"
  ON public.task_assignees FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_assignees.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_assignees_insert_own" ON public.task_assignees;
CREATE POLICY "task_assignees_insert_own"
  ON public.task_assignees FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_assignees.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_assignees_delete_own" ON public.task_assignees;
CREATE POLICY "task_assignees_delete_own"
  ON public.task_assignees FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_assignees.app_user_id AND u.auth_user_id = auth.uid()
  ));

-- ============================================
-- task_attachments
-- ============================================
-- Links a task to a media_upload. media_upload_id is untyped UUID for now
-- to avoid coupling to the media_uploads table schema at infrastructure stage.
CREATE TABLE IF NOT EXISTS public.task_attachments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  app_user_id     UUID        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  media_upload_id UUID        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task
  ON public.task_attachments (task_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "task_attachments_select_own" ON public.task_attachments;
CREATE POLICY "task_attachments_select_own"
  ON public.task_attachments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_attachments.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_attachments_insert_own" ON public.task_attachments;
CREATE POLICY "task_attachments_insert_own"
  ON public.task_attachments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_attachments.app_user_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "task_attachments_delete_own" ON public.task_attachments;
CREATE POLICY "task_attachments_delete_own"
  ON public.task_attachments FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.app_users u
    WHERE u.id = task_attachments.app_user_id AND u.auth_user_id = auth.uid()
  ));
