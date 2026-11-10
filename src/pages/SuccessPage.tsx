import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Home, Loader2, Search } from 'lucide-react';
import Logo from '@/components/Logo';
import { supabase, Order, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client';

const SuccessPage = () => {
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (!sessionId) {
      console.error('[SuccessPage] Chýba session_id. Stripe nevrátil identifikátor platby, preto sa objednávka nedá uložiť.');
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadOrder = async () => {
      try {
      console.log('[SuccessPage] Ukladám objednávku pre session:', sessionId);
      const response = await fetch(`${SUPABASE_URL}/functions/v1/confirm-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ sessionId }),
      });
      const body = await response.json().catch(() => null);
      console.log('[SuccessPage] confirm-checkout odpoveď:', response.status, body);

      if (!response.ok) {
        console.error('[SuccessPage] Zápis objednávky zlyhal:', {
          status: response.status,
          error: body?.error || body?.message || response.statusText,
          code: body?.code ?? null,
          details: body?.details ?? null,
          hint: body?.hint ?? null,
          body,
        });
      }

      let saved = false;

      if (!cancelled && response.ok && body?.order) {
        console.log('[SuccessPage] Objednávka uložená:', body.order.order_number, 'created:', body.created);
        setOrder(body.order as Order);
        saved = true;
        setIsLoading(false);
        return;
      }

      let attempts = 0;
      const maxAttempts = 8;
      let delay = 1000;

      while (attempts < maxAttempts && !cancelled) {
        const { data: existing, error: readError } = await supabase
          .from('orders')
          .select('*')
          .eq('stripe_session_id', sessionId)
          .maybeSingle();

        if (readError) {
          console.error('[SuccessPage] Čítanie objednávky zlyhalo:', readError.message, readError);
          break;
        }

        if (existing) {
          if (!cancelled) setOrder(existing as Order);
          saved = true;
          break;
        }

        attempts++;
        if (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay = Math.min(delay * 1.5, 5000);
        }
      }

      if (!cancelled && !saved) {
        console.error('[SuccessPage] Objednávka sa do tabuľky orders neuložila. Príčina je v hláške confirm-checkout vyššie.');
      }
      if (!cancelled) setIsLoading(false);
      } catch (error) {
        console.error('[SuccessPage] Zápis objednávky zlyhal:', error);
        if (!cancelled) setIsLoading(false);
      }
    };

    loadOrder();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (isLoading) {
    return (
      <div className="flex w-full flex-grow items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Processing your order...</p>
          <p className="text-sm text-muted-foreground mt-2">This may take a few seconds</p>
        </div>
      </div>
    );
  }

  const orderId = order?.order_number || order?.id?.slice(0, 8).toUpperCase();
  const customerEmail = order?.customer_email;

  return (
    <div className="relative flex w-full flex-grow flex-col bg-background">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative border-b border-border/50 backdrop-blur-sm bg-background/80">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Logo size="md" />
        </div>
      </header>

      {/* Success Content */}
      <div className="relative flex flex-grow items-center justify-center">
        <div className="container mx-auto px-4">
          <div className="glass-card max-w-lg mx-auto p-12 text-center">
            <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            
            <h1 className="text-3xl font-bold mb-4">Payment Successful!</h1>
            
            {orderId && (
              <div className="mb-4">
                <p className="text-muted-foreground mb-2">Your Order ID is</p>
                <p className="text-2xl font-mono font-bold text-primary">
                  {orderId}
                </p>
              </div>
            )}
            
            {customerEmail && (
              <div className="mb-6">
                <p className="text-muted-foreground mb-1">Email</p>
                <p className="text-lg font-medium text-foreground">
                  {customerEmail}
                </p>
              </div>
            )}
            
            <p className="text-muted-foreground mb-8">
              {orderId 
                ? 'Use this ID to track your order status. You will shortly receive an email with instructions.'
                : 'Your payment has been received. You will receive a confirmation email shortly.'}
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/" className="btn-secondary flex items-center justify-center gap-2">
                <Home className="w-4 h-4" />
                Back to Home
              </Link>
              {orderId && customerEmail && (
                <Link 
                  to={`/track?id=${encodeURIComponent(orderId)}&email=${encodeURIComponent(customerEmail)}`} 
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  <Search className="w-4 h-4" />
                  Track Order
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuccessPage;