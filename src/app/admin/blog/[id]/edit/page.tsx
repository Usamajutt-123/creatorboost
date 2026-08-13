import { notFound } from 'next/navigation';
import BlogEditor from '../../BlogEditor';
import { adminGetBlogPost } from '@/lib/blog-admin-actions';
import { getDashboardProfile } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function EditBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [post, profile] = await Promise.all([adminGetBlogPost(id), getDashboardProfile()]);
  if (!post) notFound();
  return <BlogEditor initialPost={post} defaultAuthor={profile?.full_name || profile?.email || 'CreatorBoost'} />;
}
