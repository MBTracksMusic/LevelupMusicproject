import { Link } from 'react-router-dom';
import { Crown, MessageSquare, MessageSquareText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useForumCategories } from '../lib/forum/hooks';
import { useTranslation } from '../lib/i18n';

export function ForumPage() {
  const { t } = useTranslation();
  const { categories, isLoading, error } = useForumCategories();

  return (
    <div className="min-h-screen bg-zinc-950 pt-8 pb-32">
      <div className="max-w-6xl mx-auto px-4 space-y-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white">{t('forum.title')}</h1>
            <p className="text-zinc-400">
              {t('forum.subtitle')}
            </p>
          </div>
          <Link to="/forum">
            <Button variant="outline">{t('common.refresh')}</Button>
          </Link>
        </div>

        {isLoading && (
          <div className="grid gap-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index} className="border-zinc-800">
                <div className="h-24 animate-pulse rounded-xl bg-zinc-900" />
              </Card>
            ))}
          </div>
        )}

        {error && (
          <Card className="border-red-900 bg-red-950/20">
            <CardContent className="text-sm text-red-300">{error}</CardContent>
          </Card>
        )}

        {!isLoading && !error && categories.length === 0 && (
          <Card className="border-zinc-800">
            <CardContent className="py-12 text-center text-zinc-400">
              {t('forum.emptyCategory')}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4">
          {categories.map((category) => (
            <Link key={category.id} to={`/forum/${category.slug}`} className="block">
              <Card variant="interactive" className="border-zinc-800">
                <CardHeader className="mb-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle>{category.name}</CardTitle>
                      {category.is_premium_only && (
                        <Badge variant="premium">
                          <Crown className="h-3 w-3" />
                          {t('forum.premium')}
                        </Badge>
                      )}
                    </div>
                    <CardDescription>
                      {category.description || t('forum.noCategoryDescription')}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <MessageSquareText className="h-4 w-4" />
                      {t('forum.topicsCount', { count: category.topic_count })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="h-4 w-4" />
                      {t('forum.postsCount', { count: category.post_count })}
                    </span>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
