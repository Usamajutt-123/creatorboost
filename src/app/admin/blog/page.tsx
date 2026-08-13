import { adminListBlogPosts } from '@/lib/blog-admin-actions';
import AdminBlogListClient from './BlogListClient';

export const dynamic = 'force-dynamic';

export default async function AdminBlogPage() {
  const result = await adminListBlogPosts().catch((error: Error) => error);
  return (
    <AdminBlogListClient
      initialPosts={Array.isArray(result) ? result : []}
      initialError={result instanceof Error ? result.message : null}
    />
  );
}
