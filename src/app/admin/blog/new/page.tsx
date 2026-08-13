import BlogEditor from '../BlogEditor';
import { getDashboardProfile } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function NewBlogPostPage() {
  const profile = await getDashboardProfile();
  const defaultAuthor = profile?.full_name || profile?.email || 'CreatorBoost';
  return <BlogEditor initialPost={null} defaultAuthor={defaultAuthor} />;
}
