import { create } from 'zustand';
import { supabase } from '../supabase/client';
import type { CartItemWithProduct, ProductWithRelations } from '../supabase/types';

interface CartState {
  items: CartItemWithProduct[];
  isLoading: boolean;
  fetchCart: () => Promise<void>;
  addToCart: (productId: string, licenseType?: string) => Promise<void>;
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
            *,
            producer:user_profiles!products_producer_id_fkey(id, username, avatar_url),
            genre:genres(*),
            mood:moods(*)
          )
        `)
        .eq('user_id', user.id);

      if (error) throw error;

      const validItems = (data || []).filter(
        (item): item is CartItemWithProduct & { product: ProductWithRelations } =>
          item.product !== null &&
          item.product.is_published &&
          (!item.product.is_exclusive || !item.product.is_sold)
      );

      set({ items: validItems, isLoading: false });
    } catch (error) {
      console.error('Error fetching cart:', error);
      set({ isLoading: false });
    }
  },

  addToCart: async (productId: string, licenseType = 'standard') => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Must be logged in to add to cart');

    const { error } = await supabase
      .from('cart_items')
      .upsert({
        user_id: user.id,
        product_id: productId,
        license_type: licenseType,
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
      return total + (item.product?.price || 0);
    }, 0);
  },

  getItemCount: () => {
    return get().items.length;
  },
}));
