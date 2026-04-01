export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      specialists: {
        Row: {
          id: string
          google_id: string
          email: string
          name: string
          specialty: SpecialtyType
          city: string
          role: 'specialist' | 'admin'
          status: 'onboarding' | 'active' | 'inactive' | 'suspended'
          whatsapp_number: string | null
          onboarding_step: number
          created_at: string
          updated_at: string
          last_active_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['specialists']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['specialists']['Insert']>
      }
      specialist_profiles: {
        Row: {
          id: string
          specialist_id: string
          designation: string | null
          sub_specialty: string | null
          hospitals: string[]
          years_experience: number | null
          mci_number: string | null
          photo_url: string | null
          bio: string | null
          completeness_pct: number
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['specialist_profiles']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['specialist_profiles']['Insert']>
      }
      peer_seeds: {
        Row: {
          id: string
          specialist_id: string
          peer_name: string
          peer_city: string
          peer_specialty: string | null
          peer_clinic: string | null
          peer_phone: string | null
          status: 'seeded' | 'matched' | 'active' | 'drifting' | 'silent'
          last_referral_at: string | null
          days_since_last: number | null
          seeded_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['peer_seeds']['Row'], 'id' | 'days_since_last' | 'seeded_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['peer_seeds']['Insert']>
      }
      specialist_consents: {
        Row: {
          id: string
          specialist_id: string
          consent_version: string
          consented_at: string
          ip_address: string | null
          user_agent: string | null
        }
        Insert: Omit<Database['public']['Tables']['specialist_consents']['Row'], 'id' | 'consented_at'>
        Update: never
      }
      audit_logs: {
        Row: {
          id: number
          actor_id: string | null
          actor_role: string
          action: string
          resource_type: string
          resource_id: string | null
          metadata: Json
          ip_address: string | null
          user_agent: string | null
          ts: string
        }
        Insert: Omit<Database['public']['Tables']['audit_logs']['Row'], 'id' | 'ts'>
        Update: never
      }
      device_sessions: {
        Row: {
          id: string
          specialist_id: string
          refresh_token_hash: string
          device_hint: string | null
          ip_address: string | null
          last_active: string
          created_at: string
          expires_at: string
        }
        Insert: Omit<Database['public']['Tables']['device_sessions']['Row'], 'id' | 'last_active' | 'created_at'>
        Update: Partial<Database['public']['Tables']['device_sessions']['Insert']>
      }
    }
  }
}

export type SpecialtyType =
  | 'interventional_cardiology' | 'cardiac_surgery' | 'cardiology'
  | 'orthopedics' | 'spine_surgery' | 'neurology' | 'neurosurgery'
  | 'gi_surgery' | 'urology' | 'oncology' | 'reproductive_medicine'
  | 'dermatology' | 'ophthalmology' | 'internal_medicine' | 'other'
