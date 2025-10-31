'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { OrderState, OrderItem, ChatMessage, ActionCommand } from './types';
import { createInitialState, createEmptyItem, processCommands } from './lib/orderLogic';
import { MENU, BREAD_OPTIONS, CHEESE_OPTIONS, VEGETABLE_OPTIONS, SAUCE_OPTIONS } from './constants';

type Step = 'menu' | 'bread' | 'cheese' | 'vegetables' | 'sauces' | 'quantity' | 'cart';

const INTRO_MESSAGE = `안녕하세요! 서브웨이입니다. 어떤 샌드위치 드릴까요?`;

export default function KioskPage() {
  const router = useRouter();
  const [state, setState] = useState<OrderState>(createInitialState());
  const [step, setStep] = useState<Step>('menu');
  const [currentItem, setCurrentItem] = useState<OrderItem | null>(null);
  const [editingCartIndex, setEditingCartIndex] = useState<number | null>(null);
  
  // Chat related states
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: INTRO_MESSAGE }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoModeRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);

  useEffect(() => {
    autoModeRef.current = autoMode;
  }, [autoMode]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const handleMenuSelect = (menuName: string) => {
    const menu = MENU.find(m => m.name === menuName);
    if (!menu) return;

    const item = createEmptyItem();
    item.menu = menuName;
    item.bread = menu.defaultBread;
    item.cheese = menu.defaultCheese;
    item.vegetables = [...menu.defaultVegetables];
    item.sauces = [...menu.defaultSauces];
    
    setCurrentItem(item);
    setStep('bread');
  };

  const handleBreadSelect = (bread: string) => {
    if (currentItem) {
      setCurrentItem({ ...currentItem, bread });
    }
  };

  const handleCheeseSelect = (cheese: string) => {
    if (currentItem) {
      setCurrentItem({ ...currentItem, cheese });
    }
  };

  const toggleVegetable = (veg: string) => {
    if (!currentItem) return;
    const vegetables = currentItem.vegetables.includes(veg)
      ? currentItem.vegetables.filter(v => v !== veg)
      : [...currentItem.vegetables, veg];
    setCurrentItem({ ...currentItem, vegetables });
  };

  const toggleSauce = (sauce: string) => {
    if (!currentItem) return;
    const sauces = currentItem.sauces.includes(sauce)
      ? currentItem.sauces.filter(s => s !== sauce)
      : [...currentItem.sauces, sauce];
    setCurrentItem({ ...currentItem, sauces });
  };

  const handleCartItemQuantityChange = (index: number, delta: number) => {
    if (editingCartIndex === index && currentItem) {
      // If editing, update currentItem
      const newQty = currentItem.quantity + delta;
      if (newQty > 0) {
        setCurrentItem({ ...currentItem, quantity: newQty });
      }
    } else {
      // Otherwise, update cart directly
      const newCart = [...state.cart];
      const newQty = newCart[index].quantity + delta;
      if (newQty > 0) {
        newCart[index].quantity = newQty;
        setState({ ...state, cart: newCart });
      }
    }
  };

  const addToCart = () => {
    if (!currentItem || !currentItem.menu) return;
    
    if (editingCartIndex !== null) {
      // Update existing cart item
      const newCart = [...state.cart];
      newCart[editingCartIndex] = currentItem;
      setState({ ...state, cart: newCart });
      setEditingCartIndex(null);
    } else {
      // Add new item to cart
      setState({
        ...state,
        cart: [...state.cart, currentItem]
      });
    }
    
    setCurrentItem(null);
    setStep('menu');
  };

  const editCartItem = (index: number, targetStep?: Step) => {
    if (editingCartIndex === index) {
      // Already editing this item, just change step
      setStep(targetStep || 'bread');
    } else {
      // Start editing this item
      const item = state.cart[index];
      setCurrentItem({ ...item });
      setEditingCartIndex(index);
      setStep(targetStep || 'bread');
    }
  };
  
  const cancelEdit = () => {
    setCurrentItem(null);
    setEditingCartIndex(null);
    setStep('menu');
  };

  const removeFromCart = (index: number) => {
    // Don't allow removing item being edited
    if (editingCartIndex === index) return;
    
    setState({
      ...state,
      cart: state.cart.filter((_, i) => i !== index)
    });
    
    // Adjust editingCartIndex if necessary
    if (editingCartIndex !== null && editingCartIndex > index) {
      setEditingCartIndex(editingCartIndex - 1);
    }
  };

  const goToStep = (newStep: Step) => {
    if (!currentItem && newStep !== 'menu') return;
    setStep(newStep);
  };

  const goToPrevStep = () => {
    const steps: Step[] = ['menu', 'bread', 'cheese', 'vegetables', 'sauces', 'quantity'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const goToNextStep = () => {
    const steps: Step[] = ['menu', 'bread', 'cheese', 'vegetables', 'sauces', 'quantity'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const goToPayment = () => {
    if (state.cart.length === 0) return;
    sessionStorage.setItem('orderData', JSON.stringify(state.cart));
    router.push('/payment');
  };

  // Chat functions
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        
        // Clean up audio analysis
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        
        await transcribeAudio(audioBlob);
      };

      // Set up max recording time in auto mode
      if (autoMode) {
        setupVoiceActivityDetection(stream);
      }

      mediaRecorder.start();
      setIsRecording(true);
      console.log('녹음 시작');
    } catch (error) {
      console.error('마이크 접근 실패:', error);
      alert('마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을 허용해주세요.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      // Clean up stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      // Clear silence timeout
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
      
      console.log('녹음 종료');
    }
  };

  const setupVoiceActivityDetection = (stream: MediaStream) => {
    // 최대 녹음 시간 제한 (10초)
    const MAX_RECORDING_TIME = 10000;
    
    const timeout = setTimeout(() => {
      if (isRecordingRef.current && autoModeRef.current) {
        console.log('최대 녹음 시간 초과 - 자동 종료');
        stopRecording();
      }
    }, MAX_RECORDING_TIME);
    
    silenceTimeoutRef.current = timeout;
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    try {
      // Skip if audio is too short
      if (audioBlob.size < 1000) {
        console.log('오디오가 너무 짧음 - 건너뜀');
        return;
      }
      
      setLoading(true);
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Transcription failed');
      }

      const data = await response.json();
      const transcribedText = data.text;
      
      console.log('인식된 텍스트:', transcribedText);
      setInput(transcribedText);
      
      // 자동 전송
      if (transcribedText.trim()) {
        await handleChatSendWithText(transcribedText);
      }
    } catch (error) {
      console.error('음성 인식 오류:', error);
      alert('음성 인식에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  const toggleAutoMode = () => {
    if (!autoMode) {
      // Enable auto mode (Push-to-Talk)
      setAutoMode(true);
    } else {
      // Disable auto mode and stop recording if active
      setAutoMode(false);
      if (isRecording) {
        stopRecording();
      }
    }
  };

  const extractJSON = (text: string | undefined): string | null => {
    if (!text) return null;
    
    // First try to find JSON in code block
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return codeBlockMatch[1].trim();
    }
    
    // Try to find JSON array or object with proper bracket matching
    let depth = 0;
    let start = -1;
    let inString = false;
    let escapeNext = false;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (inString) continue;
      
      if (char === '[' || char === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (char === ']' || char === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          return text.substring(start, i + 1);
        }
      }
    }
    
    return null;
  };

  const validateJSON = (jsonStr: string): { valid: boolean; error?: string } => {
    try {
      const parsed = JSON.parse(jsonStr);
      
      // Check for multiple objects not in array (common mistake)
      if (jsonStr.includes('}\n{') || jsonStr.includes('}{')) {
        return {
          valid: false,
          error: 'Multiple JSON objects detected. Must be in an array format: [{"action":"..."}, {"action":"..."}]'
        };
      }
      
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`
      };
    }
  };

  const handleChatSendWithText = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Create a mutable reference to track state updates
    let workingState = {
      cart: [...state.cart],
      currentItem: state.currentItem ? { ...state.currentItem, 
        vegetables: [...(state.currentItem.vegetables || [])],
        sauces: [...(state.currentItem.sauces || [])],
        step: state.currentItem.step
      } : null,
      status: state.status
    };
    console.log('[Frontend] Sending state to API:', JSON.stringify(workingState));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: [...messages, userMsg],
          orderState: workingState
        })
      });

      const data = await response.json();
      
      console.log('[Frontend] API Response:', {
        hasContent: !!data.content,
        hasActions: !!data.actions,
        actionsLength: data.actions?.length,
        actions: data.actions
      });
      
      if (!data.content) {
        console.error('No content in response:', data);
        setLoading(false);
        return;
      }

      const assistantMsg: ChatMessage = { role: 'assistant', content: data.content };
      setMessages(prev => [...prev, assistantMsg]);

      console.log('[Frontend] AI Response:', data.content);
      
      // New API returns actions directly
      if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
        console.log('[Frontend] ✅ Received actions:', data.actions);
        console.log('[Frontend] State before:', JSON.stringify(workingState));
        const results = processCommands(workingState, data.actions);
        console.log('[Frontend] ✅ Action results:', results);
        console.log('[Frontend] State after:', JSON.stringify(workingState));
        
        // Determine next UI step based on executed actions
        const actionsArr: ActionCommand[] = data.actions;
        const has = (n: string) => actionsArr.some(a => a.action === n);
        let nextStep: Step | undefined;
        if (has('add_to_cart')) nextStep = 'menu';
        else if (has('remove_sauce') || has('add_sauce')) nextStep = 'quantity';
        else if (has('remove_vegetables') || has('add_vegetables')) nextStep = 'sauces';
        else if (has('select_cheese')) nextStep = 'vegetables';
        else if (has('select_bread')) nextStep = 'cheese';
        else if (has('select_menu') || has('start_item')) nextStep = 'bread';
        
        // Update React state with the modified workingState
        const newState = {
          cart: [...workingState.cart],
          currentItem: workingState.currentItem ? { 
            ...workingState.currentItem,
            vegetables: [...(workingState.currentItem.vegetables || [])],
            sauces: [...(workingState.currentItem.sauces || [])],
            step: workingState.currentItem.step
          } : null,
          status: workingState.status
        };
        
        console.log('[Frontend] ✅ Setting React state:', JSON.stringify(newState));
        setState(newState);
        // Sync UI currentItem so that "수정 중" panel reflects the server-driven flow
        setCurrentItem(newState.currentItem);
        // Move UI step consistently with the executed action sequence
        if (nextStep) setStep(nextStep);
        console.log('[Frontend] ✅ Done!');
        setLoading(false);
        return;
      } else {
        console.warn('[Frontend] ⚠️ No actions in response!', {
          hasActions: !!data.actions,
          isArray: Array.isArray(data.actions),
          length: data.actions?.length
        });

        // Fallback: if server provided updated orderState, use it
        if (data.orderState) {
          const serverState: OrderState = data.orderState;
          const newState = {
            cart: serverState.cart.map(it => ({
              ...it,
              vegetables: [...(it.vegetables || [])],
              sauces: [...(it.sauces || [])],
              step: it.step
            })),
            currentItem: serverState.currentItem ? {
              ...serverState.currentItem,
              vegetables: [...(serverState.currentItem.vegetables || [])],
              sauces: [...(serverState.currentItem.sauces || [])],
              step: serverState.currentItem.step
            } : null,
            status: serverState.status
          } as OrderState;

          console.log('[Frontend] ✅ Applying server orderState:', JSON.stringify(newState));
          setState(newState);
          setCurrentItem(newState.currentItem);
          if (newState.currentItem && step === 'menu') {
            setStep('bread');
          }
          setLoading(false);
          return;
        }
      }
      
      // Fallback: try to extract JSON from content
      const jsonStr = extractJSON(data.content);
      console.log('Extracted JSON:', jsonStr);
      
      if (jsonStr) {
        // Validate JSON format
        const validation = validateJSON(jsonStr);
        
        if (!validation.valid) {
          console.error('JSON validation failed:', validation.error);
          
          // Request regeneration with error message
          const regenerationMsg: ChatMessage = {
            role: 'user',
            content: `ERROR: Your JSON format is invalid. ${validation.error}\n\nPlease regenerate your response with valid JSON format. For multiple actions, use array format: [{"action":"..."}, {"action":"..."}]`
          };
          
          setMessages(prev => [...prev, regenerationMsg]);
          
          // Retry the request
          const retryResponse = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [...messages, userMsg, assistantMsg, regenerationMsg],
              orderState: state
            })
          });
          
          if (!retryResponse.ok) {
            console.error('Retry failed:', retryResponse.statusText);
            setLoading(false);
            return;
          }
          
          const retryData = await retryResponse.json();
          const retryAssistantMsg: ChatMessage = { role: 'assistant', content: retryData.content };
          setMessages(prev => [...prev, retryAssistantMsg]);
          
          const retryJsonStr = extractJSON(retryData.content);
          if (!retryJsonStr) {
            console.error('No JSON found in retry response');
            setLoading(false);
            return;
          }
          
          const retryValidation = validateJSON(retryJsonStr);
          if (!retryValidation.valid) {
            console.error('Retry validation also failed:', retryValidation.error);
            setLoading(false);
            return;
          }
          
          // Process the retry JSON
          processValidJSON(retryJsonStr);
        } else {
          // Validation passed on first attempt
          processValidJSON(jsonStr);
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, state.cart, state.currentItem, state.status, loading]);

  const processValidJSON = (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      
      if (typeof parsed === 'object' && Object.keys(parsed).length === 0) {
        console.log('Empty JSON object - no actions to execute');
        return;
      }
      
      const commands: ActionCommand | ActionCommand[] = parsed;
      const commandArray = Array.isArray(commands) ? commands : [commands];
      
      // Create a working copy of state
      let workingState = { ...state, cart: [...state.cart] };
      let workingCurrentItem = currentItem ? { ...currentItem } : null;
      let lastSuggestedStep: Step | undefined;
      
      // Process each command
      for (const cmd of commandArray) {
        const result = processCommand(workingState, workingCurrentItem, cmd);
        workingState = result.state;
        workingCurrentItem = result.currentItem;
        if (result.suggestedStep) {
          lastSuggestedStep = result.suggestedStep;
        }
      }
      
      // Update state
      setState(workingState);
      setCurrentItem(workingCurrentItem);
      
      // Apply suggested step if available
      if (lastSuggestedStep) {
        setStep(lastSuggestedStep);
      }
    } catch (e) {
      console.error('JSON processing error:', e);
      console.error('Failed to process JSON string:', jsonStr);
    }
  };

  const processCommand = (
    workingState: OrderState,
    workingCurrentItem: OrderItem | null,
    cmd: ActionCommand
  ): { state: OrderState; currentItem: OrderItem | null; suggestedStep?: Step } => {
    const action = cmd.action;

    if (action === 'start_item') {
      return {
        state: workingState,
        currentItem: createEmptyItem(),
        suggestedStep: 'menu'
      };
    }

    if (action === 'select_menu' && cmd.menu) {
      const menu = MENU.find(m => m.name === cmd.menu);
      if (menu && workingCurrentItem) {
        workingCurrentItem.menu = cmd.menu;
        workingCurrentItem.bread = menu.defaultBread;
        workingCurrentItem.cheese = menu.defaultCheese;
        workingCurrentItem.vegetables = [...menu.defaultVegetables];
        workingCurrentItem.sauces = [...menu.defaultSauces];
      } else if (menu) {
        workingCurrentItem = createEmptyItem();
        workingCurrentItem.menu = cmd.menu;
        workingCurrentItem.bread = menu.defaultBread;
        workingCurrentItem.cheese = menu.defaultCheese;
        workingCurrentItem.vegetables = [...menu.defaultVegetables];
        workingCurrentItem.sauces = [...menu.defaultSauces];
      }
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'bread' };
    }

    if (action === 'select_bread' && cmd.bread && workingCurrentItem) {
      workingCurrentItem.bread = cmd.bread;
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'bread' };
    }

    if (action === 'select_cheese' && cmd.cheese && workingCurrentItem) {
      workingCurrentItem.cheese = cmd.cheese;
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'cheese' };
    }

    if (action === 'add_vegetables' && cmd.addVegetables && workingCurrentItem) {
      cmd.addVegetables.forEach(veg => {
        if (!workingCurrentItem!.vegetables.includes(veg)) {
          workingCurrentItem!.vegetables.push(veg);
        }
      });
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'vegetables' };
    }

    if (action === 'remove_vegetables' && cmd.removeVegetables && workingCurrentItem) {
      workingCurrentItem.vegetables = workingCurrentItem.vegetables.filter(
        v => !cmd.removeVegetables!.includes(v)
      );
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'vegetables' };
    }

    if (action === 'add_sauce' && cmd.addSauces && workingCurrentItem) {
      cmd.addSauces.forEach(sauce => {
        if (!workingCurrentItem!.sauces.includes(sauce)) {
          workingCurrentItem!.sauces.push(sauce);
        }
      });
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'sauces' };
    }

    if (action === 'remove_sauce' && cmd.removeSauces && workingCurrentItem) {
      workingCurrentItem.sauces = workingCurrentItem.sauces.filter(
        s => !cmd.removeSauces!.includes(s)
      );
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'sauces' };
    }

    if (action === 'set_quantity' && cmd.quantity && workingCurrentItem) {
      workingCurrentItem.quantity = cmd.quantity;
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'quantity' };
    }

    if (action === 'set_step' && cmd.step && workingCurrentItem) {
      workingCurrentItem.step = cmd.step;
      return { state: workingState, currentItem: workingCurrentItem };
    }

    if (action === 'add_to_cart') {
      if (workingCurrentItem && workingCurrentItem.menu) {
        workingState.cart.push(workingCurrentItem);
        workingCurrentItem = null;
      }
      return { state: workingState, currentItem: workingCurrentItem, suggestedStep: 'menu' };
    }

    if (action === 'modify_cart_item' && cmd.target !== undefined) {
      const idx = cmd.target;
      if (idx >= 0 && idx < workingState.cart.length) {
        const item = workingState.cart[idx];
        
        if (cmd.bread) item.bread = cmd.bread;
        if (cmd.cheese) item.cheese = cmd.cheese;
        if (cmd.addVegetables) {
          cmd.addVegetables.forEach(veg => {
            if (!item.vegetables.includes(veg)) item.vegetables.push(veg);
          });
        }
        if (cmd.removeVegetables) {
          item.vegetables = item.vegetables.filter(v => !cmd.removeVegetables!.includes(v));
        }
        if (cmd.addSauces) {
          cmd.addSauces.forEach(sauce => {
            if (!item.sauces.includes(sauce)) item.sauces.push(sauce);
          });
        }
        if (cmd.removeSauces) {
          item.sauces = item.sauces.filter(s => !cmd.removeSauces!.includes(s));
        }
        if (cmd.quantity) item.quantity = cmd.quantity;
      }
      return { state: workingState, currentItem: workingCurrentItem };
    }

    if (action === 'remove_from_cart' && cmd.target !== undefined) {
      const idx = cmd.target;
      if (idx >= 0 && idx < workingState.cart.length) {
        workingState.cart.splice(idx, 1);
      }
      return { state: workingState, currentItem: workingCurrentItem };
    }

    if (action === 'confirm_order') {
      workingState.status = 'ready';
      return { state: workingState, currentItem: workingCurrentItem };
    }

    return { state: workingState, currentItem: workingCurrentItem };
  };

  const handleChatSend = () => {
    handleChatSendWithText(input);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-green-600 text-white p-6 shadow-lg">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-3xl font-bold">SUBWAY 키오스크</h1>
          <div className="text-right">
            <div className="text-sm">장바구니</div>
            <div className="text-2xl font-bold">{state.cart.length}개</div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex">
        {/* Main Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {/* Progress Bar */}
            {currentItem && (
              <div className="mb-8 bg-white rounded-lg p-4 shadow">
                <div className="flex items-center justify-between">
                  {['메뉴', '빵', '치즈', '야채', '소스', '수량'].map((label, idx) => {
                    const stepName = ['menu', 'bread', 'cheese', 'vegetables', 'sauces', 'quantity'][idx] as Step;
                    return (
                      <div key={label} className="flex items-center">
                        <button
                          onClick={() => goToStep(stepName)}
                          className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
                            stepName === step
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                          }`}
                        >
                          {idx + 1}
                        </button>
                        <span className="ml-2 font-medium">{label}</span>
                        {idx < 5 && <div className="w-12 h-1 bg-gray-200 mx-2"></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Menu Selection */}
            {step === 'menu' && (
              <div>
                <h2 className="text-2xl font-bold mb-6">메뉴를 선택해주세요</h2>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                  {MENU.map((menu) => (
                    <button
                      key={menu.name}
                      onClick={() => handleMenuSelect(menu.name)}
                      className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow text-left"
                    >
                      <h3 className="text-xl font-bold mb-2">{menu.name}</h3>
                      <p className="text-gray-600 text-sm">{menu.description}</p>
                      <div className="mt-4 text-xs text-gray-500">
                        <div>추천 빵: {menu.defaultBread}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bread Selection */}
            {step === 'bread' && currentItem && (
              <div>
                <h2 className="text-2xl font-bold mb-2">{currentItem.menu}</h2>
                <h3 className="text-lg text-gray-600 mb-6">빵을 선택해주세요</h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {BREAD_OPTIONS.map((bread) => (
                    <button
                      key={bread}
                      onClick={() => handleBreadSelect(bread)}
                      className={`p-6 rounded-lg border-2 transition-all ${
                        currentItem.bread === bread
                          ? 'border-green-600 bg-green-50'
                          : 'border-gray-200 bg-white hover:border-green-300'
                      }`}
                    >
                      <div className="text-lg font-bold">{bread}</div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={goToPrevStep}
                    className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300"
                  >
                    이전
                  </button>
                  <button
                    onClick={goToNextStep}
                    className="flex-1 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700"
                  >
                    다음
                  </button>
                  <button
                    onClick={addToCart}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                  >
                    장바구니 담기
                  </button>
                </div>
              </div>
            )}

            {/* Cheese Selection */}
            {step === 'cheese' && currentItem && (
              <div>
                <h2 className="text-2xl font-bold mb-2">{currentItem.menu}</h2>
                <h3 className="text-lg text-gray-600 mb-6">치즈를 선택해주세요</h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {CHEESE_OPTIONS.map((cheese) => (
                    <button
                      key={cheese}
                      onClick={() => handleCheeseSelect(cheese)}
                      className={`p-6 rounded-lg border-2 transition-all ${
                        currentItem.cheese === cheese
                          ? 'border-green-600 bg-green-50'
                          : 'border-gray-200 bg-white hover:border-green-300'
                      }`}
                    >
                      <div className="text-lg font-bold">{cheese}</div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={goToPrevStep}
                    className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300"
                  >
                    이전
                  </button>
                  <button
                    onClick={goToNextStep}
                    className="flex-1 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700"
                  >
                    다음
                  </button>
                  <button
                    onClick={addToCart}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                  >
                    장바구니 담기
                  </button>
                </div>
              </div>
            )}

            {/* Vegetables Selection */}
            {step === 'vegetables' && currentItem && (
              <div>
                <h2 className="text-2xl font-bold mb-2">{currentItem.menu}</h2>
                <h3 className="text-lg text-gray-600 mb-6">야채를 선택해주세요 (여러 개 선택 가능)</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {VEGETABLE_OPTIONS.map((veg) => (
                    <button
                      key={veg}
                      onClick={() => toggleVegetable(veg)}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        currentItem.vegetables.includes(veg)
                          ? 'border-green-600 bg-green-50'
                          : 'border-gray-200 bg-white hover:border-green-300'
                      }`}
                    >
                      <div className="font-bold">{veg}</div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={goToPrevStep}
                    className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300"
                  >
                    이전
                  </button>
                  <button
                    onClick={goToNextStep}
                    className="flex-1 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700"
                  >
                    다음
                  </button>
                  <button
                    onClick={addToCart}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                  >
                    장바구니 담기
                  </button>
                </div>
              </div>
            )}

            {/* Sauces Selection */}
            {step === 'sauces' && currentItem && (
              <div>
                <h2 className="text-2xl font-bold mb-2">{currentItem.menu}</h2>
                <h3 className="text-lg text-gray-600 mb-6">소스를 선택해주세요 (여러 개 선택 가능)</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                  {SAUCE_OPTIONS.map((sauce) => (
                    <button
                      key={sauce}
                      onClick={() => toggleSauce(sauce)}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        currentItem.sauces.includes(sauce)
                          ? 'border-green-600 bg-green-50'
                          : 'border-gray-200 bg-white hover:border-green-300'
                      }`}
                    >
                      <div className="font-bold">{sauce}</div>
                    </button>
                  ))}
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={goToPrevStep}
                    className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300"
                  >
                    이전
                  </button>
                  <button
                    onClick={goToNextStep}
                    className="flex-1 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700"
                  >
                    다음
                  </button>
                  <button
                    onClick={addToCart}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                  >
                    장바구니 담기
                  </button>
                </div>
              </div>
            )}

            {/* Quantity Selection */}
            {step === 'quantity' && currentItem && (
              <div>
                <h2 className="text-2xl font-bold mb-2">{currentItem.menu}</h2>
                <h3 className="text-lg text-gray-600 mb-6">수량을 선택해주세요</h3>
                <div className="bg-white p-8 rounded-lg shadow mb-6">
                  <div className="flex items-center justify-center gap-8">
                    <button
                      onClick={() => setCurrentItem({ ...currentItem, quantity: Math.max(1, currentItem.quantity - 1) })}
                      disabled={currentItem.quantity <= 1}
                      className="w-16 h-16 rounded-full bg-gray-200 text-2xl font-bold hover:bg-gray-300 disabled:opacity-30"
                    >
                      -
                    </button>
                    <div className="text-4xl font-bold">{currentItem.quantity}</div>
                    <button
                      onClick={() => setCurrentItem({ ...currentItem, quantity: currentItem.quantity + 1 })}
                      className="w-16 h-16 rounded-full bg-green-600 text-white text-2xl font-bold hover:bg-green-700"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={goToPrevStep}
                    className="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300"
                  >
                    이전
                  </button>
                  <button
                    onClick={addToCart}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700"
                  >
                    장바구니 담기
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Cart Sidebar */}
        <div className="w-96 bg-white border-l shadow-lg p-6 overflow-y-auto">
          <h2 className="text-xl font-bold mb-4">주문 현황</h2>
          
          {/* Current Item Being Customized */}
          {currentItem && currentItem.menu && (
            <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-blue-900">
                  {editingCartIndex !== null ? '✏️ 수정 중' : '📝 커스터마이징 중'}
                </h3>
                <button
                  onClick={cancelEdit}
                  className="text-blue-600 hover:text-blue-800 text-sm"
                >
                  취소
                </button>
              </div>
              <div className="text-sm space-y-1">
                <div className="font-bold text-lg mb-2">{currentItem.menu}</div>
                <button
                  onClick={() => setStep('bread')}
                  className="w-full text-left px-2 py-1 rounded hover:bg-blue-100 text-gray-700"
                >
                  빵: {currentItem.bread}
                </button>
                <button
                  onClick={() => setStep('cheese')}
                  className="w-full text-left px-2 py-1 rounded hover:bg-blue-100 text-gray-700"
                >
                  치즈: {currentItem.cheese}
                </button>
                <button
                  onClick={() => setStep('vegetables')}
                  className="w-full text-left px-2 py-1 rounded hover:bg-blue-100 text-gray-700"
                >
                  야채: {currentItem.vegetables.length > 0 ? currentItem.vegetables.join(', ') : '없음'}
                </button>
                <button
                  onClick={() => setStep('sauces')}
                  className="w-full text-left px-2 py-1 rounded hover:bg-blue-100 text-gray-700"
                >
                  소스: {currentItem.sauces.length > 0 ? currentItem.sauces.join(', ') : '없음'}
                </button>
                <button
                  onClick={() => setStep('quantity')}
                  className="w-full text-left px-2 py-1 rounded hover:bg-blue-100 text-gray-700"
                >
                  수량: {currentItem.quantity}개
                </button>
              </div>
              <button
                onClick={addToCart}
                className="w-full mt-3 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 text-sm"
              >
                장바구니에 담기
              </button>
            </div>
          )}

          {/* Cart Items */}
          <h3 className="text-lg font-bold mb-3">장바구니 {state.cart.length > 0 && `(${state.cart.length})`}</h3>
          
          {state.cart.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <div className="text-5xl mb-4">🛒</div>
              <div>장바구니가 비어있습니다</div>
            </div>
          ) : (
            <>
              <div className="space-y-3 mb-6">
                {state.cart.map((item, idx) => {
                  const displayItem = editingCartIndex === idx && currentItem ? currentItem : item;
                  return (
                    <div 
                      key={idx} 
                      className={`p-4 rounded-lg border-2 transition-colors ${
                        editingCartIndex === idx 
                          ? 'bg-blue-50 border-blue-300' 
                          : 'bg-gray-50 border-transparent hover:border-green-300'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold">
                          {displayItem.menu}
                          {editingCartIndex === idx && <span className="ml-2 text-xs text-blue-600">(수정 중)</span>}
                        </div>
                        <button
                          onClick={() => removeFromCart(idx)}
                          className="text-red-500 hover:text-red-700 ml-2"
                          disabled={editingCartIndex === idx}
                        >
                          ✕
                        </button>
                      </div>
                      <div className="text-sm space-y-1">
                        <button
                          onClick={() => editCartItem(idx, 'bread')}
                          className="w-full text-left px-2 py-1 rounded hover:bg-white text-gray-600"
                        >
                          빵: {displayItem.bread}
                        </button>
                        <button
                          onClick={() => editCartItem(idx, 'cheese')}
                          className="w-full text-left px-2 py-1 rounded hover:bg-white text-gray-600"
                        >
                          치즈: {displayItem.cheese}
                        </button>
                        <button
                          onClick={() => editCartItem(idx, 'vegetables')}
                          className="w-full text-left px-2 py-1 rounded hover:bg-white text-gray-600"
                        >
                          야채: {displayItem.vegetables.length > 0 ? displayItem.vegetables.join(', ') : '없음'}
                        </button>
                        <button
                          onClick={() => editCartItem(idx, 'sauces')}
                          className="w-full text-left px-2 py-1 rounded hover:bg-white text-gray-600"
                        >
                          소스: {displayItem.sauces.length > 0 ? displayItem.sauces.join(', ') : '없음'}
                        </button>
                      </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                      <span className="text-sm font-medium">수량:</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleCartItemQuantityChange(idx, -1)}
                          className="w-7 h-7 rounded bg-gray-200 hover:bg-gray-300 font-bold text-sm"
                        >
                          -
                        </button>
                        <span className="font-bold w-8 text-center">{displayItem.quantity}</span>
                        <button
                          onClick={() => handleCartItemQuantityChange(idx, 1)}
                          className="w-7 h-7 rounded bg-green-600 hover:bg-green-700 text-white font-bold text-sm"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="border-t pt-4 space-y-3">
                <div className="flex justify-between text-lg font-bold">
                  <span>총 수량</span>
                  <span>{state.cart.reduce((sum, item) => sum + item.quantity, 0)}개</span>
                </div>
                <button
                  onClick={goToPayment}
                  className="w-full py-4 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700"
                >
                  결제하기
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Floating Chat Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {chatOpen ? (
          <div className="bg-white rounded-lg shadow-2xl w-96 h-[500px] flex flex-col">
            {/* Chat Header */}
            <div className="bg-green-600 text-white p-4 rounded-t-lg">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold">AI 주문 도우미</h3>
                  {autoMode && (
                    <div className="text-xs mt-1 flex items-center gap-1">
                      <span className={isRecording ? 'animate-pulse' : ''}>
                        {isRecording ? '🎤 녹음 중...' : loading ? '⏳ AI 응답 중...' : '👆 버튼을 누르고 말하세요'}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (autoMode) {
                      setAutoMode(false);
                      stopRecording();
                    }
                    setChatOpen(false);
                  }}
                  className="text-white hover:text-gray-200"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-4 py-2 rounded-lg ${
                    msg.role === 'user' 
                      ? 'bg-green-600 text-white' 
                      : 'bg-white border shadow-sm'
                  }`}>
                    {msg.content.replace(/```json[\s\S]*?```/g, '').trim()}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 bg-white border-t rounded-b-lg">
              <div className="flex gap-2 mb-2">
                <button
                  onClick={toggleAutoMode}
                  disabled={loading}
                  className={`flex-1 px-4 py-2 rounded-lg font-bold transition-all ${
                    autoMode
                      ? 'bg-green-500 text-white shadow-lg'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                  } disabled:opacity-50`}
                >
                  {autoMode ? '🎤 자동 대화 중' : '🎙️ 자동 대화 시작'}
                </button>
              </div>
              {autoMode && (
                <div className="mb-2 text-xs text-gray-600 bg-blue-50 p-2 rounded">
                  💡 팀: 녹음 버튼을 <strong>누르고 있는 동안만</strong> 녹음됩니다. 말을 마치면 버튼을 떼세요!
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onMouseDown={() => autoMode && !loading && startRecording()}
                  onMouseUp={() => autoMode && isRecording && stopRecording()}
                  onTouchStart={() => autoMode && !loading && startRecording()}
                  onTouchEnd={() => autoMode && isRecording && stopRecording()}
                  onClick={() => !autoMode && (isRecording ? stopRecording() : startRecording())}
                  disabled={loading && !autoMode}
                  className={`px-3 py-2 rounded-lg transition-all ${
                    isRecording 
                      ? 'bg-red-500 text-white animate-pulse' 
                      : autoMode
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'bg-gray-200 hover:bg-gray-300'
                  } disabled:opacity-50 ${autoMode ? 'cursor-pointer select-none' : ''}`}
                  title={autoMode ? '누르고 있는 동안 녹음 (Push-to-Talk)' : isRecording ? '녹음 중... (클릭하여 종료)' : '수동 음성 입력'}
                >
                  {isRecording ? '🎤' : '🎙️'}
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !loading && handleChatSend()}
                  placeholder={autoMode ? '녹음 버튼을 누르고 말하세요' : isRecording ? '녹음 중...' : '메뉴를 말씀해주세요...'}
                  className="flex-1 px-3 py-2 border rounded-lg text-sm"
                  disabled={loading || isRecording || autoMode}
                />
                <button
                  onClick={handleChatSend}
                  disabled={loading || !input.trim() || autoMode}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {loading ? '...' : '전송'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="bg-green-600 text-white p-4 rounded-full shadow-lg hover:bg-green-700 transition-all hover:scale-110"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
