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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          id: string
          payload: Json
          scope: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at?: string
          id?: string
          payload?: Json
          scope?: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          id?: string
          payload?: Json
          scope?: string
        }
        Relationships: []
      }
      analysis_history: {
        Row: {
          created_at: string
          id: string
          results: Json
          search_query: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          results?: Json
          search_query: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          results?: Json
          search_query?: string
          user_id?: string
        }
        Relationships: []
      }
      creative_assets: {
        Row: {
          created_at: string
          id: string
          language: string
          payload: Json
          platform: string
          product_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language?: string
          payload?: Json
          platform?: string
          product_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language?: string
          payload?: Json
          platform?: string
          product_name?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_usage_log: {
        Row: {
          created_at: string
          credits: number
          duration_ms: number | null
          id: string
          meta: Json
          model: string | null
          success: boolean
          tool: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits?: number
          duration_ms?: number | null
          id?: string
          meta?: Json
          model?: string | null
          success?: boolean
          tool: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits?: number
          duration_ms?: number | null
          id?: string
          meta?: Json
          model?: string | null
          success?: boolean
          tool?: string
          user_id?: string
        }
        Relationships: []
      }
      device_fingerprints: {
        Row: {
          created_at: string
          email: string | null
          free_tier_granted: boolean
          id: string
          ip_hash: string | null
          user_id: string | null
          visitor_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          free_tier_granted?: boolean
          id?: string
          ip_hash?: string | null
          user_id?: string | null
          visitor_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          free_tier_granted?: boolean
          id?: string
          ip_hash?: string | null
          user_id?: string | null
          visitor_id?: string
        }
        Relationships: []
      }
      email_otps: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          collection_name: string
          created_at: string
          id: string
          name: string
          notes: string | null
          product: Json
          tags: Json
          user_id: string
        }
        Insert: {
          collection_name?: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          product: Json
          tags?: Json
          user_id: string
        }
        Update: {
          collection_name?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          product?: Json
          tags?: Json
          user_id?: string
        }
        Relationships: []
      }
      free_credit_audit: {
        Row: {
          created_at: string
          credits: number
          email: string | null
          granted: boolean
          id: string
          ip_hash: string | null
          meta: Json
          reason: string
          sim_credits: number
          source: string
          user_id: string | null
          visitor_id: string | null
        }
        Insert: {
          created_at?: string
          credits?: number
          email?: string | null
          granted: boolean
          id?: string
          ip_hash?: string | null
          meta?: Json
          reason?: string
          sim_credits?: number
          source?: string
          user_id?: string | null
          visitor_id?: string | null
        }
        Update: {
          created_at?: string
          credits?: number
          email?: string | null
          granted?: boolean
          id?: string
          ip_hash?: string | null
          meta?: Json
          reason?: string
          sim_credits?: number
          source?: string
          user_id?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          id: string
          low_credit: boolean
          marketing: boolean
          payment_success: boolean
          trend_alert: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          low_credit?: boolean
          marketing?: boolean
          payment_success?: boolean
          trend_alert?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          low_credit?: boolean
          marketing?: boolean
          payment_success?: boolean
          trend_alert?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          data: Json
          id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          data?: Json
          id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          competition_level: string | null
          cost_price: number
          created_at: string
          health_score: number
          id: string
          profit_margin: number | null
          sellability_verdict: string | null
          selling_price: number
          status_message: string | null
          target_country: string
          title: string
          trend_score: number
          updated_at: string
          user_id: string
          viral_probability_90d: number
        }
        Insert: {
          category?: string | null
          competition_level?: string | null
          cost_price: number
          created_at?: string
          health_score?: number
          id?: string
          profit_margin?: number | null
          sellability_verdict?: string | null
          selling_price: number
          status_message?: string | null
          target_country?: string
          title: string
          trend_score?: number
          updated_at?: string
          user_id: string
          viral_probability_90d?: number
        }
        Update: {
          category?: string | null
          competition_level?: string | null
          cost_price?: number
          created_at?: string
          health_score?: number
          id?: string
          profit_margin?: number | null
          sellability_verdict?: string | null
          selling_price?: number
          status_message?: string | null
          target_country?: string
          title?: string
          trend_score?: number
          updated_at?: string
          user_id?: string
          viral_probability_90d?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          credits: number
          credits_spent: number
          currency: string
          email: string | null
          id: string
          language: string
          lemon_customer_id: string | null
          lemon_subscription_id: string | null
          notifications_enabled: boolean
          onboarding_completed: boolean
          promo_code: string | null
          public_id: string | null
          referral_code: string | null
          referred_by: string | null
          sim_credits: number
          subscription_tier: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          credits?: number
          credits_spent?: number
          currency?: string
          email?: string | null
          id: string
          language?: string
          lemon_customer_id?: string | null
          lemon_subscription_id?: string | null
          notifications_enabled?: boolean
          onboarding_completed?: boolean
          promo_code?: string | null
          public_id?: string | null
          referral_code?: string | null
          referred_by?: string | null
          sim_credits?: number
          subscription_tier?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          credits?: number
          credits_spent?: number
          currency?: string
          email?: string | null
          id?: string
          language?: string
          lemon_customer_id?: string | null
          lemon_subscription_id?: string | null
          notifications_enabled?: boolean
          onboarding_completed?: boolean
          promo_code?: string | null
          public_id?: string | null
          referral_code?: string | null
          referred_by?: string | null
          sim_credits?: number
          subscription_tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          discount_pct: number
          expires_at: string | null
          id: string
          max_redemptions: number | null
          times_redeemed: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          discount_pct?: number
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          times_redeemed?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          discount_pct?: number
          expires_at?: string | null
          id?: string
          max_redemptions?: number | null
          times_redeemed?: number
          updated_at?: string
        }
        Relationships: []
      }
      promo_redemptions: {
        Row: {
          amount_cents: number
          code: string
          created_at: string
          email: string | null
          id: string
          promo_code_id: string | null
          purchased_at: string | null
          purchased_tier: string | null
          signed_up_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          code: string
          created_at?: string
          email?: string | null
          id?: string
          promo_code_id?: string | null
          purchased_at?: string | null
          purchased_tier?: string | null
          signed_up_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          code?: string
          created_at?: string
          email?: string | null
          id?: string
          promo_code_id?: string | null
          purchased_at?: string | null
          purchased_tier?: string | null
          signed_up_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_items: {
        Row: {
          category: string
          country: string
          created_at: string
          day: string
          est_margin_pct: number
          id: string
          momentum: number
          niche: string
          payload: Json
          platform: string
          price_max: number
          price_min: number
          reason: string | null
          title: string
          winner_score: number
        }
        Insert: {
          category?: string
          country?: string
          created_at?: string
          day?: string
          est_margin_pct?: number
          id?: string
          momentum?: number
          niche?: string
          payload?: Json
          platform?: string
          price_max?: number
          price_min?: number
          reason?: string | null
          title: string
          winner_score?: number
        }
        Update: {
          category?: string
          country?: string
          created_at?: string
          day?: string
          est_margin_pct?: number
          id?: string
          momentum?: number
          niche?: string
          payload?: Json
          platform?: string
          price_max?: number
          price_min?: number
          reason?: string | null
          title?: string
          winner_score?: number
        }
        Relationships: []
      }
      referral_events: {
        Row: {
          code: string
          created_at: string
          id: string
          referred_credits: number
          referred_user_id: string
          referrer_credits: number
          referrer_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          referred_credits?: number
          referred_user_id: string
          referrer_credits?: number
          referrer_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          referred_credits?: number
          referred_user_id?: string
          referrer_credits?: number
          referrer_id?: string
        }
        Relationships: []
      }
      roi_entries: {
        Row: {
          ad_spend: number
          cost_price: number
          country: string
          created_at: string
          currency: string
          expected_margin_pct: number | null
          id: string
          notes: string | null
          orders: number
          other_cost: number
          platform: string
          product_name: string
          refunds: number
          sell_price: number
          shipping_cost: number
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_spend?: number
          cost_price?: number
          country?: string
          created_at?: string
          currency?: string
          expected_margin_pct?: number | null
          id?: string
          notes?: string | null
          orders?: number
          other_cost?: number
          platform?: string
          product_name: string
          refunds?: number
          sell_price?: number
          shipping_cost?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_spend?: number
          cost_price?: number
          country?: string
          created_at?: string
          currency?: string
          expected_margin_pct?: number | null
          id?: string
          notes?: string | null
          orders?: number
          other_cost?: number
          platform?: string
          product_name?: string
          refunds?: number
          sell_price?: number
          shipping_cost?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scraped_platform_trends: {
        Row: {
          ai_analysis: Json | null
          ai_demand_score: number | null
          category: string
          created_at: string
          first_detected_at: string
          id: string
          metrics: Json
          raw_payload: Json
          region: string
          scraped_at: string
          source: string
          trend_name: string
          updated_at: string
        }
        Insert: {
          ai_analysis?: Json | null
          ai_demand_score?: number | null
          category?: string
          created_at?: string
          first_detected_at?: string
          id?: string
          metrics?: Json
          raw_payload?: Json
          region?: string
          scraped_at?: string
          source: string
          trend_name: string
          updated_at?: string
        }
        Update: {
          ai_analysis?: Json | null
          ai_demand_score?: number | null
          category?: string
          created_at?: string
          first_detected_at?: string
          id?: string
          metrics?: Json
          raw_payload?: Json
          region?: string
          scraped_at?: string
          source?: string
          trend_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      sim_runs: {
        Row: {
          badges: Json
          created_at: string
          days: number
          final_capital: number
          id: string
          net_profit: number
          orders: number
          platform: string
          roi_pct: number
          starting_capital: number
          store_name: string
          store_rating: number
          user_id: string
        }
        Insert: {
          badges?: Json
          created_at?: string
          days?: number
          final_capital?: number
          id?: string
          net_profit?: number
          orders?: number
          platform: string
          roi_pct?: number
          starting_capital: number
          store_name: string
          store_rating?: number
          user_id: string
        }
        Update: {
          badges?: Json
          created_at?: string
          days?: number
          final_capital?: number
          id?: string
          net_profit?: number
          orders?: number
          platform?: string
          roi_pct?: number
          starting_capital?: number
          store_name?: string
          store_rating?: number
          user_id?: string
        }
        Relationships: []
      }
      store_audits: {
        Row: {
          created_at: string
          health_score: number
          id: string
          report: Json
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          health_score?: number
          id?: string
          report?: Json
          url: string
          user_id: string
        }
        Update: {
          created_at?: string
          health_score?: number
          id?: string
          report?: Json
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          created_at: string
          delivery_days: number
          id: string
          moq: number
          platform: string
          price: number
          product_id: string
          rating: number | null
          trust_score: number | null
        }
        Insert: {
          created_at?: string
          delivery_days: number
          id?: string
          moq: number
          platform: string
          price: number
          product_id: string
          rating?: number | null
          trust_score?: number | null
        }
        Update: {
          created_at?: string
          delivery_days?: number
          id?: string
          moq?: number
          platform?: string
          price?: number
          product_id?: string
          rating?: number | null
          trust_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_note: string | null
          category: string
          created_at: string
          email: string | null
          id: string
          message: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          category?: string
          created_at?: string
          email?: string | null
          id?: string
          message: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          category?: string
          created_at?: string
          email?: string | null
          id?: string
          message?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          email: string | null
          external_id: string | null
          id: string
          payment_method: string | null
          provider: string
          provider_event: string | null
          tier: string | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          currency?: string
          email?: string | null
          external_id?: string | null
          id?: string
          payment_method?: string | null
          provider?: string
          provider_event?: string | null
          tier?: string | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          email?: string | null
          external_id?: string | null
          id?: string
          payment_method?: string | null
          provider?: string
          provider_event?: string | null
          tier?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      viral_ads: {
        Row: {
          country: string
          created_at: string
          cta_text: string | null
          hook_script: string | null
          id: string
          likes: number
          niche: string
          platform: string
          title: string
          video_url: string | null
          views: number
        }
        Insert: {
          country: string
          created_at?: string
          cta_text?: string | null
          hook_script?: string | null
          id?: string
          likes?: number
          niche: string
          platform: string
          title: string
          video_url?: string | null
          views?: number
        }
        Update: {
          country?: string
          created_at?: string
          cta_text?: string | null
          hook_script?: string | null
          id?: string
          likes?: number
          niche?: string
          platform?: string
          title?: string
          video_url?: string | null
          views?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_subscription_credits: {
        Args: {
          _credits: number
          _customer_id: string
          _subscription_id: string
          _tier: string
          _user_id: string
        }
        Returns: undefined
      }
      deduct_credit: { Args: never; Returns: number }
      deduct_sim_credit: { Args: never; Returns: number }
      gen_public_id: { Args: never; Returns: string }
      gen_referral_code: { Args: never; Returns: string }
      get_sim_leaderboard: {
        Args: never
        Returns: {
          created_at: string
          id: string
          is_me: boolean
          net_profit: number
          orders: number
          platform: string
          roi_pct: number
          store_name: string
          store_rating: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_email: { Args: { _email: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
