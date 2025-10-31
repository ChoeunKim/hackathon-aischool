export type OrderStep = 'bread' | 'cheese' | 'vegetables' | 'sauces' | 'quantity' | 'done';
export type OrderStatus = 'init' | 'building' | 'ready' | 'completed' | 'cancelled';

export interface OrderItem {
  menu: string;
  bread: string;
  cheese: string;
  vegetables: string[];
  sauces: string[];
  quantity: number;
  step: OrderStep;
}

export interface OrderState {
  cart: OrderItem[];
  currentItem: OrderItem | null;
  status: OrderStatus;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ActionCommand {
  action: string;
  menu?: string;
  bread?: string;
  cheese?: string;
  addVegetables?: string[];
  removeVegetables?: string[];
  addSauces?: string[];
  removeSauces?: string[];
  quantity?: number;
  target?: number;
  step?: OrderStep;
}
