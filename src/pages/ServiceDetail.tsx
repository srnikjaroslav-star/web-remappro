import { useParams, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { ArrowRight, Zap, ShieldCheck, Gauge, Cpu, Settings } from 'lucide-react';
import Logo from '@/components/Logo';
import SystemStatus from '@/components/SystemStatus';
interface ServiceContent {
  title: string;
  slug: string;
  description: string;
  seoContent: string;
  benefits: {
    title: string;
    items: string[];
  }[];
  icon: React.ReactNode;
}

const serviceData: Record<string, ServiceContent> = {
  'stage-1': {
    title: 'Stage 1 ECU Tuning',
    slug: 'stage-1',
    description: 'Professional Stage 1 ECU remapping for safe power increase and torque optimization without hardware modifications.',
    seoContent: `Stage 1 ECU tuning represents the foundation of professional engine remapping, designed to unlock your vehicle's potential while maintaining complete reliability. Our Stage 1 tuning process focuses on safe power increase by optimizing the engine control unit's software parameters within stock hardware limits. This approach ensures that your engine operates at peak efficiency without compromising longevity or safety.

The primary objective of Stage 1 tuning is torque curve optimization, which delivers improved drivability and acceleration throughout the entire RPM range. Unlike aggressive tuning methods, our Stage 1 remapping respects the original manufacturer's safety margins while extracting additional performance. We carefully analyze your vehicle's specific ECU calibration, fuel system capabilities, and turbocharger characteristics to create a custom map that maximizes power gains safely.

Our Stage 1 tuning process involves comprehensive diagnostic analysis, custom calibration development, and thorough testing to ensure optimal performance. The result is a significant power increase—typically 15-30% more horsepower and torque—while maintaining factory reliability standards. This makes Stage 1 tuning ideal for daily drivers who want enhanced performance without the complexity and cost of hardware upgrades.`,
    benefits: [
      {
        title: 'Performance',
        items: [
          '15-30% power increase',
          'Enhanced torque throughout RPM range',
          'Improved throttle response',
          'Optimized fuel injection timing'
        ]
      },
      {
        title: 'Reliability',
        items: [
          'Works within stock hardware limits',
          'Maintains factory safety margins',
          'No additional stress on components',
          'Long-term engine protection'
        ]
      },
      {
        title: 'Fuel Economy',
        items: [
          'Optimized combustion efficiency',
          'Reduced fuel consumption in some cases',
          'Better engine load management',
          'Improved overall efficiency'
        ]
      }
    ],
    icon: <Gauge className="w-8 h-8 text-cyan-400" />
  },
  'dpf-removal': {
    title: 'DPF Removal Software Solution',
    slug: 'dpf-removal',
    description: 'Professional software solution for Diesel Particulate Filter removal, designed for off-road and motorsport applications.',
    seoContent: `Diesel Particulate Filter (DPF) removal through software recalibration is a specialized service designed for off-road use only and motorsport applications. Our DPF removal software solution eliminates diagnostic trouble codes related to the particulate filter system while maintaining optimal engine performance. This process involves carefully modifying the ECU software to disable DPF-related functions without triggering error codes or check engine lights.

The DPF system is designed to capture soot particles from diesel exhaust, but it can become problematic in certain applications, particularly in high-performance scenarios or when used in environments where regular regeneration cycles cannot occur. Our software solution addresses these issues by removing DPF-related restrictions and error codes, allowing the engine to operate without filter-related limitations. This approach contributes to improved engine longevity by preventing DPF clogging issues that can lead to expensive repairs.

It's important to note that DPF removal is intended exclusively for off-road use and motorsport applications. The software modification ensures that your vehicle can operate without DPF-related complications while maintaining all other engine management functions. Our diagnostic trouble codes removal process is comprehensive, addressing not only the DPF system but also related sensors and monitoring systems to ensure complete functionality.`,
    benefits: [
      {
        title: 'Performance',
        items: [
          'Eliminated exhaust backpressure',
          'Improved engine breathing',
          'Enhanced power delivery',
          'Reduced turbo lag'
        ]
      },
      {
        title: 'Reliability',
        items: [
          'No DPF clogging issues',
          'Prevents expensive filter replacements',
          'Improved engine longevity',
          'Diagnostic trouble codes removal'
        ]
      },
      {
        title: 'Fuel Economy',
        items: [
          'Reduced regeneration cycles',
          'Better fuel efficiency',
          'Lower maintenance costs',
          'Optimized engine operation'
        ]
      }
    ],
    icon: <ShieldCheck className="w-8 h-8 text-cyan-400" />
  },
  'egr-delete': {
    title: 'EGR Delete Software Solution',
    slug: 'egr-delete',
    description: 'Professional EGR system removal through software recalibration for off-road use and improved engine performance.',
    seoContent: `Exhaust Gas Recirculation (EGR) delete through software solution is a specialized service for off-road use only, designed to eliminate EGR-related complications and improve engine performance. The EGR system recirculates exhaust gases back into the intake manifold to reduce nitrogen oxide emissions, but it can cause carbon buildup, reduced power, and reliability issues in certain applications.

Our EGR delete software solution removes all EGR-related functions from the engine control unit, including valve control, sensor monitoring, and diagnostic trouble codes. This comprehensive approach ensures that your engine operates without EGR restrictions while maintaining optimal performance and reliability. The software modification is particularly beneficial for motorsport applications and off-road vehicles where EGR functionality can interfere with performance goals.

The EGR delete process contributes significantly to engine longevity by preventing carbon buildup in the intake system, which can lead to reduced airflow, increased turbo lag, and potential engine damage. Our diagnostic trouble codes removal ensures that your vehicle operates without EGR-related error messages, providing a clean and reliable engine management system. This software solution is designed exclusively for off-road use and motorsport applications, ensuring compliance with appropriate usage guidelines.`,
    benefits: [
      {
        title: 'Performance',
        items: [
          'Eliminated intake carbon buildup',
          'Improved airflow',
          'Enhanced throttle response',
          'Better turbo efficiency'
        ]
      },
      {
        title: 'Reliability',
        items: [
          'Prevents carbon-related issues',
          'Improved engine longevity',
          'Diagnostic trouble codes removal',
          'Reduced maintenance requirements'
        ]
      },
      {
        title: 'Fuel Economy',
        items: [
          'Optimized combustion process',
          'Better fuel efficiency',
          'Reduced engine load',
          'Improved overall efficiency'
        ]
      }
    ],
    icon: <Settings className="w-8 h-8 text-cyan-400" />
  },
  'adblue-off': {
    title: 'AdBlue Delete Software Solution',
    slug: 'adblue-off',
    description: 'Professional AdBlue (SCR) system removal through software recalibration for off-road and export applications.',
    seoContent: `AdBlue delete software solution is a professional service designed for off-road use only and export applications, providing comprehensive removal of Selective Catalytic Reduction (SCR) system functions. AdBlue, also known as Diesel Exhaust Fluid (DEF), is used in modern diesel engines to reduce nitrogen oxide emissions through the SCR system. However, in certain applications—particularly motorsport and export markets—AdBlue system removal becomes necessary.

Our AdBlue delete software solution eliminates all SCR-related functions from the engine control unit, including AdBlue injection control, NOx sensor monitoring, and diagnostic trouble codes. This comprehensive approach ensures that your vehicle operates without AdBlue system restrictions while maintaining optimal engine performance. The software modification is particularly valuable for export applications where AdBlue availability may be limited or for motorsport use where SCR systems can interfere with performance objectives.

The AdBlue delete process contributes to improved engine longevity by removing SCR system dependencies and potential failure points. Our diagnostic trouble codes removal ensures complete system functionality without AdBlue-related error messages. This software solution is designed exclusively for off-road use and export applications, ensuring compliance with appropriate usage guidelines while providing reliable and efficient engine operation.`,
    benefits: [
      {
        title: 'Performance',
        items: [
          'Eliminated SCR system restrictions',
          'Improved exhaust flow',
          'Enhanced power delivery',
          'Reduced system complexity'
        ]
      },
      {
        title: 'Reliability',
        items: [
          'No AdBlue system failures',
          'Improved engine longevity',
          'Diagnostic trouble codes removal',
          'Reduced maintenance costs'
        ]
      },
      {
        title: 'Fuel Economy',
        items: [
          'Optimized engine operation',
          'Better fuel efficiency',
          'No AdBlue consumption',
          'Lower operating costs'
        ]
      }
    ],
    icon: <Cpu className="w-8 h-8 text-cyan-400" />
  },
  'tcu-tuning': {
    title: 'TCU Transmission Tuning',
    slug: 'tcu-tuning',
    description: 'Professional Transmission Control Unit tuning for optimized shift points, clamping pressure, and DSG/ZF optimization.',
    seoContent: `Transmission Control Unit (TCU) tuning is a specialized service that optimizes your vehicle's transmission performance through software recalibration. Our TCU tuning focuses on shift points optimization, clamping pressure adjustment, and DSG/ZF transmission optimization to deliver smoother, faster, and more responsive gear changes. This service is particularly valuable for vehicles with dual-clutch transmissions (DSG) and ZF automatic transmissions, where software optimization can dramatically improve driving experience.

Shift points optimization is the core of TCU tuning, allowing us to adjust when and how the transmission shifts gears based on throttle position, engine load, and driving conditions. By optimizing these parameters, we can deliver faster shift times, improved acceleration, and better overall transmission response. The clamping pressure adjustment ensures that clutches engage with optimal force, providing smooth gear changes while maintaining transmission durability.

DSG optimization involves fine-tuning the dual-clutch system's behavior, including clutch engagement timing, shift speed, and torque management. ZF optimization focuses on similar parameters for ZF automatic transmissions, ensuring optimal performance across all driving scenarios. Our TCU tuning process includes comprehensive analysis of your transmission's current calibration, custom map development, and thorough testing to ensure optimal results. The result is a transmission that responds more quickly, shifts more smoothly, and provides an overall enhanced driving experience.`,
    benefits: [
      {
        title: 'Performance',
        items: [
          'Faster shift times',
          'Optimized shift points',
          'Improved acceleration',
          'Enhanced throttle response'
        ]
      },
      {
        title: 'Reliability',
        items: [
          'Optimal clamping pressure',
          'Reduced transmission wear',
          'Improved longevity',
          'Better heat management'
        ]
      },
      {
        title: 'Fuel Economy',
        items: [
          'Optimized gear selection',
          'Better efficiency',
          'Reduced transmission losses',
          'Improved overall economy'
        ]
      }
    ],
    icon: <Settings className="w-8 h-8 text-cyan-400" />
  },
  'pop-bang': {
    title: 'Pop & Bang Exhaust Effects',
    slug: 'pop-bang',
    description: 'Professional ECU modification for Pop & Bang exhaust effects, creating distinctive exhaust sounds for motorsport applications.',
    seoContent: `Pop & Bang exhaust effects are a popular ECU modification that creates distinctive exhaust sounds through controlled fuel injection timing and ignition adjustments. This modification is designed for motorsport applications and off-road use, where distinctive exhaust characteristics are desired. Our Pop & Bang software solution carefully adjusts the engine's fuel injection and ignition timing to create controlled exhaust pops and bangs during deceleration and gear changes.

The Pop & Bang modification works by injecting additional fuel into the exhaust system during specific engine conditions, which then ignites to create the characteristic popping and banging sounds. This process requires precise calibration to ensure that the effects are achieved without compromising engine reliability or causing damage to exhaust components. Our software solution includes comprehensive safety measures to protect your engine and exhaust system while delivering the desired acoustic effects.

Our Pop & Bang modification is designed exclusively for motorsport and off-road applications, ensuring compliance with appropriate usage guidelines. The software modification is fully reversible and can be customized to achieve different levels of intensity, from subtle pops to more pronounced bangs. This ECU modification adds a distinctive character to your vehicle's exhaust note while maintaining optimal engine performance and reliability.`,
    benefits: [
      {
        title: 'Performance',
        items: [
          'Distinctive exhaust character',
          'Customizable intensity levels',
          'Maintains engine performance',
          'Reversible modification'
        ]
      },
      {
        title: 'Reliability',
        items: [
          'Safe calibration parameters',
          'Engine protection measures',
          'Exhaust system safeguards',
          'Long-term durability'
        ]
      },
      {
        title: 'Customization',
        items: [
          'Adjustable intensity',
          'Custom timing parameters',
          'Multiple effect profiles',
          'Personalized configuration'
        ]
      }
    ],
    icon: <Zap className="w-8 h-8 text-cyan-400" />
  }
};

const ServiceDetail = () => {
  const { serviceSlug } = useParams<{ serviceSlug: string }>();
  const service = serviceSlug ? serviceData[serviceSlug] : null;

  useEffect(() => {
    if (service) {
      document.title = `${service.title} | REMAPPRO - Professional ECU Tuning`;
      
      // Update meta description
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        metaDescription.setAttribute('content', service.description);
      } else {
        const meta = document.createElement('meta');
        meta.name = 'description';
        meta.content = service.description;
        document.head.appendChild(meta);
      }
    }
  }, [service]);

  if (!service) {
    return (
      <div className="flex w-full flex-grow items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Service Not Found</h1>
          <Link to="/" className="btn-primary inline-flex items-center gap-2">
            Return Home
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex w-full flex-grow flex-col bg-background">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative border-b border-border/50">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-background/80 backdrop-blur-sm" />
        <div className="container relative mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/">
              <Logo size="md" />
            </Link>
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
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-8">
            {service.icon}
            <span>Professional ECU Tuning Service</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
            {service.title}
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10">
            {service.description}
          </p>
          
          <Link to="/order" className="btn-primary inline-flex items-center gap-2 text-lg">
            Get a Quote
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* SEO Content Block */}
      <section className="relative py-20 border-t border-gray-900" style={{ backgroundColor: '#080808' }}>
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="border border-gray-900 rounded-xl p-8 md:p-12" style={{ backgroundColor: '#0a0a0a' }}>
              <div className="prose prose-invert max-w-none">
                <div className="text-muted-foreground leading-relaxed text-base space-y-4">
                  {service.seoContent.split('\n\n').map((paragraph, idx) => (
                    <p key={idx}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Key Benefits */}
      <section className="relative py-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {service.benefits.map((benefit, idx) => (
              <div 
                key={idx}
                className="border border-gray-900 rounded-xl p-8 hover:border-cyan-400/30 transition-all duration-300"
                style={{ backgroundColor: '#0a0a0a' }}
              >
                <div className="w-14 h-14 rounded-xl bg-cyan-400/10 flex items-center justify-center mb-6">
                  {service.icon}
                </div>
                <h3 className="text-xl font-semibold mb-4 text-foreground">{benefit.title}</h3>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  {benefit.items.map((item, itemIdx) => (
                    <li key={itemIdx} className="flex items-start gap-2">
                      <span className="text-cyan-400 mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20 border-t border-gray-900" style={{ backgroundColor: '#080808' }}>
        <div className="container mx-auto px-4">
          <div className="glass-card p-12 text-center relative overflow-hidden max-w-4xl mx-auto">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5" />
            <div className="relative">
              <Zap className="w-16 h-16 text-cyan-400 mx-auto mb-6" />
              <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
              <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
                Contact us today to get a personalized quote for {service.title} and experience professional ECU tuning.
              </p>
              <Link to="/order" className="btn-primary inline-flex items-center gap-2 text-lg">
                Get a Quote
                <ArrowRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};

export default ServiceDetail;
