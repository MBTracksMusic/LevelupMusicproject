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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
          {
            foreignKeyName: "admin_action_audit_log_admin_user_id_fkey"
            columns: ["admin_user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
          {
            foreignKeyName: "admin_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
          {
            foreignKeyName: "ai_admin_actions_executed_by_fkey"
            columns: ["executed_by"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
          {
            foreignKeyName: "ai_training_feedback_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
      audio_processing_jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          product_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          product_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          product_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audio_processing_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_processing_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_processing_jobs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            referencedRelation: "battle_of_the_day"
            referencedColumns: ["battle_id"]
          },
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
          {
            foreignKeyName: "battle_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      battle_product_snapshots: {
        Row: {
          battle_id: string
          created_at: string
          id: string
          preview_url_snapshot: string | null
          producer_id: string | null
          product_id: string | null
          slot: string
          title_snapshot: string | null
          updated_at: string
        }
        Insert: {
          battle_id: string
          created_at?: string
          id?: string
          preview_url_snapshot?: string | null
          producer_id?: string | null
          product_id?: string | null
          slot: string
          title_snapshot?: string | null
          updated_at?: string
        }
        Update: {
          battle_id?: string
          created_at?: string
          id?: string
          preview_url_snapshot?: string | null
          producer_id?: string | null
          product_id?: string | null
          slot?: string
          title_snapshot?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "battle_product_snapshots_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battle_of_the_day"
            referencedColumns: ["battle_id"]
          },
          {
            foreignKeyName: "battle_product_snapshots_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_product_snapshots_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_product_snapshots_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battle_product_snapshots_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_product_snapshots_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battle_product_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_product_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_product_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_quality_snapshots: {
        Row: {
          artistic_score: number
          battle_id: string
          coherence_score: number
          computed_at: string
          created_at: string
          credibility_score: number
          id: string
          meta: Json
          preference_score: number
          product_id: string
          quality_index: number
          updated_at: string
          votes_for_product: number
          votes_total: number
          win_rate: number
        }
        Insert: {
          artistic_score?: number
          battle_id: string
          coherence_score?: number
          computed_at?: string
          created_at?: string
          credibility_score?: number
          id?: string
          meta?: Json
          preference_score?: number
          product_id: string
          quality_index?: number
          updated_at?: string
          votes_for_product?: number
          votes_total?: number
          win_rate?: number
        }
        Update: {
          artistic_score?: number
          battle_id?: string
          coherence_score?: number
          computed_at?: string
          created_at?: string
          credibility_score?: number
          id?: string
          meta?: Json
          preference_score?: number
          product_id?: string
          quality_index?: number
          updated_at?: string
          votes_for_product?: number
          votes_total?: number
          win_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "battle_quality_snapshots_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battle_of_the_day"
            referencedColumns: ["battle_id"]
          },
          {
            foreignKeyName: "battle_quality_snapshots_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_quality_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_quality_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_quality_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_vote_feedback: {
        Row: {
          battle_id: string
          created_at: string
          criterion: string
          id: string
          user_id: string
          vote_id: string
          winner_product_id: string
        }
        Insert: {
          battle_id: string
          created_at?: string
          criterion: string
          id?: string
          user_id: string
          vote_id: string
          winner_product_id: string
        }
        Update: {
          battle_id?: string
          created_at?: string
          criterion?: string
          id?: string
          user_id?: string
          vote_id?: string
          winner_product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "battle_vote_feedback_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battle_of_the_day"
            referencedColumns: ["battle_id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_vote_id_fkey"
            columns: ["vote_id"]
            isOneToOne: false
            referencedRelation: "battle_votes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["winner_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["winner_product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["winner_product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
            referencedRelation: "battle_of_the_day"
            referencedColumns: ["battle_id"]
          },
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
            foreignKeyName: "battle_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
          {
            foreignKeyName: "battle_votes_voted_for_producer_id_fkey"
            columns: ["voted_for_producer_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "battles_producer1_id_fkey"
            columns: ["producer1_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "battles_producer2_id_fkey"
            columns: ["producer2_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "battles_product1_id_fkey"
            columns: ["product1_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_product1_id_fkey"
            columns: ["product1_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_product1_id_fkey"
            columns: ["product1_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
            foreignKeyName: "battles_product2_id_fkey"
            columns: ["product2_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battles_product2_id_fkey"
            columns: ["product2_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
          {
            foreignKeyName: "battles_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      competitive_seasons: {
        Row: {
          created_at: string
          end_date: string
          id: string
          is_active: boolean
          name: string
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          is_active?: boolean
          name: string
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          is_active?: boolean
          name?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: []
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
      contact_submit_rate_limit: {
        Row: {
          counter: number
          ip_hash: string
          updated_at: string
          window_start: string
        }
        Insert: {
          counter?: number
          ip_hash: string
          updated_at?: string
          window_start: string
        }
        Update: {
          counter?: number
          ip_hash?: string
          updated_at?: string
          window_start?: string
        }
        Relationships: []
      }
      contract_generation_jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          next_run_at: string
          purchase_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_run_at?: string
          purchase_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_run_at?: string
          purchase_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_generation_jobs_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_url_rate_limit_counters: {
        Row: {
          purchase_id: string
          request_count: number
          updated_at: string
          user_id: string
          window_started_at: string
        }
        Insert: {
          purchase_id: string
          request_count?: number
          updated_at?: string
          user_id: string
          window_started_at: string
        }
        Update: {
          purchase_id?: string
          request_count?: number
          updated_at?: string
          user_id?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_url_rate_limit_counters_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "download_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
          {
            foreignKeyName: "download_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "entitlements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entitlements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
          {
            foreignKeyName: "entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "exclusive_locks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exclusive_locks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "public_products"
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
          {
            foreignKeyName: "exclusive_locks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      forum_assistant_jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          idempotency_key: string
          processed_at: string | null
          source_post_id: string | null
          status: string
          topic_id: string
          trigger_type: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key: string
          processed_at?: string | null
          source_post_id?: string | null
          status?: string
          topic_id: string
          trigger_type: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          processed_at?: string | null
          source_post_id?: string | null
          status?: string
          topic_id?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_assistant_jobs_source_post_id_fkey"
            columns: ["source_post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_assistant_jobs_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_categories: {
        Row: {
          allow_links: boolean
          allow_media: boolean
          created_at: string
          description: string | null
          id: string
          is_competitive: boolean
          is_premium_only: boolean
          moderation_strictness: string
          name: string
          position: number
          required_rank_tier: string | null
          slug: string
          xp_multiplier: number
        }
        Insert: {
          allow_links?: boolean
          allow_media?: boolean
          created_at?: string
          description?: string | null
          id?: string
          is_competitive?: boolean
          is_premium_only?: boolean
          moderation_strictness?: string
          name: string
          position?: number
          required_rank_tier?: string | null
          slug: string
          xp_multiplier?: number
        }
        Update: {
          allow_links?: boolean
          allow_media?: boolean
          created_at?: string
          description?: string | null
          id?: string
          is_competitive?: boolean
          is_premium_only?: boolean
          moderation_strictness?: string
          name?: string
          position?: number
          required_rank_tier?: string | null
          slug?: string
          xp_multiplier?: number
        }
        Relationships: []
      }
      forum_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "forum_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      forum_moderation_logs: {
        Row: {
          created_at: string
          decision: string
          id: string
          model: string | null
          post_id: string | null
          raw_response: Json
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
          source: string
          topic_id: string | null
        }
        Insert: {
          created_at?: string
          decision: string
          id?: string
          model?: string | null
          post_id?: string | null
          raw_response?: Json
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          source: string
          topic_id?: string | null
        }
        Update: {
          created_at?: string
          decision?: string
          id?: string
          model?: string | null
          post_id?: string | null
          raw_response?: Json
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          source?: string
          topic_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forum_moderation_logs_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_moderation_logs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_moderation_logs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "forum_moderation_logs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_moderation_logs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "forum_moderation_logs_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      forum_post_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_post_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "forum_post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_post_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      forum_posts: {
        Row: {
          ai_agent_name: string | null
          content: string
          created_at: string
          edited_at: string | null
          id: string
          is_ai_generated: boolean
          is_deleted: boolean
          is_flagged: boolean
          is_visible: boolean
          moderated_at: string | null
          moderation_model: string | null
          moderation_reason: string | null
          moderation_score: number | null
          moderation_status: string
          source_post_id: string | null
          topic_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_agent_name?: string | null
          content: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_ai_generated?: boolean
          is_deleted?: boolean
          is_flagged?: boolean
          is_visible?: boolean
          moderated_at?: string | null
          moderation_model?: string | null
          moderation_reason?: string | null
          moderation_score?: number | null
          moderation_status?: string
          source_post_id?: string | null
          topic_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_agent_name?: string | null
          content?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          is_ai_generated?: boolean
          is_deleted?: boolean
          is_flagged?: boolean
          is_visible?: boolean
          moderated_at?: string | null
          moderation_model?: string | null
          moderation_reason?: string | null
          moderation_score?: number | null
          moderation_status?: string
          source_post_id?: string | null
          topic_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_posts_source_post_id_fkey"
            columns: ["source_post_id"]
            isOneToOne: false
            referencedRelation: "forum_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "forum_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "forum_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      forum_topics: {
        Row: {
          category_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_deleted: boolean
          is_locked: boolean
          is_pinned: boolean
          last_ai_reply_at: string | null
          last_post_at: string
          post_count: number
          slug: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_deleted?: boolean
          is_locked?: boolean
          is_pinned?: boolean
          last_ai_reply_at?: string | null
          last_post_at?: string
          post_count?: number
          slug: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_deleted?: boolean
          is_locked?: boolean
          is_pinned?: boolean
          last_ai_reply_at?: string | null
          last_post_at?: string
          post_count?: number
          slug?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "forum_topics_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "forum_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_topics_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_topics_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "forum_topics_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_topics_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "forum_topics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_topics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "forum_topics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forum_topics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      fraud_events: {
        Row: {
          battle_id: string | null
          created_at: string
          event_type: string
          id: string
          ip_hash: string | null
          post_id: string | null
          ua_hash: string | null
          user_id: string | null
        }
        Insert: {
          battle_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          ip_hash?: string | null
          post_id?: string | null
          ua_hash?: string | null
          user_id?: string | null
        }
        Update: {
          battle_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          ip_hash?: string | null
          post_id?: string | null
          ua_hash?: string | null
          user_id?: string | null
        }
        Relationships: []
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
          {
            foreignKeyName: "monitoring_alert_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
      play_events: {
        Row: {
          dedupe_bucket: string
          id: string
          played_at: string
          product_id: string
          user_id: string
        }
        Insert: {
          dedupe_bucket: string
          id?: string
          played_at?: string
          product_id: string
          user_id: string
        }
        Update: {
          dedupe_bucket?: string
          id?: string
          played_at?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "play_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "play_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "play_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
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
            foreignKeyName: "preview_access_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_access_logs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
          {
            foreignKeyName: "preview_access_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      producer_badges: {
        Row: {
          condition_type: string
          condition_value: number
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          condition_type: string
          condition_value: number
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          condition_type?: string
          condition_value?: number
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
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
          {
            foreignKeyName: "product_files_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_files_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
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
          last_watermark_hash: string | null
          license_terms: Json | null
          master_path: string | null
          master_url: string | null
          mood_id: string | null
          original_beat_id: string | null
          parent_product_id: string | null
          play_count: number
          preview_signature: string | null
          preview_url: string | null
          preview_version: number
          price: number
          processed_at: string | null
          processing_error: string | null
          processing_status: string
          producer_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          slug: string
          sold_at: string | null
          sold_to_user_id: string | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string
          version: number
          version_number: number
          watermark_profile_id: string | null
          watermarked_bucket: string | null
          watermarked_path: string | null
        }
        Insert: {
          archived_at?: string | null
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
          last_watermark_hash?: string | null
          license_terms?: Json | null
          master_path?: string | null
          master_url?: string | null
          mood_id?: string | null
          original_beat_id?: string | null
          parent_product_id?: string | null
          play_count?: number
          preview_signature?: string | null
          preview_url?: string | null
          preview_version?: number
          price: number
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: string
          producer_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          slug: string
          sold_at?: string | null
          sold_to_user_id?: string | null
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string
          version?: number
          version_number?: number
          watermark_profile_id?: string | null
          watermarked_bucket?: string | null
          watermarked_path?: string | null
        }
        Update: {
          archived_at?: string | null
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
          last_watermark_hash?: string | null
          license_terms?: Json | null
          master_path?: string | null
          master_url?: string | null
          mood_id?: string | null
          original_beat_id?: string | null
          parent_product_id?: string | null
          play_count?: number
          preview_signature?: string | null
          preview_url?: string | null
          preview_version?: number
          price?: number
          processed_at?: string | null
          processing_error?: string | null
          processing_status?: string
          producer_id?: string
          product_type?: Database["public"]["Enums"]["product_type"]
          slug?: string
          sold_at?: string | null
          sold_to_user_id?: string | null
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          version?: number
          version_number?: number
          watermark_profile_id?: string | null
          watermarked_bucket?: string | null
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
            foreignKeyName: "products_original_beat_id_fkey"
            columns: ["original_beat_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_original_beat_id_fkey"
            columns: ["original_beat_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_original_beat_id_fkey"
            columns: ["original_beat_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_parent_product_id_fkey"
            columns: ["parent_product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "products_sold_to_user_id_fkey"
            columns: ["sold_to_user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
          audio_path_snapshot: string | null
          beat_slug_snapshot: string | null
          beat_title_snapshot: string | null
          beat_version_snapshot: number | null
          completed_at: string | null
          contract_email_sent_at: string | null
          contract_generated_at: string | null
          contract_generated_by: string | null
          contract_pdf_path: string | null
          cover_image_url_snapshot: string | null
          created_at: string
          currency: string
          currency_snapshot: string | null
          download_count: number
          download_expires_at: string | null
          id: string
          is_exclusive: boolean
          license_id: string | null
          license_name_snapshot: string | null
          license_type: string | null
          license_type_snapshot: string | null
          max_downloads: number
          metadata: Json | null
          price_snapshot: number | null
          producer_display_name_snapshot: string | null
          producer_id: string
          product_id: string
          status: Database["public"]["Enums"]["purchase_status"]
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          audio_path_snapshot?: string | null
          beat_slug_snapshot?: string | null
          beat_title_snapshot?: string | null
          beat_version_snapshot?: number | null
          completed_at?: string | null
          contract_email_sent_at?: string | null
          contract_generated_at?: string | null
          contract_generated_by?: string | null
          contract_pdf_path?: string | null
          cover_image_url_snapshot?: string | null
          created_at?: string
          currency?: string
          currency_snapshot?: string | null
          download_count?: number
          download_expires_at?: string | null
          id?: string
          is_exclusive?: boolean
          license_id?: string | null
          license_name_snapshot?: string | null
          license_type?: string | null
          license_type_snapshot?: string | null
          max_downloads?: number
          metadata?: Json | null
          price_snapshot?: number | null
          producer_display_name_snapshot?: string | null
          producer_id: string
          product_id: string
          status?: Database["public"]["Enums"]["purchase_status"]
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          audio_path_snapshot?: string | null
          beat_slug_snapshot?: string | null
          beat_title_snapshot?: string | null
          beat_version_snapshot?: number | null
          completed_at?: string | null
          contract_email_sent_at?: string | null
          contract_generated_at?: string | null
          contract_generated_by?: string | null
          contract_pdf_path?: string | null
          cover_image_url_snapshot?: string | null
          created_at?: string
          currency?: string
          currency_snapshot?: string | null
          download_count?: number
          download_expires_at?: string | null
          id?: string
          is_exclusive?: boolean
          license_id?: string | null
          license_name_snapshot?: string | null
          license_type?: string | null
          license_type_snapshot?: string | null
          max_downloads?: number
          metadata?: Json | null
          price_snapshot?: number | null
          producer_display_name_snapshot?: string | null
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
            foreignKeyName: "purchases_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
          {
            foreignKeyName: "purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reputation_events: {
        Row: {
          created_at: string
          delta_xp: number
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          idempotency_key: string | null
          metadata: Json | null
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delta_xp: number
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          delta_xp?: number
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reputation_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reputation_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reputation_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reputation_rules: {
        Row: {
          cooldown_sec: number
          created_at: string
          delta_xp: number
          event_type: string
          is_enabled: boolean
          key: string
          max_per_day: number | null
          source: string
          updated_at: string
        }
        Insert: {
          cooldown_sec?: number
          created_at?: string
          delta_xp: number
          event_type: string
          is_enabled?: boolean
          key: string
          max_per_day?: number | null
          source: string
          updated_at?: string
        }
        Update: {
          cooldown_sec?: number
          created_at?: string
          delta_xp?: number
          event_type?: string
          is_enabled?: boolean
          key?: string
          max_per_day?: number | null
          source?: string
          updated_at?: string
        }
        Relationships: []
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
          {
            foreignKeyName: "rpc_rate_limit_hits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
      season_results: {
        Row: {
          created_at: string
          final_elo: number
          losses: number
          rank_position: number
          season_id: string
          user_id: string
          wins: number
        }
        Insert: {
          created_at?: string
          final_elo: number
          losses?: number
          rank_position: number
          season_id: string
          user_id: string
          wins?: number
        }
        Update: {
          created_at?: string
          final_elo?: number
          losses?: number
          rank_position?: number
          season_id?: string
          user_id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "season_results_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "competitive_seasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_results_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "season_leaderboard"
            referencedColumns: ["season_id"]
          },
          {
            foreignKeyName: "season_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "season_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "season_results_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      site_audio_settings: {
        Row: {
          created_at: string
          enabled: boolean
          gain_db: number
          id: string
          max_interval_sec: number
          min_interval_sec: number
          updated_at: string
          watermark_audio_path: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          gain_db?: number
          id?: string
          max_interval_sec?: number
          min_interval_sec?: number
          updated_at?: string
          watermark_audio_path?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          gain_db?: number
          id?: string
          max_interval_sec?: number
          min_interval_sec?: number
          updated_at?: string
          watermark_audio_path?: string | null
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
      user_badges: {
        Row: {
          badge_id: string
          earned_at: string
          user_id: string
        }
        Insert: {
          badge_id: string
          earned_at?: string
          user_id: string
        }
        Update: {
          badge_id?: string
          earned_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "producer_badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_music_preferences: {
        Row: {
          criterion: string
          score: number
          updated_at: string
          user_id: string
        }
        Insert: {
          criterion: string
          score?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          criterion?: string
          score?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_music_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_music_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_music_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_music_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          battle_draws: number
          battle_losses: number
          battle_refusal_count: number
          battle_wins: number
          battles_completed: number
          battles_participated: number
          bio: string | null
          confirmed_at: string | null
          created_at: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_label: string | null
          elo_rating: number
          email: string
          engagement_score: number
          full_name: string | null
          id: string
          is_confirmed: boolean
          is_deleted: boolean
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
          battle_draws?: number
          battle_losses?: number
          battle_refusal_count?: number
          battle_wins?: number
          battles_completed?: number
          battles_participated?: number
          bio?: string | null
          confirmed_at?: string | null
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_label?: string | null
          elo_rating?: number
          email: string
          engagement_score?: number
          full_name?: string | null
          id: string
          is_confirmed?: boolean
          is_deleted?: boolean
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
          battle_draws?: number
          battle_losses?: number
          battle_refusal_count?: number
          battle_wins?: number
          battles_completed?: number
          battles_participated?: number
          bio?: string | null
          confirmed_at?: string | null
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_label?: string | null
          elo_rating?: number
          email?: string
          engagement_score?: number
          full_name?: string | null
          id?: string
          is_confirmed?: boolean
          is_deleted?: boolean
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
      user_reputation: {
        Row: {
          battle_xp: number
          commerce_xp: number
          created_at: string
          forum_xp: number
          last_event_at: string | null
          level: number
          rank_tier: string
          reputation_score: number
          updated_at: string
          user_id: string
          xp: number
        }
        Insert: {
          battle_xp?: number
          commerce_xp?: number
          created_at?: string
          forum_xp?: number
          last_event_at?: string | null
          level?: number
          rank_tier?: string
          reputation_score?: number
          updated_at?: string
          user_id: string
          xp?: number
        }
        Update: {
          battle_xp?: number
          commerce_xp?: number
          created_at?: string
          forum_xp?: number
          last_event_at?: string | null
          level?: number
          rank_tier?: string
          reputation_score?: number
          updated_at?: string
          user_id?: string
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_reputation_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "my_user_profile"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reputation_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "my_user_profile"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_reputation_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_reputation_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
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
            foreignKeyName: "wishlists_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlists_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
          {
            foreignKeyName: "wishlists_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      admin_battle_quality_latest: {
        Row: {
          artistic_score: number | null
          battle_id: string | null
          battle_slug: string | null
          battle_status: Database["public"]["Enums"]["battle_status"] | null
          battle_title: string | null
          coherence_score: number | null
          computed_at: string | null
          credibility_score: number | null
          meta: Json | null
          preference_score: number | null
          producer_id: string | null
          producer_username: string | null
          product_id: string | null
          product_title: string | null
          quality_index: number | null
          updated_at: string | null
          votes_for_product: number | null
          votes_total: number | null
          win_rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "battle_quality_snapshots_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battle_of_the_day"
            referencedColumns: ["battle_id"]
          },
          {
            foreignKeyName: "battle_quality_snapshots_battle_id_fkey"
            columns: ["battle_id"]
            isOneToOne: false
            referencedRelation: "battles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_quality_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_quality_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_quality_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
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
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_beat_feedback_scores: {
        Row: {
          identity_score: number | null
          melody_score: number | null
          mix_score: number | null
          product_id: string | null
          rhythm_score: number | null
          sound_design_score: number | null
          structure_score: number | null
          total_feedback: number | null
        }
        Relationships: [
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_beat_feedback_top_criteria: {
        Row: {
          criterion: string | null
          criterion_count: number | null
          product_id: string | null
          rank: number | null
        }
        Relationships: [
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "battle_vote_feedback_winner_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "public_products"
            referencedColumns: ["id"]
          },
        ]
      }
      battle_fraud_analysis: {
        Row: {
          battle_id: string | null
          suspicious_by_ip: number | null
          unique_ip_hashes: number | null
          unique_ua_hashes: number | null
          vote_events: number | null
        }
        Relationships: []
      }
      battle_of_the_day: {
        Row: {
          battle_id: string | null
          producer1_id: string | null
          producer1_username: string | null
          producer2_id: string | null
          producer2_username: string | null
          slug: string | null
          status: Database["public"]["Enums"]["battle_status"] | null
          title: string | null
          votes_today: number | null
          votes_total: number | null
          winner_id: string | null
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
            foreignKeyName: "battles_producer1_id_fkey"
            columns: ["producer1_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "battles_producer2_id_fkey"
            columns: ["producer2_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
          {
            foreignKeyName: "battles_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      forum_public_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          level: number | null
          producer_tier:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          rank_tier: string | null
          reputation_score: number | null
          updated_at: string | null
          user_id: string | null
          username: string | null
          xp: number | null
        }
        Relationships: []
      }
      leaderboard_producers: {
        Row: {
          avatar_url: string | null
          battle_draws: number | null
          battle_losses: number | null
          battle_wins: number | null
          elo_rating: number | null
          producer_tier:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          rank_position: number | null
          total_battles: number | null
          user_id: string | null
          username: string | null
          win_rate: number | null
        }
        Relationships: []
      }
      my_user_profile: {
        Row: {
          avatar_url: string | null
          battle_refusal_count: number | null
          battles_completed: number | null
          battles_participated: number | null
          bio: string | null
          confirmed_at: string | null
          created_at: string | null
          delete_reason: string | null
          deleted_at: string | null
          deleted_label: string | null
          engagement_score: number | null
          full_name: string | null
          id: string | null
          is_deleted: boolean | null
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
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_label?: string | null
          engagement_score?: number | null
          full_name?: string | null
          id?: string | null
          is_deleted?: boolean | null
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
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_label?: string | null
          engagement_score?: number | null
          full_name?: string | null
          id?: string | null
          is_deleted?: boolean | null
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
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      products_public: {
        Row: {
          id: string | null
          price: number | null
          status: string | null
          title: string | null
        }
        Insert: {
          id?: string | null
          price?: number | null
          status?: string | null
          title?: string | null
        }
        Update: {
          id?: string | null
          price?: number | null
          status?: string | null
          title?: string | null
        }
        Relationships: []
      }
      public_producer_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          is_deleted: boolean | null
          is_producer_active: boolean | null
          level: number | null
          producer_tier:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          raw_username: string | null
          rank_tier: string | null
          reputation_score: number | null
          social_links: Json | null
          updated_at: string | null
          user_id: string | null
          username: string | null
          xp: number | null
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
      public_products: {
        Row: {
          bpm: number | null
          cover_image_url: string | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          duration_seconds: number | null
          exclusive_preview_url: string | null
          file_format: string | null
          genre_id: string | null
          id: string | null
          is_exclusive: boolean | null
          is_published: boolean | null
          is_sold: boolean | null
          key_signature: string | null
          license_terms: Json | null
          mood_id: string | null
          play_count: number | null
          preview_url: string | null
          price: number | null
          producer_id: string | null
          product_type: Database["public"]["Enums"]["product_type"] | null
          slug: string | null
          sold_at: string | null
          sold_to_user_id: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
          watermark_profile_id: string | null
          watermarked_path: string | null
        }
        Insert: {
          bpm?: number | null
          cover_image_url?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          exclusive_preview_url?: string | null
          file_format?: string | null
          genre_id?: string | null
          id?: string | null
          is_exclusive?: boolean | null
          is_published?: boolean | null
          is_sold?: boolean | null
          key_signature?: string | null
          license_terms?: Json | null
          mood_id?: string | null
          play_count?: number | null
          preview_url?: string | null
          price?: number | null
          producer_id?: string | null
          product_type?: Database["public"]["Enums"]["product_type"] | null
          slug?: string | null
          sold_at?: string | null
          sold_to_user_id?: string | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
          watermark_profile_id?: string | null
          watermarked_path?: string | null
        }
        Update: {
          bpm?: number | null
          cover_image_url?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          exclusive_preview_url?: string | null
          file_format?: string | null
          genre_id?: string | null
          id?: string | null
          is_exclusive?: boolean | null
          is_published?: boolean | null
          is_sold?: boolean | null
          key_signature?: string | null
          license_terms?: Json | null
          mood_id?: string | null
          play_count?: number | null
          preview_url?: string | null
          price?: number | null
          producer_id?: string | null
          product_type?: Database["public"]["Enums"]["product_type"] | null
          slug?: string | null
          sold_at?: string | null
          sold_to_user_id?: string | null
          tags?: string[] | null
          title?: string | null
          updated_at?: string | null
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
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
            foreignKeyName: "products_sold_to_user_id_fkey"
            columns: ["sold_to_user_id"]
            isOneToOne: false
            referencedRelation: "weekly_leaderboard"
            referencedColumns: ["user_id"]
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
      season_leaderboard: {
        Row: {
          avatar_url: string | null
          battle_draws: number | null
          battle_losses: number | null
          battle_wins: number | null
          elo_rating: number | null
          end_date: string | null
          producer_tier:
            | Database["public"]["Enums"]["producer_tier_type"]
            | null
          rank_position: number | null
          season_id: string | null
          season_name: string | null
          start_date: string | null
          total_battles: number | null
          user_id: string | null
          username: string | null
          win_rate: number | null
        }
        Relationships: []
      }
      weekly_leaderboard: {
        Row: {
          rank_position: number | null
          user_id: string | null
          username: string | null
          weekly_losses: number | null
          weekly_winrate: number | null
          weekly_wins: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_adjust_reputation: {
        Args: {
          p_delta_xp: number
          p_metadata?: Json
          p_reason: string
          p_user_id: string
        }
        Returns: {
          applied: boolean
          battle_xp: number
          commerce_xp: number
          event_id: string
          forum_xp: number
          level: number
          rank_tier: string
          reputation_score: number
          skipped_reason: string
          xp: number
        }[]
      }
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
      apply_reputation_event_internal: {
        Args: {
          p_delta?: number
          p_entity_id?: string
          p_entity_type?: string
          p_event_type: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_source: string
          p_user_id: string
        }
        Returns: {
          applied: boolean
          battle_xp: number
          commerce_xp: number
          event_id: string
          forum_xp: number
          level: number
          rank_tier: string
          reputation_score: number
          skipped_reason: string
          xp: number
        }[]
      }
      assert_battle_skill_gap: {
        Args: { p_max_diff?: number; p_producer1: string; p_producer2: string }
        Returns: boolean
      }
      can_access_exclusive_preview: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      can_create_active_battle: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      can_create_battle: { Args: { p_user_id: string }; Returns: boolean }
      can_create_product: { Args: { p_user_id: string }; Returns: boolean }
      can_edit_product: { Args: { p_product_id: string }; Returns: Json }
      can_publish_beat: {
        Args: { p_exclude_product_id?: string; p_user_id: string }
        Returns: boolean
      }
      check_and_assign_badges: { Args: { p_user_id: string }; Returns: number }
      check_daily_battle_refusals: {
        Args: { p_user_id: string }
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
      claim_audio_processing_jobs: {
        Args: { p_limit?: number; p_worker?: string }
        Returns: {
          attempts: number
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          product_id: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "audio_processing_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_contract_generation_jobs: {
        Args: { p_limit?: number; p_worker?: string }
        Returns: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          next_run_at: string
          purchase_id: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "contract_generation_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
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
      compute_preview_signature: {
        Args: {
          p_gain_db: number
          p_master_reference: string
          p_max_interval_sec: number
          p_min_interval_sec: number
          p_watermark_audio_path: string
        }
        Returns: string
      }
      compute_watermark_hash: {
        Args: {
          p_gain_db: number
          p_max_interval_sec: number
          p_min_interval_sec: number
          p_watermark_audio_path: string
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
      create_new_version_from_beat: {
        Args: { p_beat_id: string; p_new_data?: Json }
        Returns: {
          archived_at: string | null
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
          last_watermark_hash: string | null
          license_terms: Json | null
          master_path: string | null
          master_url: string | null
          mood_id: string | null
          original_beat_id: string | null
          parent_product_id: string | null
          play_count: number
          preview_signature: string | null
          preview_url: string | null
          preview_version: number
          price: number
          processed_at: string | null
          processing_error: string | null
          processing_status: string
          producer_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          slug: string
          sold_at: string | null
          sold_to_user_id: string | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string
          version: number
          version_number: number
          watermark_profile_id: string | null
          watermarked_bucket: string | null
          watermarked_path: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_beat_if_no_sales: { Args: { p_beat_id: string }; Returns: Json }
      delete_my_account: {
        Args: { p_reason?: string | null }
        Returns: {
          message: string
          status: string
          success: boolean
        }[]
      }
      detect_admin_action_anomalies: {
        Args: { p_lookback_minutes?: number }
        Returns: number
      }
      enqueue_audio_processing_job: {
        Args: { p_job_type?: string; p_product_id: string }
        Returns: boolean
      }
      enqueue_contract_generation_job: {
        Args: { p_purchase_id: string }
        Returns: string
      }
      enqueue_reprocess_all_previews: { Args: never; Returns: Json }
      ensure_user_reputation_row: {
        Args: { p_user_id: string }
        Returns: {
          battle_xp: number
          commerce_xp: number
          created_at: string
          forum_xp: number
          last_event_at: string | null
          level: number
          rank_tier: string
          reputation_score: number
          updated_at: string
          user_id: string
          xp: number
        }
        SetofOptions: {
          from: "*"
          to: "user_reputation"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finalize_battle: { Args: { p_battle_id: string }; Returns: string }
      finalize_expired_battles: { Args: { p_limit?: number }; Returns: number }
      force_reprocess_all_previews: { Args: never; Returns: Json }
      format_watermark_gain_db: { Args: { p_gain_db: number }; Returns: string }
      forum_admin_delete_category: {
        Args: { p_category_id: string }
        Returns: boolean
      }
      forum_admin_set_post_state: {
        Args: { p_action: string; p_post_id: string }
        Returns: {
          ai_agent_name: string | null
          content: string
          created_at: string
          edited_at: string | null
          id: string
          is_ai_generated: boolean
          is_deleted: boolean
          is_flagged: boolean
          is_visible: boolean
          moderated_at: string | null
          moderation_model: string | null
          moderation_reason: string | null
          moderation_score: number | null
          moderation_status: string
          source_post_id: string | null
          topic_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "forum_posts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      forum_admin_set_topic_deleted: {
        Args: { p_is_deleted: boolean; p_topic_id: string }
        Returns: {
          category_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_deleted: boolean
          is_locked: boolean
          is_pinned: boolean
          last_ai_reply_at: string | null
          last_post_at: string
          post_count: number
          slug: string
          title: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "forum_topics"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      forum_admin_upsert_category: {
        Args: {
          p_allow_links?: boolean
          p_allow_media?: boolean
          p_category_id?: string
          p_description?: string
          p_is_competitive?: boolean
          p_is_premium_only?: boolean
          p_moderation_strictness?: string
          p_name?: string
          p_position?: number
          p_required_rank_tier?: string
          p_slug?: string
          p_xp_multiplier?: number
        }
        Returns: {
          allow_links: boolean
          allow_media: boolean
          created_at: string
          description: string
          id: string
          is_competitive: boolean
          is_premium_only: boolean
          moderation_strictness: string
          name: string
          position: number
          required_rank_tier: string
          slug: string
          xp_multiplier: number
        }[]
      }
      forum_can_access_category: {
        Args: { p_category_id: string; p_user_id?: string }
        Returns: boolean
      }
      forum_can_write_topic: {
        Args: { p_topic_id: string; p_user_id?: string }
        Returns: boolean
      }
      forum_get_user_rank_tier: {
        Args: { p_user_id?: string }
        Returns: string
      }
      forum_has_active_subscription: {
        Args: { p_user_id?: string }
        Returns: boolean
      }
      forum_is_assistant_user: { Args: { p_user_id: string }; Returns: boolean }
      forum_user_meets_rank_requirement: {
        Args: { p_required_rank_tier?: string; p_user_id?: string }
        Returns: boolean
      }
      get_active_season: { Args: never; Returns: string }
      get_active_season_details: {
        Args: never
        Returns: {
          end_date: string
          id: string
          is_active: boolean
          name: string
          start_date: string
        }[]
      }
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
      get_battles_quota_status: {
        Args: never
        Returns: {
          can_create: boolean
          max_per_month: number
          reset_at: string
          tier: string
          used_this_month: number
        }[]
      }
      get_forum_public_profiles: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          level: number
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          rank_tier: string
          reputation_score: number
          updated_at: string
          user_id: string
          username: string
          xp: number
        }[]
      }
      get_home_stats: {
        Args: never
        Returns: {
          active_producers: number
          beats_published: number
          show_homepage_stats: boolean
        }
      }
      get_leaderboard_producers: {
        Args: never
        Returns: {
          avatar_url: string
          battle_draws: number
          battle_losses: number
          battle_wins: number
          elo_rating: number
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          rank_position: number
          total_battles: number
          user_id: string
          username: string
          win_rate: number
        }[]
      }
      get_matchmaking_opponents: {
        Args: never
        Returns: {
          avatar_url: string
          battle_draws: number
          battle_losses: number
          battle_wins: number
          elo_diff: number
          elo_rating: number
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          user_id: string
          username: string
        }[]
      }
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
          level: number
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          rank_tier: string
          reputation_score: number
          social_links: Json
          updated_at: string
          user_id: string
          username: string
          xp: number
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
      get_weekly_leaderboard: {
        Args: { p_limit?: number }
        Returns: {
          rank_position: number
          user_id: string
          username: string
          weekly_losses: number
          weekly_winrate: number
          weekly_wins: number
        }[]
      }
      has_producer_tier: {
        Args: {
          p_min_tier: Database["public"]["Enums"]["producer_tier_type"]
          p_user_id: string
        }
        Returns: boolean
      }
      hash_request_value: { Args: { p_value: string }; Returns: string }
      increment_play_count: { Args: { p_product_id: string }; Returns: boolean }
      is_account_old_enough: {
        Args: { p_min_age?: string; p_user_id?: string }
        Returns: boolean
      }
      is_active_producer: { Args: { p_user?: string }; Returns: boolean }
      is_admin: { Args: { p_user_id?: string }; Returns: boolean }
      is_confirmed_user: { Args: { p_user_id?: string }; Returns: boolean }
      is_email_verified_user: { Args: { p_user_id?: string }; Returns: boolean }
      is_valid_product_master_path: {
        Args: { p_path: string; p_producer_id: string; p_product_id: string }
        Returns: boolean
      }
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
      log_fraud_event: {
        Args: {
          p_battle_id?: string
          p_event_type: string
          p_post_id?: string
          p_user_id?: string
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
      normalize_master_storage_path: {
        Args: { p_value: string }
        Returns: string
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
      product_has_terminated_battle: {
        Args: { p_product_id: string }
        Returns: boolean
      }
      recalculate_engagement: { Args: { p_user_id: string }; Returns: number }
      recalculate_forum_topic_stats: {
        Args: { p_topic_id: string }
        Returns: undefined
      }
      record_battle_vote: {
        Args: {
          p_battle_id: string
          p_user_id: string
          p_voted_for_producer_id: string
        }
        Returns: boolean
      }
      remove_beat_from_sale: {
        Args: { p_beat_id: string }
        Returns: {
          archived_at: string | null
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
          last_watermark_hash: string | null
          license_terms: Json | null
          master_path: string | null
          master_url: string | null
          mood_id: string | null
          original_beat_id: string | null
          parent_product_id: string | null
          play_count: number
          preview_signature: string | null
          preview_url: string | null
          preview_version: number
          price: number
          processed_at: string | null
          processing_error: string | null
          processing_status: string
          producer_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          slug: string
          sold_at: string | null
          sold_to_user_id: string | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string
          version: number
          version_number: number
          watermark_profile_id: string | null
          watermarked_bucket: string | null
          watermarked_path: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reputation_calculate_level: { Args: { p_xp: number }; Returns: number }
      reputation_calculate_rank_tier: {
        Args: { p_xp: number }
        Returns: string
      }
      reputation_rank_tier_value: {
        Args: { p_rank_tier: string }
        Returns: number
      }
      reset_elo_for_new_season: { Args: never; Returns: number }
      respond_to_battle: {
        Args: { p_accept: boolean; p_battle_id: string; p_reason?: string }
        Returns: boolean
      }
      rpc_admin_get_beat_feedback_overview: {
        Args: { p_battle_id?: string; p_limit?: number; p_offset?: number }
        Returns: {
          artistic_score: number
          battle_id: string
          battle_slug: string
          battle_status: Database["public"]["Enums"]["battle_status"]
          battle_title: string
          coherence_score: number
          computed_at: string
          credibility_score: number
          identity_score: number
          melody_score: number
          mix_score: number
          preference_score: number
          producer_id: string
          producer_username: string
          product_id: string
          product_title: string
          quality_index: number
          rhythm_score: number
          sound_design_score: number
          structure_score: number
          top_criteria: Json
          total_feedback: number
          votes_for_product: number
          votes_total: number
          win_rate: number
        }[]
      }
      rpc_admin_get_reputation_overview: {
        Args: { p_limit?: number; p_search?: string }
        Returns: {
          avatar_url: string
          battle_xp: number
          commerce_xp: number
          email: string
          forum_xp: number
          level: number
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          rank_tier: string
          reputation_score: number
          role: string
          updated_at: string
          user_id: string
          username: string
          xp: number
        }[]
      }
      rpc_apply_reputation_event: {
        Args: {
          p_delta?: number
          p_entity_id?: string
          p_entity_type?: string
          p_event_type: string
          p_idempotency_key?: string
          p_metadata?: Json
          p_source: string
          p_user_id: string
        }
        Returns: {
          applied: boolean
          battle_xp: number
          commerce_xp: number
          event_id: string
          forum_xp: number
          level: number
          rank_tier: string
          reputation_score: number
          skipped_reason: string
          xp: number
        }[]
      }
      rpc_archive_product: {
        Args: { p_product_id: string }
        Returns: {
          archived_at: string | null
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
          last_watermark_hash: string | null
          license_terms: Json | null
          master_path: string | null
          master_url: string | null
          mood_id: string | null
          original_beat_id: string | null
          parent_product_id: string | null
          play_count: number
          preview_signature: string | null
          preview_url: string | null
          preview_version: number
          price: number
          processed_at: string | null
          processing_error: string | null
          processing_status: string
          producer_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          slug: string
          sold_at: string | null
          sold_to_user_id: string | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string
          version: number
          version_number: number
          watermark_profile_id: string | null
          watermarked_bucket: string | null
          watermarked_path: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_check_contract_url_rate_limit: {
        Args: { p_purchase_id: string; p_user_id?: string }
        Returns: boolean
      }
      rpc_compute_battle_quality_snapshot: {
        Args: { p_battle_id: string }
        Returns: number
      }
      rpc_contact_submit_rate_limit: {
        Args: { p_ip_hash: string }
        Returns: boolean
      }
      rpc_create_battle_comment: {
        Args: { p_battle_id: string; p_content: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "battle_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_create_product_version: {
        Args: { p_product_id: string }
        Returns: string
      }
      rpc_delete_product_if_no_sales: {
        Args: { p_product_id: string }
        Returns: Json
      }
      rpc_forum_create_post: {
        Args: {
          p_ai_agent_name?: string
          p_content: string
          p_is_ai_generated?: boolean
          p_is_flagged?: boolean
          p_is_visible?: boolean
          p_moderation_model?: string
          p_moderation_reason?: string
          p_moderation_score?: number
          p_moderation_status?: string
          p_raw_response?: Json
          p_source: string
          p_source_post_id?: string
          p_topic_id: string
          p_user_id: string
        }
        Returns: {
          category_slug: string
          is_ai_generated: boolean
          is_flagged: boolean
          is_visible: boolean
          moderation_status: string
          post_id: string
          topic_id: string
          topic_slug: string
        }[]
      }
      rpc_forum_create_topic: {
        Args: {
          p_ai_agent_name?: string
          p_category_slug: string
          p_content: string
          p_is_ai_generated?: boolean
          p_is_flagged?: boolean
          p_is_visible?: boolean
          p_moderation_model?: string
          p_moderation_reason?: string
          p_moderation_score?: number
          p_moderation_status?: string
          p_raw_response?: Json
          p_source: string
          p_source_post_id?: string
          p_title: string
          p_topic_slug: string
          p_user_id: string
        }
        Returns: {
          category_id: string
          category_slug: string
          is_flagged: boolean
          is_visible: boolean
          moderation_status: string
          post_id: string
          topic_id: string
          topic_slug: string
        }[]
      }
      rpc_get_leaderboard: {
        Args: { p_limit?: number; p_period?: string; p_source?: string }
        Returns: {
          avatar_url: string
          battle_xp: number
          commerce_xp: number
          forum_xp: number
          level: number
          period_xp: number
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          rank_tier: string
          reputation_score: number
          user_id: string
          username: string
          xp: number
        }[]
      }
      rpc_like_forum_post: { Args: { p_post_id: string }; Returns: undefined }
      rpc_publish_product_version: {
        Args: { p_new_data?: Json; p_source_product_id: string }
        Returns: {
          archived_at: string | null
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
          last_watermark_hash: string | null
          license_terms: Json | null
          master_path: string | null
          master_url: string | null
          mood_id: string | null
          original_beat_id: string | null
          parent_product_id: string | null
          play_count: number
          preview_signature: string | null
          preview_url: string | null
          preview_version: number
          price: number
          processed_at: string | null
          processing_error: string | null
          processing_status: string
          producer_id: string
          product_type: Database["public"]["Enums"]["product_type"]
          slug: string
          sold_at: string | null
          sold_to_user_id: string | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string
          version: number
          version_number: number
          watermark_profile_id: string | null
          watermarked_bucket: string | null
          watermarked_path: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_submit_battle_vote_feedback: {
        Args: {
          p_battle_id: string
          p_criteria: string[]
          p_winner_producer_id: string
        }
        Returns: number
      }
      rpc_vote_with_feedback: {
        Args: {
          p_battle_id: string
          p_criteria: string[]
          p_winner_producer_id: string
        }
        Returns: Json
      }
      should_flag_battle_refusal_risk: {
        Args: { p_threshold?: number; p_user_id: string }
        Returns: boolean
      }
      suggest_opponents: {
        Args: { p_user_id: string }
        Returns: {
          avatar_url: string
          battle_draws: number
          battle_losses: number
          battle_wins: number
          elo_diff: number
          elo_rating: number
          producer_tier: Database["public"]["Enums"]["producer_tier_type"]
          user_id: string
          username: string
        }[]
      }
      update_elo_rating: {
        Args: { p_player1: string; p_player2: string; p_winner: string }
        Returns: boolean
      }
      upsert_battle_product_snapshot: {
        Args: { p_battle_id: string; p_slot: string }
        Returns: undefined
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
      producer_tier_type: "user" | "producteur" | "elite"
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
  graphql_public: {
    Enums: {},
  },
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
      producer_tier_type: ["user", "producteur", "elite"],
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
