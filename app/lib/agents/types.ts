import { OrderState, ActionCommand, ChatMessage } from '../../types';

export interface IntentResult {
  intent: 'quick_order' | 'custom_order' | 'modify' | 'info_query' | 'confirm' | 'cancel' | 'view_cart';
  confidence: number;
  extractedInfo?: {
    menus?: string[];
    bread?: string;
    cheese?: string;
    vegetables?: string[];
    sauces?: string[];
    quantity?: number;
  };
}

export interface AgentState {
  messages: ChatMessage[];
  orderState: OrderState;
  actions?: ActionCommand[];
  response?: string;
  intent?: IntentResult;
  error?: string;
}
