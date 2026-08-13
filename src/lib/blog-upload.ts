'use client';

import { createClient } from '@/lib/supabase/client';

export const BLOG_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export type UploadedBlogImage = {
  storagePath: string;
  publicUrl: string;
};

export function validateBlogImage(file: File): string | null {
  if (!ACCEPTED_TYPES[file.type]) return 'Use a JPG, PNG, WebP, or AVIF image.';
  if (file.size <= 0) return 'The selected image is empty.';
  if (file.size > BLOG_IMAGE_MAX_BYTES) return 'Images must be 8 MB or smaller.';
  return null;
}

/**
 * Uploads directly to Supabase Storage with the signed-in admin token. The
 * browser never receives a service-role key; Storage RLS independently checks
 * is_admin() and the <kind>/<uid>/ path. XHR is intentionally used so the
 * editor can show real byte upload progress without adding an upload library.
 */
export async function uploadBlogImage(
  file: File,
  kind: 'featured' | 'content',
  onProgress: (percentage: number) => void,
): Promise<UploadedBlogImage> {
  const validationError = validateBlogImage(file);
  if (validationError) throw new Error(validationError);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error('Image storage is not configured.');
  const supabase = createClient();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token || !session.user?.id) throw new Error('Your session expired. Sign in again.');

  const extension = ACCEPTED_TYPES[file.type];
  const objectId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${kind}/${session.user.id}/${objectId}.${extension}`;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/blog/${encodedPath}`;

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', endpoint);
    request.setRequestHeader('apikey', anonKey);
    request.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    request.setRequestHeader('Content-Type', file.type);
    request.setRequestHeader('Cache-Control', '31536000');
    request.setRequestHeader('x-upsert', 'false');
    request.upload.addEventListener('progress', event => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener('error', () => reject(new Error('Network error while uploading image.')));
    request.addEventListener('abort', () => reject(new Error('Image upload was cancelled.')));
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      let message = 'Image upload failed.';
      try {
        const payload = JSON.parse(request.responseText) as { message?: string; error?: string };
        message = payload.message || payload.error || message;
      } catch {
        // Keep a neutral error when the Storage API did not return JSON.
      }
      reject(new Error(message));
    });
    request.send(file);
  });

  const { data } = supabase.storage.from('blog').getPublicUrl(path);
  return { storagePath: path, publicUrl: data.publicUrl };
}
