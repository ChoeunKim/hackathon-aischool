import { NextRequest, NextResponse } from 'next/server';
import { orderAgentGraph } from '../../lib/agents/graph';
import { AgentState } from '../../lib/agents/types';
import { OrderState } from '../../types';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error('[route] OPENAI_API_KEY not configured');
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
    }

    const { messages, orderState } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error('[route] Invalid messages:', messages);
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    const initialState: AgentState = {
      messages,
      orderState: orderState || { cart: [], currentItem: null, status: 'init' },
    };

    console.log('[route] Processing request with', messages.length, 'messages');

    const result = await orderAgentGraph.invoke(initialState);

    const content = result.response || '처리 중입니다...';
    const actions = result.actions || [];

    console.log('[route] Success:', { content, actionsCount: actions.length });

    return NextResponse.json({ 
      content,
      actions
    });

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[route] Error:', errorMsg, error);
    return NextResponse.json({ 
      error: 'Failed to process chat', 
      details: errorMsg
    }, { status: 500 });
  }
}
