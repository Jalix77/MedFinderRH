export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      fiscal_years: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          label: string
          organization_id: string
          start_date: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          label: string
          organization_id: string
          start_date: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          label?: string
          organization_id?: string
          start_date?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_years_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_years_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_years_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chart_of_accounts: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          label: string
          organization_id: string
          parent_account_id: string | null
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label: string
          organization_id: string
          parent_account_id?: string | null
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          label?: string
          organization_id?: string
          parent_account_id?: string | null
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_account_id_fkey"
            columns: ["parent_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          fiscal_year_id: string
          id: string
          month: number
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_year_id: string
          id?: string
          month: number
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          fiscal_year_id?: string
          id?: string
          month?: number
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_periods_fiscal_year_id_fkey"
            columns: ["fiscal_year_id"]
            isOneToOne: false
            referencedRelation: "fiscal_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_periods_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      journals: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          label: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journals_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          entry_date: string
          entry_number: string
          id: string
          journal_id: string
          organization_id: string
          period_id: string
          posted_at: string | null
          posted_by: string | null
          reversed_entry_id: string | null
          source_id: string | null
          source_type: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number: string
          id?: string
          journal_id: string
          organization_id: string
          period_id: string
          posted_at?: string | null
          posted_by?: string | null
          reversed_entry_id?: string | null
          source_id?: string | null
          source_type: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          journal_id?: string
          organization_id?: string
          period_id?: string
          posted_at?: string | null
          posted_by?: string | null
          reversed_entry_id?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_entry_id_fkey"
            columns: ["reversed_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_lines: {
        Row: {
          account_id: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          credit: number
          currency: string
          debit: number
          entry_id: string
          exchange_rate_to_htg: number
          id: string
          organization_id: string
          third_party_id: string | null
          third_party_type: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          currency?: string
          debit?: number
          entry_id: string
          exchange_rate_to_htg?: number
          id?: string
          organization_id: string
          third_party_id?: string | null
          third_party_type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          currency?: string
          debit?: number
          entry_id?: string
          exchange_rate_to_htg?: number
          id?: string
          organization_id?: string
          third_party_id?: string | null
          third_party_type?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_lines_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_accounts: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          current_balance: number
          gl_account_id: string
          id: string
          name: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          current_balance?: number
          gl_account_id: string
          id?: string
          name: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          current_balance?: number
          gl_account_id?: string
          id?: string
          name?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number_masked: string | null
          bank_name: string
          created_at: string
          created_by: string | null
          currency: string
          current_balance: number
          gl_account_id: string
          id: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_number_masked?: string | null
          bank_name: string
          created_at?: string
          created_by?: string | null
          currency?: string
          current_balance?: number
          gl_account_id: string
          id?: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_number_masked?: string | null
          bank_name?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          current_balance?: number
          gl_account_id?: string
          id?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      mobile_money_accounts: {
        Row: {
          account_number_masked: string | null
          created_at: string
          created_by: string | null
          currency: string
          current_balance: number
          gl_account_id: string
          id: string
          organization_id: string
          provider: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_number_masked?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          current_balance?: number
          gl_account_id: string
          id?: string
          organization_id: string
          provider: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_number_masked?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          current_balance?: number
          gl_account_id?: string
          id?: string
          organization_id?: string
          provider?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mobile_money_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobile_money_accounts_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobile_money_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mobile_money_accounts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          direction: string
          exchange_rate_to_htg: number
          id: string
          journal_entry_id: string | null
          movement_date: string
          organization_id: string
          reconciled: boolean
          reference_id: string | null
          reference_type: string
          treasury_account_id: string
          treasury_account_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          direction: string
          exchange_rate_to_htg?: number
          id?: string
          journal_entry_id?: string | null
          movement_date?: string
          organization_id: string
          reconciled?: boolean
          reference_id?: string | null
          reference_type: string
          treasury_account_id: string
          treasury_account_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          direction?: string
          exchange_rate_to_htg?: number
          id?: string
          journal_entry_id?: string | null
          movement_date?: string
          organization_id?: string
          reconciled?: boolean
          reference_id?: string | null
          reference_type?: string
          treasury_account_id?: string
          treasury_account_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          department_id: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centers_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_centers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          created_at: string
          created_by: string | null
          fiscal_year_id: string
          id: string
          name: string
          organization_id: string
          source_id: string | null
          source_type: string
          status: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          fiscal_year_id: string
          id?: string
          name: string
          organization_id: string
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          fiscal_year_id?: string
          id?: string
          name?: string
          organization_id?: string
          source_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_fiscal_year_id_fkey"
            columns: ["fiscal_year_id"]
            isOneToOne: false
            referencedRelation: "fiscal_years"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_lines: {
        Row: {
          budget_id: string
          category: string
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          organization_id: string
          planned_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget_id: string
          category: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          organization_id: string
          planned_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget_id?: string
          category?: string
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          organization_id?: string
          planned_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_commitments: {
        Row: {
          amount: number
          budget_line_id: string
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          reference_id: string
          reference_type: string
          released_at: string | null
          released_by: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          budget_line_id: string
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          reference_id: string
          reference_type?: string
          released_at?: string | null
          released_by?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          budget_line_id?: string
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          reference_id?: string
          reference_type?: string
          released_at?: string | null
          released_by?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_commitments_budget_line_id_fkey"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_commitments_consumed_by_fkey"
            columns: ["consumed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_commitments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_commitments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_commitments_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_commitments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_transfers: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          budget_id: string
          created_at: string
          created_by: string | null
          from_line_id: string
          id: string
          organization_id: string
          reason: string
          to_line_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          budget_id: string
          created_at?: string
          created_by?: string | null
          from_line_id: string
          id?: string
          organization_id: string
          reason: string
          to_line_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          budget_id?: string
          created_at?: string
          created_by?: string | null
          from_line_id?: string
          id?: string
          organization_id?: string
          reason?: string
          to_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_transfers_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transfers_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transfers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transfers_from_line_id_fkey"
            columns: ["from_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transfers_to_line_id_fkey"
            columns: ["to_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          created_at: string
          created_by: string | null
          default_account_id: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_account_id?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_account_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_default_account_id_fkey"
            columns: ["default_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_requests: {
        Row: {
          amount: number
          budget_line_id: string
          cancel_reason: string | null
          category_id: string | null
          cost_center_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          expense_number: string
          id: string
          organization_id: string
          payee_name: string
          payee_reference: string | null
          payment_method: string
          requested_date: string
          requester_id: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          budget_line_id: string
          cancel_reason?: string | null
          category_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          expense_number: string
          id?: string
          organization_id: string
          payee_name: string
          payee_reference?: string | null
          payment_method: string
          requested_date?: string
          requester_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          budget_line_id?: string
          cancel_reason?: string | null
          category_id?: string | null
          cost_center_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          expense_number?: string
          id?: string
          organization_id?: string
          payee_name?: string
          payee_reference?: string | null
          payment_method?: string
          requested_date?: string
          requester_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_requests_budget_line_id_fkey"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_approvals: {
        Row: {
          approver_id: string | null
          comment: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decision: string | null
          exception_justification: string | null
          exception_requested_by: string | null
          exception_result: string | null
          exception_validated_at: string | null
          exception_validated_by: string | null
          expense_id: string
          id: string
          organization_id: string
          sod_rule_violated: string | null
        }
        Insert: {
          approver_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decision?: string | null
          exception_justification?: string | null
          exception_requested_by?: string | null
          exception_result?: string | null
          exception_validated_at?: string | null
          exception_validated_by?: string | null
          expense_id: string
          id?: string
          organization_id: string
          sod_rule_violated?: string | null
        }
        Update: {
          approver_id?: string | null
          comment?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decision?: string | null
          exception_justification?: string | null
          exception_requested_by?: string | null
          exception_result?: string | null
          exception_validated_at?: string | null
          exception_validated_by?: string | null
          expense_id?: string
          id?: string
          organization_id?: string
          sod_rule_violated?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_approvals_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approvals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approvals_exception_requested_by_fkey"
            columns: ["exception_requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approvals_exception_validated_by_fkey"
            columns: ["exception_validated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approvals_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expense_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approvals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          commitment_id: string | null
          created_at: string
          created_by: string | null
          expense_request_id: string
          id: string
          journal_entry_id: string | null
          no_commitment_reason: string | null
          organization_id: string
          paid_by: string
          paid_date: string
          treasury_account_id: string
          treasury_account_type: string
        }
        Insert: {
          commitment_id?: string | null
          created_at?: string
          created_by?: string | null
          expense_request_id: string
          id?: string
          journal_entry_id?: string | null
          no_commitment_reason?: string | null
          organization_id: string
          paid_by: string
          paid_date?: string
          treasury_account_id: string
          treasury_account_type: string
        }
        Update: {
          commitment_id?: string | null
          created_at?: string
          created_by?: string | null
          expense_request_id?: string
          id?: string
          journal_entry_id?: string | null
          no_commitment_reason?: string | null
          organization_id?: string
          paid_by?: string
          paid_date?: string
          treasury_account_id?: string
          treasury_account_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "budget_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_expense_request_id_fkey"
            columns: ["expense_request_id"]
            isOneToOne: false
            referencedRelation: "expense_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_attachments: {
        Row: {
          created_at: string
          expense_request_id: string
          id: string
          organization_id: string
          original_filename: string
          storage_path: string
          type: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          expense_request_id: string
          id?: string
          organization_id: string
          original_filename: string
          storage_path: string
          type: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          expense_request_id?: string
          id?: string
          organization_id?: string
          original_filename?: string
          storage_path?: string
          type?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_attachments_expense_request_id_fkey"
            columns: ["expense_request_id"]
            isOneToOne: false
            referencedRelation: "expense_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      grants: {
        Row: {
          agreement_document_path: string | null
          amount_granted: number
          amount_received: number
          created_at: string
          created_by: string | null
          currency: string
          donor_name: string | null
          id: string
          name: string
          organization_id: string
          received_date: string | null
          revenue_account_id: string | null
          status: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agreement_document_path?: string | null
          amount_granted: number
          amount_received?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          donor_name?: string | null
          id?: string
          name: string
          organization_id: string
          received_date?: string | null
          revenue_account_id?: string | null
          status?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agreement_document_path?: string | null
          amount_granted?: number
          amount_received?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          donor_name?: string | null
          id?: string
          name?: string
          organization_id?: string
          received_date?: string | null
          revenue_account_id?: string | null
          status?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grants_revenue_account_id_fkey"
            columns: ["revenue_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grants_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_budget_lines: {
        Row: {
          budget_line_id: string
          category: string
          created_at: string
          created_by: string | null
          grant_id: string
          id: string
          notes: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget_line_id: string
          category: string
          created_at?: string
          created_by?: string | null
          grant_id: string
          id?: string
          notes?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget_line_id?: string
          category?: string
          created_at?: string
          created_by?: string | null
          grant_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grant_budget_lines_budget_line_id_fkey"
            columns: ["budget_line_id"]
            isOneToOne: false
            referencedRelation: "budget_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_budget_lines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_budget_lines_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_budget_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_budget_lines_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      grant_reports: {
        Row: {
          created_at: string
          data: Json
          generated_by: string | null
          grant_id: string
          id: string
          organization_id: string
          period_end: string
          period_start: string
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          data: Json
          generated_by?: string | null
          grant_id: string
          id?: string
          organization_id: string
          period_end: string
          period_start: string
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          data?: Json
          generated_by?: string | null
          grant_id?: string
          id?: string
          organization_id?: string
          period_end?: string
          period_start?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grant_reports_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_reports_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grant_reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          id: string
          ip_address: string | null
          module: string
          new_value: Json | null
          object_id: string | null
          object_type: string
          occurred_at: string
          old_value: Json | null
          organization_id: string | null
          result: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          id?: string
          ip_address?: string | null
          module: string
          new_value?: Json | null
          object_id?: string | null
          object_type: string
          occurred_at?: string
          old_value?: Json | null
          organization_id?: string | null
          result?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          id?: string
          ip_address?: string | null
          module?: string
          new_value?: Json | null
          object_id?: string | null
          object_type?: string
          occurred_at?: string
          old_value?: Json | null
          organization_id?: string | null
          result?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_amendments: {
        Row: {
          change_description: string
          contract_id: string
          created_at: string
          created_by: string | null
          document_storage_path: string | null
          effective_date: string
          id: string
          organization_id: string
        }
        Insert: {
          change_description: string
          contract_id: string
          created_at?: string
          created_by?: string | null
          document_storage_path?: string | null
          effective_date: string
          id?: string
          organization_id: string
        }
        Update: {
          change_description?: string
          contract_id?: string
          created_at?: string
          created_by?: string | null
          document_storage_path?: string | null
          effective_date?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contract_amendments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_amendments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_amendments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          bank_account_masked: string | null
          base_salary: number | null
          benefits: Json
          created_at: string
          created_by: string | null
          currency: string
          document_storage_path: string | null
          employee_id: string
          end_date: string | null
          id: string
          moncash_number_masked: string | null
          organization_id: string
          payment_method: string | null
          probation_end_date: string | null
          renewal_of_contract_id: string | null
          start_date: string
          status: string
          type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bank_account_masked?: string | null
          base_salary?: number | null
          benefits?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          document_storage_path?: string | null
          employee_id: string
          end_date?: string | null
          id?: string
          moncash_number_masked?: string | null
          organization_id: string
          payment_method?: string | null
          probation_end_date?: string | null
          renewal_of_contract_id?: string | null
          start_date: string
          status?: string
          type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bank_account_masked?: string | null
          base_salary?: number | null
          benefits?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          document_storage_path?: string | null
          employee_id?: string
          end_date?: string | null
          id?: string
          moncash_number_masked?: string | null
          organization_id?: string
          payment_method?: string | null
          probation_end_date?: string | null
          renewal_of_contract_id?: string | null
          start_date?: string
          status?: string
          type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_renewal_of_contract_id_fkey"
            columns: ["renewal_of_contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          organization_id: string
          parent_department_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          organization_id: string
          parent_department_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          organization_id?: string
          parent_department_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_department_id_fkey"
            columns: ["parent_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_documents: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          organization_id: string
          original_filename: string
          storage_path: string
          type: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          organization_id: string
          original_filename: string
          storage_path: string
          type: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          organization_id?: string
          original_filename?: string
          storage_path?: string
          type?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_sensitive_data: {
        Row: {
          address: string | null
          birth_date: string | null
          cin: string | null
          created_at: string
          created_by: string | null
          emergency_contact: Json | null
          employee_id: string
          hr_notes: string | null
          id: string
          nif: string | null
          ninu: string | null
          organization_id: string
          personal_email: string | null
          personal_phone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          cin?: string | null
          created_at?: string
          created_by?: string | null
          emergency_contact?: Json | null
          employee_id: string
          hr_notes?: string | null
          id?: string
          nif?: string | null
          ninu?: string | null
          organization_id: string
          personal_email?: string | null
          personal_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          cin?: string | null
          created_at?: string
          created_by?: string | null
          emergency_contact?: Json | null
          employee_id?: string
          hr_notes?: string | null
          id?: string
          nif?: string | null
          ninu?: string | null
          organization_id?: string
          personal_email?: string | null
          personal_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_sensitive_data_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_sensitive_data_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_sensitive_data_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_sensitive_data_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          first_name: string
          gender: string | null
          hire_date: string
          id: string
          last_name: string
          manager_employee_id: string | null
          matricule: string
          organization_id: string
          photo_url: string | null
          position_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          first_name: string
          gender?: string | null
          hire_date: string
          id?: string
          last_name: string
          manager_employee_id?: string | null
          matricule: string
          organization_id: string
          photo_url?: string | null
          position_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          first_name?: string
          gender?: string | null
          hire_date?: string
          id?: string
          last_name?: string
          manager_employee_id?: string | null
          matricule?: string
          organization_id?: string
          photo_url?: string | null
          position_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_manager_employee_id_fkey"
            columns: ["manager_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      membership_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          membership_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_roles_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membership_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          organization_id: string
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          organization_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      numbering_sequences: {
        Row: {
          created_at: string
          current_value: number
          entity_type: string
          id: string
          last_reset_year: number | null
          organization_id: string
          prefix_pattern: string
          reset_rule: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_value?: number
          entity_type: string
          id?: string
          last_reset_year?: number | null
          organization_id: string
          prefix_pattern: string
          reset_rule?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_value?: number
          entity_type?: string
          id?: string
          last_reset_year?: number | null
          organization_id?: string
          prefix_pattern?: string
          reset_rule?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "numbering_sequences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          default_currency: string
          fiscal_year_start_month: number
          id: string
          legal_name: string | null
          name: string
          settings: Json
          status: string
          tax_id: string | null
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_currency?: string
          fiscal_year_start_month?: number
          id?: string
          legal_name?: string | null
          name: string
          settings?: Json
          status?: string
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_currency?: string
          fiscal_year_start_month?: number
          id?: string
          legal_name?: string | null
          name?: string
          settings?: Json
          status?: string
          tax_id?: string | null
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      permissions: {
        Row: {
          code: string
          created_at: string
          description: string
          id: string
          module: string
        }
        Insert: {
          code: string
          created_at?: string
          description: string
          id?: string
          module: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string
          id?: string
          module?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          created_at: string
          created_by: string | null
          department_id: string | null
          description: string | null
          id: string
          organization_id: string
          reports_to_position_id: string | null
          required_skills: string | null
          responsibilities: string | null
          status: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          organization_id: string
          reports_to_position_id?: string | null
          required_skills?: string | null
          responsibilities?: string | null
          status?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          organization_id?: string
          reports_to_position_id?: string | null
          required_skills?: string | null
          responsibilities?: string | null
          status?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_reports_to_position_id_fkey"
            columns: ["reports_to_position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          id: string
          is_system: boolean
          label: string
          organization_id: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_system?: boolean
          label: string
          organization_id?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_system?: boolean
          label?: string
          organization_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permission_overrides: {
        Row: {
          created_at: string
          effect: string
          expires_at: string | null
          granted_by: string
          id: string
          organization_id: string
          permission_id: string
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          effect: string
          expires_at?: string | null
          granted_by: string
          id?: string
          organization_id: string
          permission_id: string
          reason: string
          user_id: string
        }
        Update: {
          created_at?: string
          effect?: string
          expires_at?: string | null
          granted_by?: string
          id?: string
          organization_id?: string
          permission_id?: string
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permission_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permission_overrides_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permission_overrides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          mfa_enabled: boolean
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          id: string
          mfa_enabled?: boolean
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          mfa_enabled?: boolean
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      budget_line_balances: {
        Row: {
          available_amount: number | null
          budget_id: string | null
          budget_line_id: string | null
          category: string | null
          committed_open: number | null
          organization_id: string | null
          planned_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_assign_role: {
        Args: { p_membership_id: string; p_role_code: string }
        Returns: Json
      }
      admin_create_membership: {
        Args: { p_org_id: string; p_role_code: string; p_user_email: string }
        Returns: Json
      }
      admin_revoke_role: {
        Args: { p_membership_id: string; p_role_code: string }
        Returns: Json
      }
      admin_set_membership_status: {
        Args: { p_membership_id: string; p_status: string }
        Returns: Json
      }
      admin_set_permission_override: {
        Args: {
          p_effect: string
          p_expires_at?: string
          p_org_id: string
          p_permission_code: string
          p_reason: string
          p_target_user_id: string
        }
        Returns: Json
      }
      admin_set_user_status: {
        Args: { p_org_id: string; p_status: string; p_target_user_id: string }
        Returns: Json
      }
      admin_update_organization_settings: {
        Args: {
          p_default_currency?: string
          p_fiscal_year_start_month?: number
          p_legal_name?: string
          p_name?: string
          p_org_id: string
          p_tax_id?: string
          p_timezone?: string
        }
        Returns: Json
      }
      current_user_has_permission: {
        Args: { p_org_id: string; p_permission_code: string }
        Returns: boolean
      }
      next_number: {
        Args: { p_entity_type: string; p_org_id: string }
        Returns: string
      }
      approve_expense_request: {
        Args: { p_comment?: string; p_decision: string; p_expense_id: string }
        Returns: Json
      }
      cancel_expense_request: {
        Args: { p_expense_id: string; p_reason: string }
        Returns: Json
      }
      commit_budget_line: {
        Args: {
          p_amount: number
          p_budget_line_id: string
          p_reference_id: string
          p_reference_type: string
        }
        Returns: Json
      }
      create_grant_budget_line: {
        Args: { p_category: string; p_grant_id: string; p_notes?: string; p_planned_amount: number }
        Returns: Json
      }
      debug_unwanted_function_grants: {
        Args: { p_schema?: string }
        Returns: { function_signature: string; grantee: string }[]
      }
      generate_papej_report: {
        Args: { p_grant_id: string; p_period_end: string; p_period_start: string }
        Returns: Json
      }
      justify_expense_request: {
        Args: { p_expense_id: string }
        Returns: Json
      }
      pay_expense_request: {
        Args: {
          p_expense_id: string
          p_no_commitment_reason?: string
          p_paid_date?: string
          p_treasury_account_id: string
          p_treasury_account_type: string
        }
        Returns: Json
      }
      post_journal_entry: {
        Args: { p_entry_id: string }
        Returns: Json
      }
      record_grant_receipt: {
        Args: {
          p_amount: number
          p_grant_id: string
          p_received_date: string
          p_treasury_account_id: string
          p_treasury_account_type: string
        }
        Returns: Json
      }
      request_expense_approval_exception: {
        Args: { p_expense_id: string; p_justification: string }
        Returns: Json
      }
      reverse_journal_entry: {
        Args: { p_entry_id: string; p_reason: string }
        Returns: Json
      }
      submit_expense_request: {
        Args: { p_expense_id: string }
        Returns: Json
      }
      transfer_budget_amount: {
        Args: { p_amount: number; p_from_line_id: string; p_reason: string; p_to_line_id: string }
        Returns: Json
      }
      validate_expense_approval_exception: {
        Args: { p_comment?: string; p_expense_id: string; p_result: string }
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
    Enums: {},
  },
} as const

