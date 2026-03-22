import { create } from 'zustand';
import { supabase } from '@/lib/supabase/client';
import { GENRE_SAFE_COLUMNS, MOOD_SAFE_COLUMNS, PRODUCT_SAFE_COLUMNS } from '../supabase/selects';
import type { CartItemWithProduct } from '../supabase/types';

interface CartState {
  items: CartItemWithProduct[];
  isLoading: boolean;
  fetchCart: () => Promise<void>;
  addToCart: (productId: string) => Promise<void>;
  removeFromCart: (productId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  getTotal: () => number;
  getItemCount: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  isLoading: false,

  fetchCart: async () => {
    set({ isLoading: true });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        set({ items: [], isLoading: false });
        return;
      }

      const { data, error } = await supabase
        .from('cart_items')
        .select(`
          *,
          product:products(
            ${PRODUCT_SAFE_COLUMNS},
            producer:user_profiles!products_producer_id_fkey(id, username, avatar_url),
            genre:genres(${GENRE_SAFE_COLUMNS}),
            mood:moods(${MOOD_SAFE_COLUMNS})
          )
        ` as any)
        .eq('user_id', user.id);

      if (error) throw error;

      const rows = ((data as unknown as CartItemWithProduct[] | null) ?? []);
      const validItems = rows.filter((item): item is CartItemWithProduct & { product: NonNullable<CartItemWithProduct['product']> } => {
        if (!item.product) return false;
        return item.product.is_published && (!item.product.is_exclusive || !item.product.is_sold);
      });

      const hydratedItems = validItems.map((item) => {
        return {
          ...item,
          selected_license: null,
        };
      });

      set({ items: hydratedItems, isLoading: false });
    } catch (error) {
      console.error('Error fetching cart:', error);
      set({ isLoading: false });
    }
  },

  addToCart: async (productId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Must be logged in to add to cart');

    const { error } = await supabase
      .from('cart_items')
      .upsert({
        user_id: user.id,
        product_id: productId,
        license_id: null,
        license_type: null,
      }, {
        onConflict: 'user_id,product_id',
      });

    if (error) throw error;
    await get().fetchCart();
  },

  removeFromCart: async (productId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', user.id)
      .eq('product_id', productId);

    if (error) throw error;
    await get().fetchCart();
  },

  clearCart: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', user.id);

    if (error) throw error;
    set({ items: [] });
  },

  getTotal: () => {
    return get().items.reduce((total, item) => {
      return total + (item.product?.price ?? 0);
    }, 0);
  },

  getItemCount: () => {
    return get().items.length;
  },
}));
