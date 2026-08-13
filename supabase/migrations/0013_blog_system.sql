-- ============================================================
-- CreatorBoost Migration 0013 — Real Blog System
-- ------------------------------------------------------------
-- Adds only blog-owned tables and storage policies. Existing campaign,
-- earnings, finance, authentication, and notification data is untouched.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  slug TEXT NOT NULL CHECK (char_length(slug) BETWEEN 1 AND 160 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  excerpt TEXT NOT NULL CHECK (char_length(excerpt) BETWEEN 1 AND 500),
  content JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(content) = 'array'),
  category TEXT NOT NULL CHECK (char_length(category) BETWEEN 1 AND 80),
  featured_image TEXT,
  featured_image_path TEXT,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL CHECK (char_length(author_name) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  reading_time INTEGER NOT NULL DEFAULT 1 CHECK (reading_time BETWEEN 1 AND 999),
  seo_title TEXT CHECK (seo_title IS NULL OR char_length(seo_title) <= 120),
  seo_description TEXT CHECK (seo_description IS NULL OR char_length(seo_description) <= 320),
  seo_keywords TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blog_posts_slug_unique UNIQUE (slug),
  CONSTRAINT published_blog_is_complete CHECK (
    status = 'draft' OR (
      published_at IS NOT NULL
      AND featured_image IS NOT NULL
      AND featured_image_path IS NOT NULL
      AND jsonb_array_length(content) > 0
    )
  )
);

CREATE TABLE IF NOT EXISTS public.blog_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 300),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blog_images_post_path_unique UNIQUE (post_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published
  ON public.blog_posts (published_at DESC)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_blog_posts_category_published
  ON public.blog_posts (category, published_at DESC)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_updated
  ON public.blog_posts (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_images_post_sort
  ON public.blog_images (post_id, sort_order, created_at);

-- Normalize publishing fields and use the existing CreatorBoost updated_at
-- trigger helper. A future published_at remains hidden until that time.
CREATE OR REPLACE FUNCTION public.prepare_blog_post()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.slug := lower(trim(NEW.slug));
  NEW.title := trim(NEW.title);
  NEW.category := trim(NEW.category);
  NEW.author_name := trim(NEW.author_name);
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := NOW();
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_blog_posts_prepare ON public.blog_posts;
CREATE TRIGGER trg_blog_posts_prepare
  BEFORE INSERT OR UPDATE ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.prepare_blog_post();

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS blog_posts_public_read_published ON public.blog_posts;
DROP POLICY IF EXISTS blog_posts_admin_read_all ON public.blog_posts;
DROP POLICY IF EXISTS blog_posts_admin_insert ON public.blog_posts;
DROP POLICY IF EXISTS blog_posts_admin_update ON public.blog_posts;
DROP POLICY IF EXISTS blog_posts_admin_delete ON public.blog_posts;

CREATE POLICY blog_posts_public_read_published
  ON public.blog_posts FOR SELECT TO anon, authenticated
  USING (status = 'published' AND published_at IS NOT NULL AND published_at <= NOW());
CREATE POLICY blog_posts_admin_read_all
  ON public.blog_posts FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY blog_posts_admin_insert
  ON public.blog_posts FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND author_id = auth.uid());
CREATE POLICY blog_posts_admin_update
  ON public.blog_posts FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY blog_posts_admin_delete
  ON public.blog_posts FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS blog_images_public_read_published ON public.blog_images;
DROP POLICY IF EXISTS blog_images_admin_read_all ON public.blog_images;
DROP POLICY IF EXISTS blog_images_admin_insert ON public.blog_images;
DROP POLICY IF EXISTS blog_images_admin_update ON public.blog_images;
DROP POLICY IF EXISTS blog_images_admin_delete ON public.blog_images;

CREATE POLICY blog_images_public_read_published
  ON public.blog_images FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.blog_posts post
    WHERE post.id = blog_images.post_id
      AND post.status = 'published'
      AND post.published_at IS NOT NULL
      AND post.published_at <= NOW()
  ));
CREATE POLICY blog_images_admin_read_all
  ON public.blog_images FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY blog_images_admin_insert
  ON public.blog_images FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() AND EXISTS (
    SELECT 1 FROM public.blog_posts post WHERE post.id = blog_images.post_id
  ));
CREATE POLICY blog_images_admin_update
  ON public.blog_images FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY blog_images_admin_delete
  ON public.blog_images FOR DELETE TO authenticated
  USING (public.is_admin());

-- Column grants pair with RLS. Creators are part of `authenticated`, but all
-- write policies still require is_admin(), so grants alone never authorize.
REVOKE ALL ON TABLE public.blog_posts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.blog_images FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.blog_posts, public.blog_images TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.blog_posts, public.blog_images TO authenticated;

-- Public image bucket. Object names are UUID-based and draft URLs are never
-- returned publicly. Only an authenticated admin/super_admin may create,
-- replace, or remove objects under featured/<uid>/ or content/<uid>/.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blog',
  'blog',
  TRUE,
  8388608,
  ARRAY['image/png','image/jpeg','image/webp','image/avif']::TEXT[]
)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = 8388608,
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','image/avif']::TEXT[];

DROP POLICY IF EXISTS blog_media_public_read ON storage.objects;
DROP POLICY IF EXISTS blog_media_admin_insert ON storage.objects;
DROP POLICY IF EXISTS blog_media_admin_update ON storage.objects;
DROP POLICY IF EXISTS blog_media_admin_delete ON storage.objects;

CREATE POLICY blog_media_public_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'blog'
    AND (
      public.is_admin()
      OR EXISTS (
        SELECT 1 FROM public.blog_posts post
        WHERE post.featured_image_path = storage.objects.name
          AND post.status = 'published'
          AND post.published_at IS NOT NULL
          AND post.published_at <= NOW()
      )
      OR EXISTS (
        SELECT 1
        FROM public.blog_images image
        JOIN public.blog_posts post ON post.id = image.post_id
        WHERE image.storage_path = storage.objects.name
          AND post.status = 'published'
          AND post.published_at IS NOT NULL
          AND post.published_at <= NOW()
      )
    )
  );
CREATE POLICY blog_media_admin_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'blog'
    AND public.is_admin()
    AND (storage.foldername(name))[1] IN ('featured', 'content')
    AND (storage.foldername(name))[2] = auth.uid()::TEXT
  );
CREATE POLICY blog_media_admin_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'blog' AND public.is_admin())
  WITH CHECK (
    bucket_id = 'blog'
    AND public.is_admin()
    AND (storage.foldername(name))[1] IN ('featured', 'content')
    AND (storage.foldername(name))[2] = auth.uid()::TEXT
  );
CREATE POLICY blog_media_admin_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'blog' AND public.is_admin());
