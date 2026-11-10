import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Mail, Hash, Clock, Package, CheckCircle, Download, AlertCircle, ArrowLeft } from 'lucide-react';
import Logo from '@/components/Logo';
import { supabase, Order } from '@/integrations/supabase/client';
import { SERVICES } from '@/data/services';

const CheckOrderPage = () => {
  const [orderNumber, setOrderNumber] = useState('');
  const [email, setEmail] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const fetchOrder = async () => {
    if (!orderNumber.trim() || !email.trim()) {
      setError('Please enter both Order ID and Email');
      return;
    }
    
    setLoading(true);
    setError(null);
    setSearched(true);
    
    try {
      let query = supabase
        .from('orders')
        .select('*')
        .eq('customer_email', email.toLowerCase().trim());

      if (orderNumber.toUpperCase().startsWith('RP-')) {
        query = query.eq('order_number', orderNumber.toUpperCase());
      } else {
        query = query.or(`id.eq.${orderNumber},order_number.eq.${orderNumber.toUpperCase()}`);
      }

      const { data, error: fetchError } = await query.maybeSingle();

      if (fetchError) throw fetchError;
      
      if (!data) {
        setError('Order not found. Please verify your Order ID and Email.');
        setOrder(null);
      } else {
        setOrder(data as Order);
      }
    } catch (err) {
      console.error('Fetch error:', err);
      setError('Failed to fetch order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getStatusStep = (status: string) => {
    switch (status) {
      case 'pending': return 1;
      case 'processing': return 2;
      case 'completed': return 3;
      default: return 0;
    }
  };

  const getSelectedServices = () => {
    if (!order?.service_type) return [];
    const serviceIds = Array.isArray(order.service_type) 
      ? order.service_type 
      : JSON.parse(order.service_type as unknown as string);
    return serviceIds.map((id: string) => SERVICES.find((s) => s.id === id)?.name).filter(Boolean);
  };

  const currentStep = order ? getStatusStep(order.status) : 0;
  const selectedServices = getSelectedServices();

  return (
    <div className="flex w-full flex-grow flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            <Logo size="sm" />
          </Link>
          <Link to="/order" className="btn-primary text-sm py-2">
            New Order
          </Link>
        </div>
      </header>

      <div className="container mx-auto max-w-xl flex-grow px-4 py-12">
        {/* Title */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-2">Check Your Order</h1>
          <p className="text-muted-foreground">
            Enter your Order ID and Email to view status
          </p>
        </div>

        {/* Search Card */}
        <div className="glass-card p-6 mb-8 border border-white/10">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-muted-foreground">Order ID</label>
              <div className="relative">
                <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="e.g., RP-A7K92X"
                  className="input-field w-full pl-12 border border-white/20 focus:border-white/40"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-muted-foreground">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="input-field w-full pl-12 border border-white/20 focus:border-white/40"
                  onKeyDown={(e) => e.key === 'Enter' && fetchOrder()}
                />
              </div>
            </div>
            <button 
              onClick={fetchOrder}
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Search className="w-4 h-4" />
              {loading ? 'Searching...' : 'Find Order'}
            </button>
          </div>
        </div>

        {/* Error State */}
        {error && searched && (
          <div className="glass-card p-6 border border-destructive/30 flex items-center gap-4 mb-8">
            <AlertCircle className="w-8 h-8 text-destructive flex-shrink-0" />
            <div>
              <p className="font-medium text-destructive">{error}</p>
              <p className="text-sm text-muted-foreground">Check your details and try again</p>
            </div>
          </div>
        )}

        {/* Order Found */}
        {order && (
          <div className="space-y-6 animate-fadeIn">
            {/* Order ID Badge */}
            <div className="glass-card p-4 border border-white/20 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Order ID</p>
                <p className="text-xl font-mono font-bold text-white">
                  {order.order_number || order.id.slice(0, 8).toUpperCase()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Date</p>
                <p className="font-medium text-white">
                  {new Date(order.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>

            {/* Visual Timeline */}
            <div className="glass-card p-8 border border-white/20">
              <h3 className="font-semibold mb-8 text-center text-lg">Order Progress</h3>
              
              <div className="relative">
                {/* Progress Line */}
                <div className="absolute top-6 left-0 right-0 h-1 bg-secondary rounded-full mx-12">
                  <div 
                    className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-primary to-green-500"
                    style={{ width: currentStep === 1 ? '0%' : currentStep === 2 ? '50%' : '100%' }}
                  />
                </div>
                
                {/* Steps */}
                <div className="relative flex justify-between">
                  {/* Step 1: Received */}
                  <div className="flex flex-col items-center z-10">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                      currentStep >= 1 
                        ? 'bg-primary/20 border-primary text-primary' 
                        : 'bg-secondary border-muted-foreground/30 text-muted-foreground'
                    }`}>
                      <Clock className="w-5 h-5" />
                    </div>
                    <p className={`mt-3 text-sm font-medium ${currentStep >= 1 ? 'text-primary' : 'text-muted-foreground'}`}>
                      Received
                    </p>
                  </div>

                  {/* Step 2: Processing */}
                  <div className="flex flex-col items-center z-10">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                      currentStep >= 2 
                        ? 'bg-primary/20 border-primary text-primary shadow-[0_0_15px_hsl(185_100%_50%/0.4)]' 
                        : 'bg-secondary border-muted-foreground/30 text-muted-foreground'
                    }`}>
                      <Package className="w-5 h-5" />
                    </div>
                    <p className={`mt-3 text-sm font-medium ${currentStep >= 2 ? 'text-primary' : 'text-muted-foreground'}`}>
                      Processing
                    </p>
                  </div>

                  {/* Step 3: Completed */}
                  <div className="flex flex-col items-center z-10">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all ${
                      currentStep >= 3 
                        ? 'bg-green-500/20 border-green-500 text-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]' 
                        : 'bg-secondary border-muted-foreground/30 text-muted-foreground'
                    }`}>
                      <CheckCircle className="w-5 h-5" />
                    </div>
                    <p className={`mt-3 text-sm font-medium ${currentStep >= 3 ? 'text-green-500' : 'text-muted-foreground'}`}>
                      Completed
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Vehicle & Services */}
            <div className="glass-card p-6 border border-white/20">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Vehicle</p>
                  <p className="font-medium">{order.car_brand} {order.car_model}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Fuel / Year</p>
                  <p className="font-medium">
                    {order.fuel_type || '—'}{order.fuel_type && order.year ? ' • ' : ''}{order.year || ''}
                  </p>
                </div>
              </div>
              <div className="pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Services</p>
                <div className="flex flex-wrap gap-2">
                  {selectedServices.map((service, idx) => (
                    <span key={idx} className="px-2 py-1 bg-primary/10 text-primary rounded text-xs">
                      {service}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
                <span className="text-muted-foreground">Total</span>
                <span className="text-xl font-bold neon-text">{order.total_price}€</span>
              </div>
            </div>

            {/* Download Button - Only show if completed with result file */}
            {order.status === 'completed' && order.result_file_url && (
              <a
                href={order.result_file_url}
                download
                className="block w-full py-5 px-6 rounded-xl font-bold text-lg text-center transition-all
                  bg-gradient-to-r from-primary to-green-500 text-background
                  hover:shadow-[0_0_40px_hsl(185_100%_50%/0.5)] hover:scale-[1.02]
                  border border-white/20"
              >
                <div className="flex items-center justify-center gap-3">
                  <Download className="w-6 h-6" />
                  Download Your Remap
                </div>
              </a>
            )}

            {/* Status Messages */}
            {order.status === 'pending' && (
              <div className="glass-card p-6 border border-orange-500/30 text-center">
                <Clock className="w-8 h-8 text-orange-500 mx-auto mb-3" />
                <p className="text-orange-400 font-medium">Your order is in queue</p>
                <p className="text-sm text-muted-foreground mt-1">Our engineers will start processing soon</p>
              </div>
            )}

            {order.status === 'processing' && (
              <div className="glass-card p-6 border border-primary/30 text-center">
                <Package className="w-8 h-8 text-primary mx-auto mb-3 animate-pulse" />
                <p className="text-primary font-medium">Currently being remapped</p>
                <p className="text-sm text-muted-foreground mt-1">You'll receive an email when ready</p>
              </div>
            )}

            {order.status === 'completed' && !order.result_file_url && (
              <div className="glass-card p-6 border border-green-500/30 text-center">
                <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-3" />
                <p className="text-green-400 font-medium">Order completed</p>
                <p className="text-sm text-muted-foreground mt-1">Download file will be available shortly</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckOrderPage;
