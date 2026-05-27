/**
 * Supabase Database types (m9).
 *
 * Regenerate after schema changes:
 *   npx supabase gen types typescript --local > lib/database.types.ts
 *
 * Hand-maintained to match supabase/migrations/* until a linked project exists.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "student" | "admin" | "moderator";
export type ExamPillar = "school" | "banking" | "ssc" | "tricks" | "mixed";
export type ExamDifficulty = "easy" | "medium" | "hard";
export type ExamStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "closed"
  | "merit_published"
  | "archived";
export type AttemptStatus =
  | "in_progress"
  | "submitted"
  | "graded"
  | "disqualified";
export type ViolationKind =
  | "tab_blur"
  | "fullscreen_exit"
  | "paste"
  | "contextmenu"
  | "devtools"
  | "heartbeat_gap"
  | "copy"
  | "dev_console";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          display_name: string;
          phone: string | null;
          city: string | null;
          state: string | null;
          class_or_target: string | null;
          role: UserRole;
          avatar_url: string | null;
          whatsapp_opt_in: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          phone?: string | null;
          city?: string | null;
          state?: string | null;
          class_or_target?: string | null;
          role?: UserRole;
          avatar_url?: string | null;
          whatsapp_opt_in?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      exams: {
        Row: {
          id: string;
          slug: string;
          title: string;
          description: string | null;
          pillar: ExamPillar;
          difficulty: ExamDifficulty;
          duration_min: number;
          total_marks: number;
          marking_correct: number;
          marking_wrong: number;
          marking_skip: number;
          starts_at: string;
          ends_at: string;
          registration_opens_at: string;
          registration_closes_at: string;
          merit_publish_at: string | null;
          status: ExamStatus;
          syllabus: Json | null;
          rules_md: string | null;
          cover_image_url: string | null;
          is_free: boolean;
          price_inr: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["exams"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exams"]["Insert"]>;
        Relationships: [];
      };
      exam_questions: {
        Row: {
          id: string;
          exam_id: string;
          position: number;
          section: string | null;
          topic: string | null;
          question_latex: string;
          options: Json;
          correct_idx: number;
          explanation_latex: string | null;
          marks_correct: number | null;
          marks_wrong: number | null;
        };
        Insert: Omit<Database["public"]["Tables"]["exam_questions"]["Row"], "id"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_questions"]["Insert"]>;
        Relationships: [];
      };
      exam_registrations: {
        Row: {
          id: string;
          exam_id: string;
          user_id: string;
          registered_at: string;
          reminder_sent_24h: boolean;
          reminder_sent_1h: boolean;
        };
        Insert: Omit<
          Database["public"]["Tables"]["exam_registrations"]["Row"],
          "id" | "registered_at"
        > & {
          id?: string;
          registered_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["exam_registrations"]["Insert"]
        >;
        Relationships: [];
      };
      exam_attempts: {
        Row: {
          id: string;
          exam_id: string;
          user_id: string;
          started_at: string;
          submitted_at: string | null;
          auto_submitted: boolean;
          raw_score: number | null;
          final_score: number | null;
          percentile: number | null;
          all_india_rank: number | null;
          state_rank: number | null;
          city_rank: number | null;
          status: AttemptStatus;
          device_info: Json | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["exam_attempts"]["Row"],
          "id" | "started_at"
        > & {
          id?: string;
          started_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_attempts"]["Insert"]>;
        Relationships: [];
      };
      exam_answers: {
        Row: {
          id: string;
          attempt_id: string;
          question_id: string;
          selected_idx: number | null;
          marked_for_review: boolean;
          time_spent_sec: number;
          is_correct: boolean | null;
          marks_awarded: number | null;
        };
        Insert: Omit<Database["public"]["Tables"]["exam_answers"]["Row"], "id"> & {
          id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exam_answers"]["Insert"]>;
        Relationships: [];
      };
      merit_lists: {
        Row: {
          id: string;
          exam_id: string;
          published_at: string;
          total_attempts: number;
          top_score: number | null;
          median_score: number | null;
          is_final: boolean;
        };
        Insert: Omit<
          Database["public"]["Tables"]["merit_lists"]["Row"],
          "id" | "published_at"
        > & {
          id?: string;
          published_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["merit_lists"]["Insert"]>;
        Relationships: [];
      };
      violations: {
        Row: {
          id: string;
          attempt_id: string;
          kind: ViolationKind;
          payload: Json | null;
          at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["violations"]["Row"],
          "id" | "at"
        > & {
          id?: string;
          at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["violations"]["Insert"]>;
        Relationships: [];
      };
      certificates: {
        Row: {
          id: string;
          attempt_id: string;
          user_id: string;
          exam_id: string;
          verification_code: string;
          pdf_url: string | null;
          issued_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["certificates"]["Row"],
          "id" | "issued_at"
        > & {
          id?: string;
          issued_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["certificates"]["Insert"]>;
        Relationships: [];
      };
      newsletter_subscribers: {
        Row: {
          id: string;
          email: string;
          source: string;
          subscribed_at: string;
          ip_hash: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["newsletter_subscribers"]["Row"],
          "id" | "subscribed_at"
        > & {
          id?: string;
          subscribed_at?: string;
        };
        Update: Partial<
          Database["public"]["Tables"]["newsletter_subscribers"]["Insert"]
        >;
        Relationships: [];
      };
      resource_leads: {
        Row: {
          id: string;
          email: string;
          whatsapp: string | null;
          resource_id: string;
          resource_title: string;
          source: string;
          captured_at: string;
          ip_hash: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["resource_leads"]["Row"],
          "id" | "captured_at"
        > & {
          id?: string;
          captured_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["resource_leads"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      public_merit: {
        Row: {
          attempt_id: string;
          exam_id: string;
          all_india_rank: number | null;
          state_rank: number | null;
          city_rank: number | null;
          final_score: number | null;
          percentile: number | null;
          display_name: string;
          city: string | null;
          state: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      current_user_role: {
        Args: Record<string, never>;
        Returns: string;
      };
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
