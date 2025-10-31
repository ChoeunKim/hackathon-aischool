import { OrderState, OrderItem, ActionCommand } from '../types';
import { MENU, BREAD_OPTIONS, CHEESE_OPTIONS, VEGETABLE_OPTIONS, SAUCE_OPTIONS } from '../constants';

export function createInitialState(): OrderState {
  return {
    cart: [],
    currentItem: null,
    status: 'init'
  };
}

export function createEmptyItem(): OrderItem {
  return {
    menu: '',
    bread: '',
    cheese: '',
    vegetables: [],
    sauces: [],
    quantity: 1,
    step: 'bread'
  };
}

function isValidOption(value: string, options: readonly string[]): boolean {
  return options.includes(value);
}

function addUniqueItems<T>(arr: T[], items: T[]): void {
  items.forEach(item => {
    if (!arr.includes(item)) arr.push(item);
  });
}

function removeItems<T>(arr: T[], items: T[]): void {
  items.forEach(item => {
    const idx = arr.indexOf(item);
    if (idx > -1) arr.splice(idx, 1);
  });
}

export function processAction(state: OrderState, cmd: ActionCommand): string {
  const action = cmd.action;
  console.log('[orderLogic] Processing action:', action, 'with params:', cmd);

  if (action === 'start_item') {
    state.currentItem = createEmptyItem();
    state.status = 'building';
    return 'Started new item.';
  }

  if (action === 'select_menu' && cmd.menu) {
    if (!state.currentItem) return 'No current item.';
    const menu = MENU.find(m => m.name === cmd.menu);
    if (!menu) return 'Invalid menu.';
    
    state.currentItem.menu = cmd.menu;
    state.currentItem.bread = menu.defaultBread;
    state.currentItem.cheese = menu.defaultCheese;
    state.currentItem.vegetables = [...menu.defaultVegetables];
    state.currentItem.sauces = [...menu.defaultSauces];
    return `Menu set: ${cmd.menu}`;
  }

  if (action === 'select_bread') {
    if (!state.currentItem) return 'No current item.';
    if (cmd.bread && isValidOption(cmd.bread, BREAD_OPTIONS)) {
      state.currentItem.bread = cmd.bread;
      return `Bread set: ${cmd.bread}`;
    }
    return 'Bread parameter missing or invalid.';
  }

  if (action === 'select_cheese') {
    if (!state.currentItem) return 'No current item.';
    if (cmd.cheese && isValidOption(cmd.cheese, CHEESE_OPTIONS)) {
      state.currentItem.cheese = cmd.cheese;
      return `Cheese set: ${cmd.cheese}`;
    }
    return 'Cheese parameter missing or invalid.';
  }

  if (action === 'add_vegetables' && cmd.addVegetables) {
    if (!state.currentItem) return 'No current item.';
    const valid = cmd.addVegetables.filter(v => isValidOption(v, VEGETABLE_OPTIONS));
    addUniqueItems(state.currentItem.vegetables, valid);
    return `Added vegetables: ${valid.join(', ')}`;
  }

  if (action === 'remove_vegetables' && cmd.removeVegetables) {
    if (!state.currentItem) return 'No current item.';
    removeItems(state.currentItem.vegetables, cmd.removeVegetables);
    return `Removed vegetables: ${cmd.removeVegetables.join(', ')}`;
  }

  if (action === 'add_sauce' && cmd.addSauces) {
    if (!state.currentItem) return 'No current item.';
    const valid = cmd.addSauces.filter(s => isValidOption(s, SAUCE_OPTIONS));
    addUniqueItems(state.currentItem.sauces, valid);
    return `Added sauces: ${valid.join(', ')}`;
  }

  if (action === 'remove_sauce' && cmd.removeSauces) {
    if (!state.currentItem) return 'No current item.';
    removeItems(state.currentItem.sauces, cmd.removeSauces);
    return `Removed sauces: ${cmd.removeSauces.join(', ')}`;
  }

  if (action === 'set_quantity' && cmd.quantity) {
    if (!state.currentItem) return 'No current item.';
    if (cmd.quantity > 0) {
      state.currentItem.quantity = cmd.quantity;
      return `Quantity set: ${cmd.quantity}`;
    }
    return 'Invalid quantity.';
  }

  if (action === 'set_step' && cmd.step) {
    if (!state.currentItem) return 'No current item.';
    state.currentItem.step = cmd.step;
    return `Step set: ${cmd.step}`;
  }

  if (action === 'add_to_cart') {
    if (!state.currentItem || !state.currentItem.menu) return 'No complete item.';
    state.cart.push(state.currentItem);
    state.currentItem = null;
    return 'Item added to cart.';
  }

  if (action === 'modify_cart_item' && cmd.target !== undefined) {
    const item = state.cart[cmd.target];
    if (!item) return 'Invalid cart target.';
    
    if (cmd.menu) {
      const menu = MENU.find(m => m.name === cmd.menu);
      if (menu) {
        item.menu = cmd.menu;
        item.bread = menu.defaultBread;
        item.cheese = menu.defaultCheese;
        item.vegetables = [...menu.defaultVegetables];
        item.sauces = [...menu.defaultSauces];
      }
    }
    if (cmd.bread && isValidOption(cmd.bread, BREAD_OPTIONS)) item.bread = cmd.bread;
    if (cmd.cheese && isValidOption(cmd.cheese, CHEESE_OPTIONS)) item.cheese = cmd.cheese;
    if (cmd.addVegetables) {
      const valid = cmd.addVegetables.filter(v => isValidOption(v, VEGETABLE_OPTIONS));
      addUniqueItems(item.vegetables, valid);
    }
    if (cmd.removeVegetables) {
      removeItems(item.vegetables, cmd.removeVegetables);
    }
    if (cmd.addSauces) {
      const valid = cmd.addSauces.filter(s => isValidOption(s, SAUCE_OPTIONS));
      addUniqueItems(item.sauces, valid);
    }
    if (cmd.removeSauces) {
      removeItems(item.sauces, cmd.removeSauces);
    }
    if (cmd.quantity && cmd.quantity > 0) item.quantity = cmd.quantity;
    return `Cart item ${cmd.target} modified.`;
  }

  if (action === 'remove_from_cart' && cmd.target !== undefined) {
    if (cmd.target >= 0 && cmd.target < state.cart.length) {
      const removed = state.cart.splice(cmd.target, 1)[0];
      return `Removed ${removed.menu} from cart.`;
    }
  }

  if (action === 'view_cart') {
    return 'Cart view requested.';
  }

  if (action === 'confirm_order') {
    if (state.cart.length > 0) {
      state.status = 'ready';
      return 'Order ready for confirmation.';
    }
    return 'Cart is empty.';
  }

  if (action === 'complete_order') {
    state.status = 'completed';
    return 'Order completed.';
  }

  if (action === 'cancel_order') {
    state.status = 'cancelled';
    return 'Order cancelled.';
  }

  return `Unknown action: ${action}`;
}

export function processCommands(state: OrderState, commands: ActionCommand | ActionCommand[]): string[] {
  const cmdList = Array.isArray(commands) ? commands : [commands];
  return cmdList.map(cmd => processAction(state, cmd));
}
