import { create } from 'zustand';
import { supabase } from '../supabase/client';

interface WishlistState {
  productIds: string[];
  isLoading: boolean;
  fetchWishlist: () => Promise<void>;
  toggleWishlist: (productId: string) => Promise<void>;
  isWishlisted: (productId: string) => boolean;
  clearWishlist: () => void;
}

export const useWishlistStore = create<WishlistState>((set, get) => ({
  productIds: [],
  isLoading: false,

  fetchWishlist: async () => {
    set({ isLoading: true });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        set({ productIds: [], isLoading: false });
        return;
      }

      const { data, error } = await supabase
        .from('wishlists')
        .select('product_id')
        .eq('user_id', user.id);

      if (error) {
        throw error;
      }

      const ids = [...new Set((data || []).map((row) => row.product_id).filter(Boolean))];
      set({ productIds: ids, isLoading: false });
    } catch (error) {
      console.error('Error fetching wishlist:', error);
      set({ isLoading: false });
    }
  },

  toggleWishlist: async (productId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('Must be logged in to manage wishlist');
    }

    const currentIds = get().productIds;
    const alreadyWishlisted = currentIds.includes(productId);

    if (alreadyWishlisted) {
      const { error } = await supabase
        .from('wishlists')
        .delete()
        .eq('user_id', user.id)
        .eq('product_id', productId);

      if (error) {
        throw error;
      }

      set({ productIds: currentIds.filter((id) => id !== productId) });
      return;
    }

    const { error } = await supabase
      .from('wishlists')
      .insert({
        user_id: user.id,
        product_id: productId,
      });

    if (error) {
      // Unique constraint can happen on stale UI; treat as success and sync local state.
      if ((error as { code?: string }).code !== '23505') {
        throw error;
      }
    }

    set({ productIds: [...new Set([...currentIds, productId])] });
  },

  isWishlisted: (productId: string) => {
    return get().productIds.includes(productId);
  },

  clearWishlist: () => set({ productIds: [] }),
}));
