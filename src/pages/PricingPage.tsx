import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, ShoppingCart, Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';
import { SERVICES, Service } from '@/data/services';
import { redirectToCheckout, generateOrderId } from '@/lib/stripe';
import { toast } from 'sonner';

const PricingPage = () => {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  const stageServices = SERVICES.filter((s) => s.category === 'stage');
  const removalServices = SERVICES.filter((s) => s.category === 'removal');
  const modificationServices = SERVICES.filter((s) => s.category === 'modification');

  const handleBuy = async (service: Service) => {
    // For quick purchases, redirect to the full order flow
    toast.info('Please use the full order form to provide vehicle details.');
    window.location.href = '/order';
  };

  const renderServiceCard = (service: Service) => (
    <div
      key={service.id}
      className="glass-card p-6 flex flex-col justify-between hover:border-primary/50 transition-all duration-300"
    >
      <div>
        <h3 className="text-lg font-semibold mb-2">{service.name}</h3>
        <p className="text-3xl font-bold text-primary">{service.price}€</p>
      </div>
      <button
        onClick={() => handleBuy(service)}
        disabled={loadingId === service.id}
        className="btn-primary mt-4 w-full flex items-center justify-center gap-2"
      >
        {loadingId === service.id ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <ShoppingCart className="w-4 h-4" />
            Buy Now
          </>
        )}
      </button>
    </div>
  );

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
          <nav className="hidden md:flex items-center gap-8">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              Home
            </Link>
            <Link to="/order" className="text-muted-foreground hover:text-foreground transition-colors">
              Full Order
            </Link>
            <Link to="/check-order" className="text-muted-foreground hover:text-foreground transition-colors">
              Check Order
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative py-16">
        <div className="container mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-6">
            <Zap className="w-4 h-4" />
            Quick Purchase
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Service <span className="neon-text">Pricing</span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Select a service below to purchase instantly with Stripe Checkout
          </p>
        </div>
      </section>

      {/* Pricing Grid */}
      <section className="relative py-12">
        <div className="container mx-auto px-4 space-y-12">
          {/* Stage Tuning */}
          <div>
            <h2 className="text-2xl font-bold mb-6 text-primary">Stage Tuning</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {stageServices.map(renderServiceCard)}
            </div>
          </div>

          {/* Removal Services */}
          <div>
            <h2 className="text-2xl font-bold mb-6 text-primary">Removal Services</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {removalServices.map(renderServiceCard)}
            </div>
          </div>

          {/* Modifications */}
          <div>
            <h2 className="text-2xl font-bold mb-6 text-primary">Modifications</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {modificationServices.map(renderServiceCard)}
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};

export default PricingPage;
