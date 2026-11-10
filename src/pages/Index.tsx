import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowRight, Zap, Shield, Clock, Car, ChevronRight, Gauge, Settings, Cpu, ShieldCheck, Wrench, X } from 'lucide-react';
import Logo from '@/components/Logo';
import SystemStatus from '@/components/SystemStatus';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';

interface ServiceData {
  name: string;
  slug: string;
  title: string;
  description: string;
  seoContent: string;
  icon: React.ReactNode;
}

const serviceData: Record<string, ServiceData> = {
  'stage-1': {
    name: 'Stage 1 Tuning',
    slug: 'stage-1',
    title: 'Stage 1 Performance ECU Tuning',
    description: 'Professional ECU recalibration for safe power increase and torque optimization.',
    seoContent: `Stage 1 Performance tuning represents the foundation of professional engine remapping, focusing on ECU recalibration within stock hardware limits. Our Stage 1 tuning process involves comprehensive fuel map adjustment and torque optimization to deliver significant performance gains while maintaining dyno-tested reliability.

The primary objective of Stage 1 tuning is ECU recalibration that optimizes the engine control unit's software parameters. This approach ensures that your engine operates at peak efficiency through precise fuel map adjustment, which directly impacts power delivery and throttle response. Our torque optimization process enhances drivability throughout the entire RPM range, delivering improved acceleration and overall driving experience.

Our Stage 1 tuning methodology includes comprehensive diagnostic analysis, custom calibration development, and thorough dyno testing to ensure dyno-tested reliability. The result is a significant power increase—typically 15-30% more horsepower and torque—through ECU recalibration that respects original manufacturer safety margins. This makes Stage 1 tuning ideal for daily drivers who want enhanced performance without hardware modifications.`,
    icon: <Gauge className="w-6 h-6" />
  },
  'adblue-off': {
    name: 'AdBlue Off',
    slug: 'adblue-off',
    title: 'AdBlue / SCR Solutions',
    description: 'Professional software-based bypass for AdBlue system failures and SCR countdown issues.',
    seoContent: `AdBlue / SCR Solutions provide comprehensive software-based bypass for Selective Catalytic Reduction (SCR) system failures. Our AdBlue countdown reset service eliminates the countdown timer that appears when AdBlue systems malfunction, preventing vehicle immobilization. This software-based bypass ensures continued vehicle operation while addressing underlying SCR failure issues.

The SCR failure fix process involves carefully modifying the engine control unit software to disable AdBlue injection control and NOx sensor monitoring. Our AdBlue countdown reset eliminates warning messages and countdown timers, allowing your vehicle to operate normally. The software-based bypass is particularly valuable for limp mode recovery, restoring full engine performance when SCR system failures cause reduced power or vehicle immobilization.

Our AdBlue / SCR solutions include comprehensive diagnostic trouble code removal and SCR failure fix procedures. The software-based bypass ensures that your vehicle operates without AdBlue system restrictions while maintaining optimal engine performance. This approach is designed for off-road use and export applications where AdBlue availability may be limited or where SCR systems interfere with performance objectives.`,
    icon: <Cpu className="w-6 h-6" />
  },
  'dpf-removal': {
    name: 'DPF Removal',
    slug: 'dpf-removal',
    title: 'DPF / FAP Optimization',
    description: 'Professional software solution for particulate filter regeneration and exhaust backpressure reduction.',
    seoContent: `DPF / FAP Optimization provides comprehensive software solutions for Diesel Particulate Filter (DPF) and Filtre à Particules (FAP) systems. Our particulate filter regeneration software eliminates the need for forced regeneration cycles while addressing exhaust backpressure reduction. This optimization process significantly improves fuel economy improvement by preventing DPF clogging issues that reduce engine efficiency.

The particulate filter regeneration process involves software modifications that disable DPF-related functions without triggering diagnostic trouble codes. Our exhaust backpressure reduction approach allows the engine to breathe more freely, resulting in improved power delivery and throttle response. The fuel economy improvement achieved through DPF optimization is significant, as vehicles no longer consume additional fuel during regeneration cycles.

Our DPF / FAP optimization includes comprehensive diagnostic trouble code removal and exhaust system optimization. The particulate filter regeneration software ensures that your vehicle operates without DPF-related restrictions while maintaining optimal engine performance. This approach contributes to improved engine longevity by preventing DPF clogging issues that can lead to expensive filter replacements and reduced engine efficiency.`,
    icon: <ShieldCheck className="w-6 h-6" />
  },
  'egr-delete': {
    name: 'EGR Delete',
    slug: 'egr-delete',
    title: 'EGR Solutions',
    description: 'Professional EGR valve software management for carbon buildup prevention and intake manifold longevity.',
    seoContent: `EGR Solutions provide comprehensive EGR valve software management designed to prevent carbon buildup in the intake system. Our carbon buildup prevention approach eliminates the recirculation of exhaust gases that cause soot accumulation in the intake manifold and EGR valve. This software management ensures intake manifold longevity by preventing carbon deposits that reduce airflow and engine efficiency.

The EGR valve software management process involves disabling EGR system functions through precise ECU modifications. Our carbon buildup prevention strategy eliminates the root cause of intake manifold clogging, which can lead to reduced power, increased turbo lag, and potential engine damage. The intake manifold longevity achieved through EGR solutions is significant, as vehicles no longer experience carbon-related airflow restrictions.

Our EGR solutions include comprehensive diagnostic trouble code removal and EGR valve software management. The carbon buildup prevention ensures that your intake system remains clean, contributing to improved engine longevity and performance. This approach is designed for off-road use and motorsport applications where EGR functionality can interfere with performance objectives and where intake manifold longevity is critical.`,
    icon: <Settings className="w-6 h-6" />
  },
  'tcu-tuning': {
    name: 'TCU Tuning',
    slug: 'tcu-tuning',
    title: 'TCU Transmission Tuning',
    description: 'Professional Transmission Control Unit optimization for shift points and clamping pressure.',
    seoContent: `TCU Transmission Tuning provides comprehensive optimization for Transmission Control Unit (TCU) performance. Our shift points optimization adjusts when and how the transmission shifts gears based on throttle position, engine load, and driving conditions. This optimization delivers faster shift times, improved acceleration, and better overall transmission response through precise clamping pressure adjustment.

The shift points optimization process involves analyzing your transmission's current calibration and developing custom maps that optimize gear selection. Our clamping pressure adjustment ensures that clutches engage with optimal force, providing smooth gear changes while maintaining transmission durability. This approach is particularly valuable for DSG and ZF transmissions, where software optimization can dramatically improve driving experience.

Our TCU tuning includes comprehensive analysis of transmission behavior, custom map development, and thorough testing. The shift points optimization and clamping pressure adjustment ensure optimal performance across all driving scenarios, resulting in a transmission that responds more quickly, shifts more smoothly, and provides an overall enhanced driving experience.`,
    icon: <Settings className="w-6 h-6" />
  },
  'pop-bang': {
    name: 'Pop & Bang',
    slug: 'pop-bang',
    title: 'Pop & Bang Exhaust Effects',
    description: 'Professional ECU modification for distinctive exhaust sounds in motorsport applications.',
    seoContent: `Pop & Bang Exhaust Effects are ECU modifications that create distinctive exhaust sounds through controlled fuel injection timing and ignition adjustments. This modification is designed for motorsport applications and off-road use, where distinctive exhaust characteristics are desired. Our Pop & Bang software solution carefully adjusts the engine's fuel injection and ignition timing to create controlled exhaust pops and bangs during deceleration and gear changes.

The Pop & Bang modification works by injecting additional fuel into the exhaust system during specific engine conditions, which then ignites to create the characteristic popping and banging sounds. This process requires precise calibration to ensure that the effects are achieved without compromising engine reliability or causing damage to exhaust components. Our software solution includes comprehensive safety measures to protect your engine and exhaust system while delivering the desired acoustic effects.

Our Pop & Bang modification is designed exclusively for motorsport and off-road applications, ensuring compliance with appropriate usage guidelines. The software modification is fully reversible and can be customized to achieve different levels of intensity, from subtle pops to more pronounced bangs. This ECU modification adds a distinctive character to your vehicle's exhaust note while maintaining optimal engine performance and reliability.`,
    icon: <Zap className="w-6 h-6" />
  }
};

