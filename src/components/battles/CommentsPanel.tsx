import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, Pencil, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useAuth, useIsAdmin, useIsEmailVerified } from '../../lib/auth/hooks';
import { useTranslation } from '../../lib/i18n';
import { supabase } from '../../lib/supabase/client';

interface BattleCommentItem {
  id: string;
  battle_id: string;
  user_id: string;
  content: string;
  is_hidden: boolean;
  hidden_reason: string | null;
  created_at: string;
  updated_at: string;
  user?: {
    id: string;
    username: string | null;
    avatar_url: string | null;
  };
}

interface CommentsPanelProps {
  battleId: string;
  commentsOpen: boolean;
}

export function CommentsPanel({ battleId, commentsOpen }: CommentsPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isEmailVerified = useIsEmailVerified();
  const isAdmin = useIsAdmin();

  const [comments, setComments] = useState<BattleCommentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const loadComments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('battle_comments')
      .select(`
        id,
        battle_id,
        user_id,
        content,
        is_hidden,
        hidden_reason,
        created_at,
        updated_at,
        user:user_profiles(id, username, avatar_url)
      `)
      .eq('battle_id', battleId)
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching battle comments:', fetchError);
      setComments([]);
      setError('Impossible de charger les commentaires.');
      setIsLoading(false);
      return;
    }

    setComments((data as BattleCommentItem[] | null) ?? []);
    setIsLoading(false);
  }, [battleId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const commentPermissionMessage = useMemo(() => {
    if (!user) return 'Connectez-vous pour commenter.';
    if (!isEmailVerified) return 'Votre email doit etre confirme pour commenter.';
    if (!commentsOpen) return t('battles.votingClosed');
    return null;
  }, [commentsOpen, isEmailVerified, t, user]);

  const submitComment = async () => {
    if (!user?.id) return;

    const clean = content.trim();
    if (!clean) {
      setError('Le commentaire est vide.');
      return;
    }

    if (clean.length > 1000) {
      setError('Le commentaire depasse 1000 caracteres.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const { error: insertError } = await supabase
      .from('battle_comments')
      .insert({
        battle_id: battleId,
        user_id: user.id,
        content: clean,
      });

    if (insertError) {
      console.error('Error inserting battle comment:', insertError);
      setError('Ajout du commentaire impossible.');
      setIsSubmitting(false);
      return;
    }

    setContent('');
    setIsSubmitting(false);
    await loadComments();
  };

  const deleteComment = async (commentId: string) => {
    const { error: deleteError } = await supabase
      .from('battle_comments')
      .delete()
      .eq('id', commentId);

    if (deleteError) {
      console.error('Error deleting battle comment:', deleteError);
      setError('Suppression du commentaire impossible.');
      return;
    }

    await loadComments();
  };

  const saveEdit = async (commentId: string) => {
    const clean = editingContent.trim();
    if (!clean) {
      setError('Le commentaire est vide.');
      return;
    }

    const { error: updateError } = await supabase
      .from('battle_comments')
      .update({ content: clean })
      .eq('id', commentId);

    if (updateError) {
      console.error('Error updating battle comment:', updateError);
      setError('Mise a jour impossible.');
      return;
    }

    setEditingId(null);
    setEditingContent('');
    await loadComments();
  };

  const toggleModeration = async (comment: BattleCommentItem) => {
    if (!isAdmin) return;

    const nextHidden = !comment.is_hidden;
    const { error: modError } = await supabase
      .from('battle_comments')
      .update({
        is_hidden: nextHidden,
        hidden_reason: nextHidden ? 'hidden_by_admin' : null,
      })
      .eq('id', comment.id);

    if (modError) {
      console.error('Error moderating battle comment:', modError);
      setError('Moderation impossible.');
      return;
    }

    await loadComments();
  };

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold text-white inline-flex items-center gap-2">
        <MessageSquare className="w-4 h-4" />
        {t('battles.comments')}
      </h2>

      {commentPermissionMessage ? (
        <p className="text-sm text-zinc-400">{commentPermissionMessage}</p>
      ) : (
        <div className="space-y-2">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('battles.addComment')}
            maxLength={1000}
            className="w-full min-h-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-500">{content.length}/1000</span>
            <Button size="sm" isLoading={isSubmitting} onClick={submitComment}>
              {t('common.submit')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400">{error}</p>
      )}

      {isLoading ? (
        <p className="text-sm text-zinc-400">{t('common.loading')}</p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-zinc-500">{t('battles.noComments')}</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => {
            const isOwner = user?.id === comment.user_id;
            const isEditing = editingId === comment.id;

            return (
              <li key={comment.id} className="bg-zinc-800/50 rounded-lg border border-zinc-700 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      {comment.user?.username || 'Utilisateur'}
                    </p>
                    <p className="text-xs text-zinc-500">{new Date(comment.created_at).toLocaleString()}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isOwner && !comment.is_hidden && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (isEditing) {
                              setEditingId(null);
                              setEditingContent('');
                            } else {
                              setEditingId(comment.id);
                              setEditingContent(comment.content);
                            }
                          }}
                          leftIcon={<Pencil className="w-3 h-3" />}
                        >
                          Modifier
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteComment(comment.id)}
                          leftIcon={<Trash2 className="w-3 h-3" />}
                        >
                          Supprimer
                        </Button>
                      </>
                    )}

                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        leftIcon={<ShieldAlert className="w-3 h-3" />}
                        onClick={() => toggleModeration(comment)}
                      >
                        {comment.is_hidden ? 'Restaurer' : 'Masquer'}
                      </Button>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingContent}
                      onChange={(event) => setEditingContent(event.target.value)}
                      className="w-full min-h-20 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Annuler
                      </Button>
                      <Button size="sm" onClick={() => saveEdit(comment.id)}>
                        Enregistrer
                      </Button>
                    </div>
                  </div>
                ) : comment.is_hidden ? (
                  <p className="text-sm text-zinc-500 italic">
                    Commentaire masque{comment.hidden_reason ? ` (${comment.hidden_reason})` : ''}.
                  </p>
                ) : (
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap">{comment.content}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
