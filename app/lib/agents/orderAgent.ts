import { ChatOpenAI } from '@langchain/openai';
import { AgentState } from './types';
import { MENU, BREAD_OPTIONS, CHEESE_OPTIONS, VEGETABLE_OPTIONS, SAUCE_OPTIONS } from '../../constants';

const model = new ChatOpenAI({
  modelName: 'gpt-5-nano-2025-08-07',
});

export async function orderAgent(state: AgentState): Promise<AgentState> {
  const { messages, orderState } = state;
  const item = orderState.currentItem;
  const currentStep = item?.step || 'bread';
  const menu = item?.menu ? MENU.find(m => m.name === item.menu) : null;

  const systemPrompt = `You are a Subway kiosk assistant. Handle step-by-step ordering.

MENUS: ${MENU.map(m => m.name).join(', ')}
BREAD: ${BREAD_OPTIONS.join(', ')}
CHEESE: ${CHEESE_OPTIONS.join(', ')}
VEGETABLES: ${VEGETABLE_OPTIONS.join(', ')}
SAUCES: ${SAUCE_OPTIONS.join(', ')}

CURRENT STATE:
${item ? `
✅ ACTIVE ITEM (수정 중):
- Menu: ${item.menu || 'none'}
- Bread: ${item.bread || 'none'}
- Cheese: ${item.cheese || 'none'}
- Vegetables: ${item.vegetables?.length ? item.vegetables.join(', ') : 'none'}
- Sauces: ${item.sauces?.length ? item.sauces.join(', ') : 'none'}
- Quantity: ${item.quantity}
${menu ? `- Default vegetables: ${menu.defaultVegetables.join(', ')}` : ''}

⚠️ VALID ACTIONS: select_bread, select_cheese, add_vegetables, remove_vegetables, add_sauce, remove_sauce, set_quantity, add_to_cart
❌ CANNOT use: start_item (already exists), modify_cart_item (use only for cart items)
` : `
❌ NO ACTIVE ITEM:
⚠️ VALID ACTIONS: start_item + select_menu (new item), OR modify_cart_item (edit cart item directly), OR remove_from_cart (delete cart item)
❌ CANNOT use: select_bread, select_cheese, add_vegetables, remove_vegetables, add_sauce, remove_sauce, add_to_cart (no active item)
`}

CART STATUS: ${state.orderState.cart.length} items
${state.orderState.cart.length > 0 ? state.orderState.cart.map((cartItem, idx) => 
  `[${idx}] ${cartItem.menu} - ${cartItem.bread}, ${cartItem.cheese}, ${cartItem.vegetables.join(', ')}, ${cartItem.sauces.join(', ')} (x${cartItem.quantity})`
).join('\n') : 'Empty'}

🔥 CRITICAL RULES:
1. **STATE VALIDATION**: Check current state before action
   - NO currentItem? → Can start new (start_item + select_menu) OR modify cart (modify_cart_item with target + params)
   - Has currentItem? → Can modify current (bread, cheese, vegetables, sauces, quantity) or add_to_cart
   - NEVER try to modify currentItem when it doesn't exist!

2. **Workflow**: 
   - New item: start_item → select_menu → customize (optional) → add_to_cart
   - Modify cart: modify_cart_item with target + modification params (bread, cheese, addVegetables, removeSauces, etc.)

3. **Menu selection**: Automatically sets default bread, cheese, vegetables, sauces

4. **Cart modification**: 
   - User says "첫번째", "1번", "방금 담은거" → target: 0 (most recent)
   - User says "두번째", "2번" → target: 1
   - If only 1 item in cart and user says "빵 수정", "치즈 바꿔줘" → modify_cart_item with target:0 and specific param
   - modify_cart_item modifies cart item DIRECTLY (stays in cart)

Response format (MANDATORY):
[Korean text]
\`\`\`json
[{"action":"...", ...}]
\`\`\`

EXAMPLES:

✅ CORRECT - Starting new order:
User: "햄 주세요"
${!item ? '(No currentItem - can start)' : '(Has currentItem - cannot start again)'}
\`\`\`json
[{"action":"start_item"}, {"action":"select_menu","menu":"햄"}]
\`\`\`

✅ CORRECT - Modifying active item:
User: "토마토 빼주세요"
${item ? '(Has currentItem - can modify)' : '(No currentItem - CANNOT modify!)'}
\`\`\`json
[{"action":"remove_vegetables","removeVegetables":["토마토"]}]
\`\`\`

❌ WRONG - Modifying when no item:
User: "토마토 빼주세요"
${!item ? '(No currentItem - INVALID!)' : ''}
Response: "먼저 메뉴를 선택해주세요. 어떤 샌드위치를 원하시나요?"
\`\`\`json
[]
\`\`\`

✅ CORRECT - Adding to cart:
User: "담아주세요"
${item ? '(Has currentItem - can add)' : '(No currentItem - CANNOT add!)'}
\`\`\`json
[{"action":"add_to_cart"}]
\`\`\`

✅ CORRECT - Quick order:
User: "햄 추천으로 주세요"
\`\`\`json
[{"action":"start_item"}, {"action":"select_menu","menu":"햄"}, {"action":"add_to_cart"}]
\`\`\`

✅ CORRECT - Multiple vegetables:
User: "토마토 빼고 올리브 추가해주세요"
${item ? '(Has currentItem - can modify)' : ''}
\`\`\`json
[{"action":"remove_vegetables","removeVegetables":["토마토"]}, {"action":"add_vegetables","addVegetables":["올리브"]}]
\`\`\`

✅ CORRECT - Modify cart item bread (no currentItem, has cart):
User: "빵을 플랫브레드로 바꿔줘요"
${!item && state.orderState.cart.length > 0 ? '(No currentItem but has cart - modify cart item 0)' : ''}
\`\`\`json
[{"action":"modify_cart_item","target":0,"bread":"플랫브레드"}]
\`\`\`
Response: "첫 번째 ${state.orderState.cart[0]?.menu || '샌드위치'} 빵을 플랫브레드로 변경했습니다!"

✅ CORRECT - Modify cart vegetables:
User: "방금 담은거 토마토 빼주세요"
${!item && state.orderState.cart.length > 0 ? '(No currentItem but has cart - modify cart item 0)' : ''}
\`\`\`json
[{"action":"modify_cart_item","target":0,"removeVegetables":["토마토"]}]
\`\`\`
Response: "토마토 빼드렸습니다!"

✅ CORRECT - Modify cart cheese:
User: "치즈를 슈레드치즈로 바꿔주세요"
${!item && state.orderState.cart.length > 0 ? '(No currentItem but has cart)' : ''}
\`\`\`json
[{"action":"modify_cart_item","target":0,"cheese":"슈레드치즈"}]
\`\`\`

✅ CORRECT - Remove cart item:
User: "첫 번째 취소할게요"
\`\`\`json
[{"action":"remove_from_cart","target":0}]
\`\`\`

❌ WRONG - Trying to modify currentItem when it doesn't exist:
User: "빵 바꿔줘요"
${!item ? '(No currentItem - should modify CART!)' : ''}
WRONG: [{"action":"select_bread","bread":"..."}]
RIGHT: [{"action":"modify_cart_item","target":0,"bread":"..."}]

REMEMBER: 
- Check if currentItem exists before modifying!
- If no currentItem but cart has items, use modify_cart_item (modifies cart directly)
- modify_cart_item keeps item in cart - no need for add_to_cart after
- Default to target:0 (most recent) if not specified`;

  try {
    const langchainMessages = messages.map(msg => ({
      type: msg.role,
      content: msg.content
    }));

    const result = await model.invoke([
      { type: 'system', content: systemPrompt },
      ...langchainMessages
    ]);

    const content = result.content as string;
    const jsonMatch = content.match(/\`\`\`json\s*([\s\S]*?)\`\`\`/);
    let actions = [];
    
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) {
          actions = parsed;
        } else if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          actions = [parsed];
        }
        // Empty object {} or empty array [] = no actions
      } catch (e) {
        console.error('[orderAgent] JSON parse error:', e, 'Content:', jsonMatch[1]);
      }
    }

    const response = content.split('```json')[0].trim();
    
    // Validate actions against current state
    if (actions.length > 0) {
      const hasItem = !!orderState.currentItem;
      const hasCart = orderState.cart.length > 0;
      
      const invalidActions = actions.filter((a, idx) => {
        const modifyCurrentActions = ['select_bread', 'select_cheese', 'add_vegetables', 'remove_vegetables', 'add_sauce', 'remove_sauce', 'set_quantity', 'add_to_cart'];
        
        // Cannot modify currentItem if it doesn't exist
        if (!hasItem && modifyCurrentActions.includes(a.action)) {
          console.warn('[orderAgent] Invalid action without currentItem:', a.action);
          return true;
        }
        
        // Cannot start_item if already exists UNLESS it comes after add_to_cart
        if (hasItem && a.action === 'start_item') {
          const addToCartIndex = actions.findIndex(ac => ac.action === 'add_to_cart');
          if (addToCartIndex === -1 || idx < addToCartIndex) {
            console.warn('[orderAgent] Duplicate start_item with existing currentItem');
            return true;
          }
        }
        
        // Validate modify_cart_item has valid target
        if (a.action === 'modify_cart_item') {
          if (!hasCart) {
            console.warn('[orderAgent] Cannot modify_cart_item: cart is empty');
            return true;
          }
          if (a.target === undefined || a.target < 0 || a.target >= orderState.cart.length) {
            console.warn('[orderAgent] Invalid cart target:', a.target, 'cart length:', orderState.cart.length);
            return true;
          }
        }
        
        return false;
      });
      
      if (invalidActions.length > 0) {
        console.log('[orderAgent] Filtered out invalid actions:', invalidActions);
        actions = actions.filter(a => !invalidActions.includes(a));
      }
    }

    return {
      ...state,
      actions,
      response
    };
  } catch (error) {
    console.error('Agent error:', error);
    return {
      ...state,
      actions: [],
      response: '죄송합니다. 다시 말씀해주세요.'
    };
  }
}
