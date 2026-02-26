/*
 * GENERATED FILE - DO NOT EDIT.
 * Regenerate with: npm run supabase:types
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_action_audit_log: {
        Row: {
          action_type: string
          admin_user_id: string | null
          context: Json
          created_at: string
          entity_id: string | null
          entity_type: string
          error: string | null
          extra_details: Json
          id: string
          source: string
          source_action_id: string | null
          success: boolean
        }
        Insert: {
          action_type: string
          admin_user_id?: string | null
          context?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          error?: string | null
          extra_details?: Json
          id?: string
          source?: string
          source_action_id?: string | null
          success?: boolean
        }
        Update: {
          action_type?: string
          admin_user_id?: string | null
          context?: Json
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          error?: string | null
          extra_details?: Json
          id?: string
          source?: string
          source_action_id?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_audit_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_action_audit_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_action_audit_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          payload: Json
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          payload?: Json
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          payload?: Json
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_admin_actions: {
        Row: {
          action_type: string
          ai_decision: Json
          confidence_score: number | null
          created_at: string
          entity_id: string
          entity_type: string
          error: string | null
          executed_at: string | null
          executed_by: string | null
          human_override: boolean
          id: string
          reason: string | null
          reversible: boolean
          status: string
        }
        Insert: {
          action_type: string
          ai_decision?: Json
          confidence_score?: number | null
          created_at?: string
          entity_id: string
          entity_type: string
          error?: string | null
          executed_at?: string | null
          executed_by?: string | null
          human_override?: boolean
          id?: string
          reason?: string | null
          reversible?: boolean
          status?: string
        }
        Update: {
          action_type?: string
          ai_decision?: Json
          confidence_score?: number | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          error?: string | null
          executed_at?: string | null
          executed_by?: string | null
          human_override?: boolean
          id?: string
          reason?: string | null
          reversible?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_admin_actions_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_admin_actions_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ai_admin_actions_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_training_feedback: {
        Row: {
          action_id: string
          ai_prediction: Json
          created_at: string
          created_by: string | null
          delta: number | null
          human_decision: Json
          id: string
        }
        Insert: {
          action_id: string
          ai_prediction?: Json
          created_at?: string
          created_by?: string | null
          delta?: number | null
          human_decision?: Json
          id?: string
        }
        Update: {
          action_id?: string
          ai_prediction?: Json
          created_at?: string
          created_by?: string | null
          delta?: number | null
          human_decision?: Json
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_training_feedback_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "ai_admin_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_training_feedback_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_training_feedback_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ai_training_feedback_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json | null
          new_values: Json | null
          old_values: Json | null
          resource_id: string | null
          resource_type: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          resource_id?: string | null
          resource_type: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          resource_id?: string | null
          resource_type?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_comments: {
        Row: {
          battle_id: string
          content: string
          created_at: string
          hidden_reason: string | null
          id: string
          is_hidden: boolean
          parent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          battle_id: string
          content: string
          created_at?: string
          hidden_reason?: string | null
          id?: string
          is_hidden?: boolean
          parent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          battle_id?: string
          content?: string
          created_at?: string
          hidden_reason?: string | null
          id?: string
          is_hidden?: boolean
          parent_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "battle_comments_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "battle_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battle_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_votes: {
        Row: {
          battle_id: string
          created_at: string
          id: string
          user_id: string
          voted_for_producer_id: string
        }
        Insert: {
          battle_id: string
          created_at?: string
          id?: string
          user_id: string
          voted_for_producer_id: string
        }
        Update: {
          battle_id?: string
          created_at?: string
          id?: string
          user_id?: string
          voted_for_producer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "battle_votes_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battle_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_votes_voted_for_producer_id_fkey"
            columns: ["voted_for_producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_votes_voted_for_producer_id_fkey"
            columns: ["voted_for_producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battle_votes_voted_for_producer_id_fkey"
            columns: ["voted_for_producer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      battles: {
        Row: {
          accepted_at: string | null
          admin_validated_at: string | null
          created_at: string
          custom_duration_days: number | null
          description: string | null
          extension_count: number | null
          featured: boolean
          id: string
          prize_description: string | null
          producer1_id: string
          producer2_id: string | null
          product1_id: string | null
          product2_id: string | null
          rejected_at: string | null
          rejection_reason: string | null
          response_deadline: string | null
          slug: string
          starts_at: string | null
          status: Database["public"]["Enums"]["battle_status"]
          submission_deadline: string | null
          title: string
          updated_at: string
          votes_producer1: number
          votes_producer2: number
          voting_ends_at: string | null
          winner_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          admin_validated_at?: string | null
          created_at?: string
          custom_duration_days?: number | null
          description?: string | null
          extension_count?: number | null
          featured?: boolean
          id?: string
          prize_description?: string | null
          producer1_id: string
          producer2_id?: string | null
          product1_id?: string | null
          product2_id?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          response_deadline?: string | null
          slug: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["battle_status"]
          submission_deadline?: string | null
          title: string
          updated_at?: string
          votes_producer1?: number
          votes_producer2?: number
          voting_ends_at?: string | null
          winner_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          admin_validated_at?: string | null
          created_at?: string
          custom_duration_days?: number | null
          description?: string | null
          extension_count?: number | null
          featured?: boolean
          id?: string
          prize_description?: string | null
          producer1_id?: string
          producer2_id?: string | null
          product1_id?: string | null
          product2_id?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          response_deadline?: string | null
          slug?: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["battle_status"]
          submission_deadline?: string | null
          title?: string
          updated_at?: string
          votes_producer1?: number
          votes_producer2?: number
          voting_ends_at?: string | null
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "battles_producer1_id_fkey"
            columns: ["producer1_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_producer1_id_fkey"
            columns: ["producer1_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battles_producer1_id_fkey"
            columns: ["producer1_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_producer2_id_fkey"
            columns: ["producer2_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_producer2_id_fkey"
            columns: ["producer2_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battles_producer2_id_fkey"
            columns: ["producer2_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_product1_id_fkey"
            columns: ["product1_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_product2_id_fkey"
            columns: ["product2_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battles_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          created_at: string
          id: string
          license_type: string | null
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          license_type?: string | null
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          license_type?: string | null
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          category: string
          created_at: string
          email: string | null
          id: string
          ip_address: unknown
          message: string
          name: string | null
          origin_page: string | null
          priority: string
          status: string
          subject: string
          updated_at: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: unknown
          message: string
          name?: string | null
          origin_page?: string | null
          priority?: string
          status?: string
          subject: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: unknown
          message?: string
          name?: string | null
          origin_page?: string | null
          priority?: string
          status?: string
          subject?: string
          updated_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      download_logs: {
        Row: {
          downloaded_at: string
          id: string
          ip_address: unknown
          product_id: string
          purchase_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          downloaded_at?: string
          id?: string
          ip_address?: unknown
          product_id: string
          purchase_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          downloaded_at?: string
          id?: string
          ip_address?: unknown
          product_id?: string
          purchase_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_logs_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "download_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      elite_interest: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      entitlements: {
        Row: {
          entitlement_type: Database["public"]["Enums"]["entitlement_type"]
          expires_at: string | null
          granted_at: string
          id: string
          is_active: boolean
          product_id: string
          purchase_id: string | null
          user_id: string
        }
        Insert: {
          entitlement_type: Database["public"]["Enums"]["entitlement_type"]
          expires_at?: string | null
          granted_at?: string
          id?: string
          is_active?: boolean
          product_id: string
          purchase_id?: string | null
          user_id: string
        }
        Update: {
          entitlement_type?: Database["public"]["Enums"]["entitlement_type"]
          expires_at?: string | null
          granted_at?: string
          id?: string
          is_active?: boolean
          product_id?: string
          purchase_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entitlements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exclusive_locks: {
        Row: {
          expires_at: string
          id: string
          locked_at: string
          product_id: string
          stripe_checkout_session_id: string
          user_id: string
        }
        Insert: {
          expires_at?: string
          id?: string
          locked_at?: string
          product_id: string
          stripe_checkout_session_id: string
          user_id: string
        }
        Update: {
          expires_at?: string
          id?: string
          locked_at?: string
          product_id?: string
          stripe_checkout_session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exclusive_locks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exclusive_locks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exclusive_locks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "exclusive_locks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      genres: {
        Row: {
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          name_de: string
          name_en: string
          slug: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_de: string
          name_en: string
          slug: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_de?: string
          name_en?: string
          slug?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      licenses: {
        Row: {
          created_at: string
          credit_required: boolean
          description: string | null
          exclusive_allowed: boolean
          id: string
          max_sales: number | null
          max_streams: number | null
          music_video_allowed: boolean
          name: string
          price: number
          updated_at: string
          youtube_monetization: boolean
        }
        Insert: {
          created_at?: string
          credit_required?: boolean
          description?: string | null
          exclusive_allowed?: boolean
          id?: string
          max_sales?: number | null
          max_streams?: number | null
          music_video_allowed?: boolean
          name: string
          price: number
          updated_at?: string
          youtube_monetization?: boolean
        }
        Update: {
          created_at?: string
          credit_required?: boolean
          description?: string | null
          exclusive_allowed?: boolean
          id?: string
          max_sales?: number | null
          max_streams?: number | null
          music_video_allowed?: boolean
          name?: string
          price?: number
          updated_at?: string
          youtube_monetization?: boolean
        }
        Relationships: []
      }
      monitoring_alert_events: {
        Row: {
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string
        }
        Insert: {
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          source: string
        }
        Update: {
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitoring_alert_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monitoring_alert_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "monitoring_alert_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moods: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          name_de: string
          name_en: string
          slug: string
          sort_order: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_de: string
          name_en: string
          slug: string
          sort_order?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_de?: string
          name_en?: string
          slug?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      news_videos: {
        Row: {
          broadcast_email: boolean
          broadcast_sent_at: string | null
          created_at: string
          description: string | null
          id: string
          is_published: boolean
          thumbnail_url: string | null
          title: string
          updated_at: string
          video_url: string
        }
        Insert: {
          broadcast_email?: boolean
          broadcast_sent_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_published?: boolean
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          video_url: string
        }
        Update: {
          broadcast_email?: boolean
          broadcast_sent_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_published?: boolean
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          video_url?: string
        }
        Relationships: []
      }
      notification_email_log: {
        Row: {
          category: string
          created_at: string
          dedupe_key: string
          id: string
          metadata: Json
          recipient_email: string
        }
        Insert: {
          category: string
          created_at?: string
          dedupe_key: string
          id?: string
          metadata?: Json
          recipient_email: string
        }
        Update: {
          category?: string
          created_at?: string
          dedupe_key?: string
          id?: string
          metadata?: Json
          recipient_email?: string
        }
        Relationships: []
      }
      preview_access_logs: {
        Row: {
          created_at: string
          id: string
          ip_address: unknown
          preview_type: string
          product_id: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: unknown
          preview_type: string
          product_id: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: unknown
          preview_type?: string
          product_id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "preview_access_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_access_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_access_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "preview_access_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      producer_plan_config: {
        Row: {
          amount_cents: number
          currency: string
          id: boolean
          interval: string
          stripe_price_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          currency?: string
          id?: boolean
          interval: string
          stripe_price_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          currency?: string
          id?: boolean
          interval?: string
          stripe_price_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      producer_plans: {
        Row: {
          amount_cents: number | null
          commission_rate: number
          created_at: string
          is_active: boolean
          max_battles_created_per_month: number | null
          max_beats_published: number | null
          stripe_price_id: string | null
          tier: Database["public"]["Enums"]["producer_tier_type"]
          updated_at: string
        }
        Insert: {
          amount_cents?: number | null
          commission_rate: number
          created_at?: string
          is_active?: boolean
          max_battles_created_per_month?: number | null
          max_beats_published?: number | null
          stripe_price_id?: string | null
          tier: Database["public"]["Enums"]["producer_tier_type"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number | null
          commission_rate?: number
          created_at?: string
          is_active?: boolean
          max_battles_created_per_month?: number | null
          max_beats_published?: number | null
          stripe_price_id?: string | null
          tier?: Database["public"]["Enums"]["producer_tier_type"]
          updated_at?: string
        }
        Relationships: []
      }
      producer_subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          id: string
          is_producer_active: boolean
          stripe_customer_id: string
          stripe_subscription_id: string
          subscription_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end: string
          id?: string
          is_producer_active?: boolean
          stripe_customer_id: string
          stripe_subscription_id: string
          subscription_status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          id?: string
          is_producer_active?: boolean
          stripe_customer_id?: string
          stripe_subscription_id?: string
          subscription_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_files: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          product_id: string
          sort_order: number | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          product_id: string
          sort_order?: number | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          product_id?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_files_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          bpm: number | null
          cover_image_url: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          duration_seconds: number | null
          exclusive_preview_url: string | null
          file_format: string | null
          genre_id: string | null
          id: string
          is_exclusive: boolean
          is_published: boolean
          is_sold: boolean
          key_signature: string | null
          license_terms: Json | null
          master_path: string | null
          master_url: string | null
          mood_id: string | null
          play_count: number
          preview_url: string | null
          price: number
          producer_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          slug: string
          sold_at: string | null
          sold_to_user_id: string | null
          tags: string[] | null
          title: string
          updated_at: string
          watermark_profile_id: string | null
          watermarked_path: string | null
        }
        Insert: {
          bpm?: number | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          exclusive_preview_url?: string | null
          file_format?: string | null
          genre_id?: string | null
          id?: string
          is_exclusive?: boolean
          is_published?: boolean
          is_sold?: boolean
          key_signature?: string | null
          license_terms?: Json | null
          master_path?: string | null
          master_url?: string | null
          mood_id?: string | null
          play_count?: number
          preview_url?: string | null
          price: number
          producer_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          slug: string
          sold_at?: string | null
          sold_to_user_id?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          watermark_profile_id?: string | null
          watermarked_path?: string | null
        }
        Update: {
          bpm?: number | null
          cover_image_url?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          exclusive_preview_url?: string | null
          file_format?: string | null
          genre_id?: string | null
          id?: string
          is_exclusive?: boolean
          is_published?: boolean
          is_sold?: boolean
          key_signature?: string | null
          license_terms?: Json | null
          master_path?: string | null
          master_url?: string | null
          mood_id?: string | null
          play_count?: number
          preview_url?: string | null
          price?: number
          producer_id?: string
          product_type?: Database["public"]["Enums"]["product_type"]
          slug?: string
          sold_at?: string | null
          sold_to_user_id?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          watermark_profile_id?: string | null
          watermarked_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_genre_id_fkey"
            columns: ["genre_id"]
            isOneToOne: false
            referencedRelation: "genres"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_mood_id_fkey"
            columns: ["mood_id"]
            isOneToOne: false
            referencedRelation: "moods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_sold_to_user_id_fkey"
            columns: ["sold_to_user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_sold_to_user_id_fkey"
            columns: ["sold_to_user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "products_sold_to_user_id_fkey"
            columns: ["sold_to_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_watermark_profile_id_fkey"
            columns: ["watermark_profile_id"]
            isOneToOne: false
            referencedRelation: "watermark_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount: number
          completed_at: string | null
          contract_email_sent_at: string | null
          contract_pdf_path: string | null
          created_at: string
          currency: string
          download_count: number
          download_expires_at: string | null
          id: string
          is_exclusive: boolean
          license_id: string | null
          license_type: string | null
          max_downloads: number
          metadata: Json | null
          producer_id: string
          product_id: string
          status: Database["public"]["Enums"]["purchase_status"]
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          contract_email_sent_at?: string | null
          contract_pdf_path?: string | null
          created_at?: string
          currency?: string
          download_count?: number
          download_expires_at?: string | null
          id?: string
          is_exclusive?: boolean
          license_id?: string | null
          license_type?: string | null
          max_downloads?: number
          metadata?: Json | null
          producer_id: string
          product_id: string
          status?: Database["public"]["Enums"]["purchase_status"]
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          contract_email_sent_at?: string | null
          contract_pdf_path?: string | null
          created_at?: string
          currency?: string
          download_count?: number
          download_expires_at?: string | null
          id?: string
          is_exclusive?: boolean
          license_id?: string | null
          license_type?: string | null
          max_downloads?: number
          metadata?: Json | null
          producer_id?: string
          product_id?: string
          status?: Database["public"]["Enums"]["purchase_status"]
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "licenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "purchases_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rpc_rate_limit_counters: {
        Row: {
          request_count: number
          rpc_name: string
          scope_key: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          request_count?: number
          rpc_name: string
          scope_key: string
          updated_at?: string
          window_started_at: string
        }
        Update: {
          request_count?: number
          rpc_name?: string
          scope_key?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rpc_rate_limit_counters_rpc_name_fkey"
            columns: ["rpc_name"]
            isOneToOne: false
            referencedRelation: "rpc_rate_limit_rules"
            referencedColumns: ["rpc_name"]
          },
        ]
      }
      rpc_rate_limit_hits: {
        Row: {
          allowed_per_minute: number
          context: Json
          created_at: string
          id: string
          observed_count: number
          rpc_name: string
          scope_key: string
          user_id: string | null
        }
        Insert: {
          allowed_per_minute: number
          context?: Json
          created_at?: string
          id?: string
          observed_count: number
          rpc_name: string
          scope_key: string
          user_id?: string | null
        }
        Update: {
          allowed_per_minute?: number
          context?: Json
          created_at?: string
          id?: string
          observed_count?: number
          rpc_name?: string
          scope_key?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rpc_rate_limit_hits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rpc_rate_limit_hits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rpc_rate_limit_hits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rpc_rate_limit_rules: {
        Row: {
          allowed_per_minute: number
          is_enabled: boolean
          rpc_name: string
          scope: string
          updated_at: string
        }
        Insert: {
          allowed_per_minute: number
          is_enabled?: boolean
          rpc_name: string
          scope?: string
          updated_at?: string
        }
        Update: {
          allowed_per_minute?: number
          is_enabled?: boolean
          rpc_name?: string
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          created_at: string
          data: Json
          error: string | null
          id: string
          processed: boolean
          processed_at: string | null
          processing_started_at: string | null
          type: string
        }
        Insert: {
          created_at?: string
          data: Json
          error?: string | null
          id: string
          processed?: boolean
          processed_at?: string | null
          processing_started_at?: string | null
          type: string
        }
        Update: {
          created_at?: string
          data?: Json
          error?: string | null
          id?: string
          processed?: boolean
          processed_at?: string | null
          processing_started_at?: string | null
          type?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          battle_refusal_count: number
          battles_completed: number
          battles_participated: number
          bio: string | null
          confirmed_at: string | null
          created_at: string
          email: string
          engagement_score: number
          full_name: string | null
          id: string
          is_confirmed: boolean
          is_producer_active: boolean
          language: string | null
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          producer_verified_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          social_links: Json | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          total_purchases: number
          updated_at: string
          username: string | null
          website_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          battle_refusal_count?: number
          battles_completed?: number
          battles_participated?: number
          bio?: string | null
          confirmed_at?: string | null
          created_at?: string
          email: string
          engagement_score?: number
          full_name?: string | null
          id: string
          is_confirmed?: boolean
          is_producer_active?: boolean
          language?: string | null
          producer_tier?: Database["public"]["Enums"]["producer_tier_type"]
          producer_verified_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          social_links?: Json | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          total_purchases?: number
          updated_at?: string
          username?: string | null
          website_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          battle_refusal_count?: number
          battles_completed?: number
          battles_participated?: number
          bio?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string
          engagement_score?: number
          full_name?: string | null
          id?: string
          is_confirmed?: boolean
          is_producer_active?: boolean
          language?: string | null
          producer_tier?: Database["public"]["Enums"]["producer_tier_type"]
          producer_verified_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          social_links?: Json | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?:
            | Database["public"]["Enums"]["subscription_status"]
            | null
          total_purchases?: number
          updated_at?: string
          username?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      v_days: {
        Row: {
          coalesce: number | null
        }
        Insert: {
          coalesce?: number | null
        }
        Update: {
          coalesce?: number | null
        }
        Relationships: []
      }
      watermark_profiles: {
        Row: {
          beep_duration_ms: number | null
          beep_frequency_hz: number | null
          created_at: string
          enabled: boolean
          gain_db: number | null
          id: string
          name: string
          overlay_audio_path: string | null
          repeat_every_ms: number | null
          updated_at: string
          voice_tag_text: string | null
        }
        Insert: {
          beep_duration_ms?: number | null
          beep_frequency_hz?: number | null
          created_at?: string
          enabled?: boolean
          gain_db?: number | null
          id?: string
          name: string
          overlay_audio_path?: string | null
          repeat_every_ms?: number | null
          updated_at?: string
          voice_tag_text?: string | null
        }
        Update: {
          beep_duration_ms?: number | null
          beep_frequency_hz?: number | null
          created_at?: string
          enabled?: boolean
          gain_db?: number | null
          id?: string
          name?: string
          overlay_audio_path?: string | null
          repeat_every_ms?: number | null
          updated_at?: string
          voice_tag_text?: string | null
        }
        Relationships: []
      }
      wishlists: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlists_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "wishlists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      my_user_profile: {
        Row: {
          avatar_url: string | null
          battle_refusal_count: number | null
          battles_completed: number | null
          battles_participated: number | null
          bio: string | null
          confirmed_at: string | null
          created_at: string | null
          engagement_score: number | null
          full_name: string | null
          id: string | null
          is_producer_active: boolean | null
          language: string | null
          producer_tier:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          producer_verified_at: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          social_links: Json | null
          total_purchases: number | null
          updated_at: string | null
          user_id: string | null
          username: string | null
          website_url: string | null
        }
        Insert: {
          avatar_url?: string | null
          battle_refusal_count?: number | null
          battles_completed?: number | null
          battles_participated?: number | null
          bio?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          engagement_score?: number | null
          full_name?: string | null
          id?: string | null
          is_producer_active?: boolean | null
          language?: string | null
          producer_tier?:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          producer_verified_at?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          social_links?: Json | null
          total_purchases?: number | null
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
          website_url?: string | null
        }
        Update: {
          avatar_url?: string | null
          battle_refusal_count?: number | null
          battles_completed?: number | null
          battles_participated?: number | null
          bio?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          engagement_score?: number | null
          full_name?: string | null
          id?: string | null
          is_producer_active?: boolean | null
          language?: string | null
          producer_tier?:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          producer_verified_at?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          social_links?: Json | null
          total_purchases?: number | null
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      producer_stats: {
        Row: {
          producer_id: string | null
          published_products: number | null
          total_plays: number | null
          total_products: number | null
          total_revenue: number | null
          total_sales: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_producer_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          producer_tier:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          social_links: Json | null
          updated_at: string | null
          user_id: string | null
          username: string | null
        }
        Relationships: []
      }
      public_producer_profiles_v2: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          producer_tier:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          social_links: Json | null
          updated_at: string | null
          user_id: string | null
          username: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_cancel_battle: { Args: { p_battle_id: string }; Returns: boolean }
      admin_extend_battle_duration: {
        Args: { p_battle_id: string; p_days: number; p_reason?: string }
        Returns: boolean
      }
      admin_validate_battle: { Args: { p_battle_id: string }; Returns: boolean }
      agent_finalize_expired_battles: {
        Args: { p_limit?: number }
        Returns: number
      }
      can_access_exclusive_preview: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      can_create_battle: { Args: { p_user_id: string }; Returns: boolean }
      can_create_product: { Args: { p_user_id: string }; Returns: boolean }
      can_publish_beat: {
        Args: { p_exclude_product_id?: string; p_user_id: string }
        Returns: boolean
      }
      check_rpc_rate_limit: {
        Args: { p_rpc_name: string; p_user_id: string }
        Returns: boolean
      }
      check_stripe_event_processed: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      claim_notification_email_send: {
        Args: {
          p_category: string
          p_dedupe_key: string
          p_metadata?: Json
          p_rate_limit_seconds?: number
          p_recipient_email: string
        }
        Returns: Json
      }
      classify_battle_comment_rule_based: {
        Args: { p_content: string }
        Returns: Json
      }
      cleanup_expired_exclusive_locks: { Args: never; Returns: undefined }
      cleanup_rpc_rate_limit_counters: {
        Args: { p_keep_hours?: number }
        Returns: number
      }
      complete_exclusive_purchase: {
        Args: {
          p_amount: number
          p_checkout_session_id: string
          p_payment_intent_id: string
          p_product_id: string
          p_user_id: string
        }
        Returns: string
      }
      complete_license_purchase: {
        Args: {
          p_amount: number
          p_checkout_session_id: string
          p_license_id: string
          p_payment_intent_id: string
          p_product_id: string
          p_user_id: string
        }
        Returns: string
      }
      complete_standard_purchase: {
        Args: {
          p_amount: number
          p_checkout_session_id: string
          p_license_type?: string
          p_payment_intent_id: string
          p_product_id: string
          p_user_id: string
        }
        Returns: string
      }
      create_exclusive_lock: {
        Args: {
          p_checkout_session_id: string
          p_product_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      detect_admin_action_anomalies: {
        Args: { p_lookback_minutes?: number }
        Returns: number
      }
      finalize_battle: { Args: { p_battle_id: string }; Returns: string }
      finalize_expired_battles: { Args: { p_limit?: number }; Returns: number }
      get_admin_business_metrics: { Args: never; Returns: Json }
      get_admin_metrics_timeseries: { Args: never; Returns: Json }
      get_admin_pilotage_deltas: { Args: never; Returns: Json }
      get_admin_pilotage_metrics: { Args: never; Returns: Json }
      get_advanced_producer_stats: {
        Args: never
        Returns: {
          completed_sales: number
          monthly_battles_created: number
          published_beats: number
          revenue_cents: number
          sales_per_published_beat: number
        }[]
      }
      get_home_stats: { Args: never; Returns: Json }
      get_plan_limits: {
        Args: { p_tier: Database["public"]["Enums"]["producer_tier_type"] }
        Returns: {
          commission_rate: number
          is_active: boolean
          max_battles_created_per_month: number
          max_beats_published: number
          stripe_price_id: string
        }[]
      }
      get_producer_tier: {
        Args: { p_user_id: string }
        Returns: Database["public"]["Enums"]["producer_tier_type"]
      }
      get_public_producer_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          bio: string
          created_at: string
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          social_links: Json
          updated_at: string
          user_id: string
          username: string
        }[]
      }
      get_public_producer_profiles_v2: {
        Args: never
        Returns: {
          avatar_url: string
          bio: string
          created_at: string
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          social_links: Json
          updated_at: string
          user_id: string
          username: string
        }[]
      }
      get_request_headers_jsonb: { Args: never; Returns: Json }
      has_producer_tier: {
        Args: {
          p_min_tier: Database["public"]["Enums"]["producer_tier_type"]
          p_user_id: string
        }
        Returns: boolean
      }
      increment_play_count: {
        Args: { p_product_id: string }
        Returns: undefined
      }
      is_active_producer: { Args: { p_user?: string }; Returns: boolean }
      is_admin: { Args: { p_user_id?: string }; Returns: boolean }
      is_confirmed_user: { Args: { p_user_id?: string }; Returns: boolean }
      is_email_verified_user: { Args: { p_user_id?: string }; Returns: boolean }
      log_admin_action_audit: {
        Args: {
          p_action_type?: string
          p_admin_user_id?: string
          p_context?: Json
          p_entity_id?: string
          p_entity_type?: string
          p_error?: string
          p_extra_details?: Json
          p_source?: string
          p_source_action_id?: string
          p_success?: boolean
        }
        Returns: string
      }
      log_audit_event: {
        Args: {
          p_action: string
          p_ip_address?: unknown
          p_metadata?: Json
          p_new_values?: Json
          p_old_values?: Json
          p_resource_id?: string
          p_resource_type: string
          p_user_agent?: string
          p_user_id: string
        }
        Returns: string
      }
      log_monitoring_alert: {
        Args: {
          p_details?: Json
          p_entity_id?: string
          p_entity_type?: string
          p_event_type: string
          p_severity?: string
          p_source?: string
        }
        Returns: string
      }
      log_preview_access: {
        Args: {
          p_ip_address?: unknown
          p_preview_type: string
          p_product_id: string
          p_user_agent?: string
          p_user_id: string
        }
        Returns: undefined
      }
      mark_stripe_event_processed: {
        Args: { p_error?: string; p_event_id: string }
        Returns: undefined
      }
      producer_publish_battle: {
        Args: { p_battle_id: string }
        Returns: boolean
      }
      producer_start_battle_voting: {
        Args: { p_battle_id: string; p_voting_duration_hours?: number }
        Returns: boolean
      }
      producer_tier_rank: {
        Args: { p_tier: Database["public"]["Enums"]["producer_tier_type"] }
        Returns: number
      }
      recalculate_engagement: { Args: { p_user_id: string }; Returns: number }
      record_battle_vote: {
        Args: {
          p_battle_id: string
          p_user_id: string
          p_voted_for_producer_id: string
        }
        Returns: boolean
      }
      respond_to_battle: {
        Args: { p_accept: boolean; p_battle_id: string; p_reason?: string }
        Returns: boolean
      }
      should_flag_battle_refusal_risk: {
        Args: { p_threshold?: number; p_user_id: string }
        Returns: boolean
      }
      user_has_entitlement: {
        Args: { p_product_id: string; p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      battle_status:
        | "pending"
        | "active"
        | "voting"
        | "completed"
        | "cancelled"
        | "pending_acceptance"
        | "rejected"
        | "awaiting_admin"
        | "approved"
      entitlement_type: "purchase" | "subscription" | "promo" | "admin_grant"
      producer_tier_type: "starter" | "pro" | "elite"
      product_type: "beat" | "exclusive" | "kit"
      purchase_status: "pending" | "completed" | "failed" | "refunded"
      subscription_status:
        | "active"
        | "canceled"
        | "past_due"
        | "trialing"
        | "unpaid"
        | "incomplete"
        | "incomplete_expired"
        | "paused"
      user_role: "visitor" | "user" | "confirmed_user" | "producer" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      battle_status: [
        "pending",
        "active",
        "voting",
        "completed",
        "cancelled",
        "pending_acceptance",
        "rejected",
        "awaiting_admin",
        "approved",
      ],
      entitlement_type: ["purchase", "subscription", "promo", "admin_grant"],
      producer_tier_type: ["starter", "pro", "elite"],
      product_type: ["beat", "exclusive", "kit"],
      purchase_status: ["pending", "completed", "failed", "refunded"],
      subscription_status: [
        "active",
        "canceled",
        "past_due",
        "trialing",
        "unpaid",
        "incomplete",
        "incomplete_expired",
        "paused",
      ],
      user_role: ["visitor", "user", "confirmed_user", "producer", "admin"],
    },
  },
} as const