const Index = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedService, setSelectedService] = useState<string | null>(null);

  // Sync drawer state with URL on mount and URL changes
  useEffect(() => {
    const hash = location.hash;
    if (hash.startsWith('#/service/')) {
      const serviceSlug = hash.replace('#/service/', '').split('/')[0];
      if (serviceData[serviceSlug]) {
        setSelectedService(serviceSlug);
      } else {
        setSelectedService(null);
      }
    } else if (hash === '#/' || hash === '' || !hash.includes('/service/')) {
      setSelectedService(null);
    }
  }, [location.hash]);

  const handleServiceClick = (slug: string) => {
    // Set state first to open drawer immediately
    setSelectedService(slug);
    // Update URL for SEO (non-blocking)
    setTimeout(() => {
      navigate(`/service/${slug}`, { replace: false });
    }, 0);
  };

  const handleCloseDrawer = (open: boolean) => {
    if (!open) {
      setSelectedService(null);
      // Update URL when closing
      if (location.hash.includes('/service/')) {
        navigate('/', { replace: false });
      }
    }
  };

  const currentService = selectedService ? serviceData[selectedService] : null;

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
          <div className="flex items-center gap-6">
            <Logo size="md" />
            <SystemStatus />
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <Link to="/about" className="text-muted-foreground hover:text-foreground transition-colors">
              O nás & Služby
            </Link>
            <Link to="/track" className="text-muted-foreground hover:text-foreground transition-colors">
              Track Order
            </Link>
            <Link to="/order" className="btn-primary">
              Order Now
            </Link>
          </nav>
          <Link to="/order" className="md:hidden btn-primary py-2 text-sm">
            Order
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-24 md:py-32">
        <div className="container mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-8 animate-fadeIn">
            <Zap className="w-4 h-4" />
            Professional ECU Tuning Services
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight animate-fadeIn" style={{ animationDelay: '0.1s' }}>
            Unlock Your Vehicle's
            <br />
            <span className="neon-text">True Performance</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            Expert ECU remapping and tuning solutions. Increase power, improve fuel efficiency, 
            and optimize your driving experience with our professional services.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fadeIn" style={{ animationDelay: '0.3s' }}>
            <Link to="/order" className="btn-primary flex items-center gap-2 text-lg">
              Start Your Order
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link to="/track" className="btn-secondary flex items-center gap-2">
              Track Your Order
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative py-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass-card-hover p-8">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Gauge className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Performance Gains</h3>
              <p className="text-muted-foreground">
                Unlock up to 30% more power and torque from your engine with our Stage 1 tuning solutions.
              </p>
            </div>
            
            <div className="glass-card-hover p-8">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Shield className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Safe & Reliable</h3>
              <p className="text-muted-foreground">
                All tunes are tested and validated to ensure engine safety while maximizing performance.
              </p>
            </div>
            
            <div className="glass-card-hover p-8">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Clock className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Fast Turnaround</h3>
              <p className="text-muted-foreground">
                Most tuning files are delivered within 2-4 hours. Track your order status in real-time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Services Preview */}
      <section className="relative py-20 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Our Services</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Comprehensive tuning solutions for all vehicle types and requirements
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 max-w-4xl mx-auto">
            {[
              { name: 'Stage 1 Tuning', slug: 'stage-1' },
              { name: 'DPF Removal', slug: 'dpf-removal' },
              { name: 'EGR Delete', slug: 'egr-delete' },
              { name: 'AdBlue Off', slug: 'adblue-off' },
              { name: 'TCU Tuning', slug: 'tcu-tuning' },
              { name: 'Pop & Bang', slug: 'pop-bang' }
            ].map((service, idx) => (
              <button
                key={service.slug}
                onClick={() => handleServiceClick(service.slug)}
                className="glass-card p-4 text-center hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(34,211,238,0.3)] transition-all duration-300 cursor-pointer"
                style={{ animationDelay: `${idx * 0.05}s` }}
                aria-label={`Open ${service.name} details`}
              >
                <Settings className="w-6 h-6 text-primary mx-auto mb-2" />
                <p className="text-sm font-medium">{service.name}</p>
              </button>
            ))}
          </div>
          
          <div className="text-center mt-12">
            <Link to="/order" className="btn-primary inline-flex items-center gap-2">
              View All Services
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20 border-t border-border/50">
        <div className="container mx-auto px-4">
          <div className="glass-card p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5" />
            <div className="relative">
              <Car className="w-16 h-16 text-primary mx-auto mb-6" />
              <h2 className="text-3xl font-bold mb-4">Ready to Transform Your Ride?</h2>
              <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
                Start your order now and experience the difference professional ECU tuning can make.
              </p>
              <Link to="/order" className="btn-primary inline-flex items-center gap-2 text-lg">
                Get Started
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* English SEO Section */}
      <section className="relative py-20 border-t border-gray-900" style={{ backgroundColor: '#080808' }}>
        <div className="container mx-auto px-4">
          {/* Heading */}
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              High-Performance{' '}
              <span className="text-cyan-400">ECU Software Engineering</span>
              {' '}& Chip Tuning
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Professional engine control unit remapping and software optimization for maximum performance
            </p>
          </div>

          {/* Services Grid - 3 Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16 max-w-6xl mx-auto">
            {/* Card 1: Performance Tuning */}
            <div className="border border-gray-900 rounded-xl p-8 hover:border-cyan-400/30 transition-all duration-300" style={{ backgroundColor: '#0a0a0a' }}>
              <div className="w-14 h-14 rounded-xl bg-cyan-400/10 flex items-center justify-center mb-6">
                <Gauge className="w-7 h-7 text-cyan-400" />
              </div>
              <h3 className="text-xl font-semibold mb-4 text-foreground">Performance Tuning</h3>
              <p className="text-muted-foreground mb-4">
                Stage 1, Stage 2, and custom dyno-optimized remapping for maximum torque and horsepower.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Stage 1 & Stage 2 tuning solutions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Dyno-optimized custom remapping</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Maximum torque and horsepower gains</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Individual calibration for each vehicle</span>
                </li>
              </ul>
            </div>

            {/* Card 2: Emissions Solutions */}
            <div className="border border-gray-900 rounded-xl p-8 hover:border-cyan-400/30 transition-all duration-300" style={{ backgroundColor: '#0a0a0a' }}>
              <div className="w-14 h-14 rounded-xl bg-cyan-400/10 flex items-center justify-center mb-6">
                <ShieldCheck className="w-7 h-7 text-cyan-400" />
              </div>
              <h3 className="text-xl font-semibold mb-4 text-foreground">Emissions Solutions</h3>
              <p className="text-muted-foreground mb-4">
                Professional software recalibration for AdBlue (SCR), DPF, and EGR systems.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>AdBlue (SCR) system recalibration</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Diesel Particulate Filter software solutions</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>EGR system optimization</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span className="text-xs italic">*Motorsport use only</span>
                </li>
              </ul>
            </div>

            {/* Card 3: Advanced ECU Logic */}
            <div className="border border-gray-900 rounded-xl p-8 hover:border-cyan-400/30 transition-all duration-300" style={{ backgroundColor: '#0a0a0a' }}>
              <div className="w-14 h-14 rounded-xl bg-cyan-400/10 flex items-center justify-center mb-6">
                <Cpu className="w-7 h-7 text-cyan-400" />
              </div>
              <h3 className="text-xl font-semibold mb-4 text-foreground">Advanced ECU Logic</h3>
              <p className="text-muted-foreground mb-4">
                Specialized ECU functions for motorsport and performance applications.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Pop & Bangs (exhaust effects)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>V-Max unlock</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Launch Control</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Start-Stop optimization</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Deep SEO Text Block */}
          <div className="max-w-4xl mx-auto mb-12">
            <div className="border border-gray-900 rounded-xl p-8" style={{ backgroundColor: '#0a0a0a' }}>
              <div className="prose prose-invert max-w-none">
                <p className="text-muted-foreground leading-relaxed text-base">
                  REMAPPRO specializes in professional <strong className="text-foreground">Engine Control Unit remapping</strong> and 
                  <strong className="text-foreground"> automotive software engineering Slovakia</strong>. Our expertise includes comprehensive 
                  <strong className="text-foreground"> Diesel Particulate Filter software solutions</strong> and advanced 
                  <strong className="text-foreground"> performance optimization</strong> for all vehicle types. We provide 
                  <strong className="text-foreground"> AdBlue delete for export</strong> and motorsport applications, ensuring maximum 
                  reliability and power gains through precise software calibration.
                </p>
                <p className="text-muted-foreground leading-relaxed text-base mt-4">
                  Our <strong className="text-foreground">Engine Control Unit remapping</strong> services utilize state-of-the-art diagnostic 
                  tools and custom calibration techniques. Each vehicle receives individual attention, with detailed analysis of the original 
                  software parameters and identification of optimization opportunities. Our <strong className="text-foreground">Diesel Particulate Filter 
                  software solutions</strong> and <strong className="text-foreground">automotive software engineering Slovakia</strong> approach ensures 
                  safe, tested modifications that respect engine limits while delivering significant <strong className="text-foreground">performance optimization</strong>. 
                  For export markets, we offer <strong className="text-foreground">AdBlue delete for export</strong> solutions compliant with 
                  international motorsport regulations.
                </p>
              </div>
            </div>
          </div>

          {/* Legal Disclaimer */}
          <div className="max-w-4xl mx-auto text-center mt-12">
            <p className="text-xs text-muted-foreground leading-relaxed" style={{ opacity: 0.3 }}>
              <strong>Legal Notice:</strong> Emissions system modifications (AdBlue, DPF, EGR) are provided exclusively for motorsport purposes 
              and use on closed circuits. These modifications are not suitable for regular use on public roads and may be in violation of 
              applicable legislation in some countries. The customer is responsible for compliance with all applicable laws and regulations 
              regarding the use of modified vehicles outside of public roads.
            </p>
          </div>
        </div>
      </section>

      {/* Service Detail Drawer */}
      <Sheet open={selectedService !== null} onOpenChange={handleCloseDrawer}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {currentService && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-cyan-400/10 flex items-center justify-center text-cyan-400">
                    {currentService.icon}
                  </div>
                  <SheetTitle className="text-2xl md:text-3xl font-bold text-left">
                    {currentService.title}
                  </SheetTitle>
                </div>
                <SheetDescription className="text-base text-muted-foreground text-left">
                  {currentService.description}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-8 space-y-6">
                {/* Service Image Placeholder */}
                <div className="w-full h-48 bg-gradient-to-br from-cyan-400/20 to-primary/10 rounded-xl flex items-center justify-center mb-6">
                  <div className="text-center">
                    <Settings className="w-16 h-16 text-cyan-400 mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-muted-foreground">Professional ECU Tuning Service</p>
                  </div>
                </div>

                <div className="prose prose-invert max-w-none">
                  <h2 className="text-xl font-semibold text-foreground mb-4">Technical Overview</h2>
                  <div className="space-y-4 text-muted-foreground leading-relaxed">
                    {currentService.seoContent.split('\n\n').map((paragraph, idx) => (
                      <p key={idx} className="text-base">{paragraph}</p>
                    ))}
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-800">
                  <Link
                    to="/order"
                    onClick={() => setSelectedService(null)}
                    className="btn-primary inline-flex items-center gap-2 w-full sm:w-auto justify-center"
                  >
                    Get a Quote
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
};

export default Index;
