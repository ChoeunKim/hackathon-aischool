import { StateGraph, END } from '@langchain/langgraph';
import { AgentState } from './types';
import { orderAgent } from './orderAgent';

// Simple wrapper - just call agent, don't process actions
async function processAgent(state: AgentState): Promise<AgentState> {
  return await orderAgent(state);
}

const workflow = new StateGraph({
  channels: {
    messages: {
      reducer: (x: any, y: any) => y ?? x,
      default: () => [],
    },
    orderState: {
      reducer: (x: any, y: any) => y ?? x,
      default: () => ({ cart: [], currentItem: null, status: 'init' }),
    },
    actions: {
      reducer: (x: any, y: any) => y ?? x,
      default: () => [],
    },
    response: {
      reducer: (x: any, y: any) => y ?? x,
      default: () => '',
    },
  },
});

workflow.addNode('process', processAgent);
workflow.setEntryPoint('process');
workflow.addEdge('process', END);

export const orderAgentGraph = workflow.compile();
