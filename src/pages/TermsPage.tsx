import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Logo from '@/components/Logo';
const TermsPage = () => {
  return (
    <div className="flex w-full flex-grow flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <ArrowLeft className="w-5 h-5 text-muted-foreground" />
            <Logo size="sm" />
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="container mx-auto max-w-3xl flex-grow px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Terms & Conditions</h1>
        <p className="text-muted-foreground mb-8">Last updated: January 2026</p>
        
        <div className="prose prose-invert max-w-none space-y-8 text-muted-foreground">
          <section className="glass-card p-6 border border-primary/20">
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Service Description</h2>
            <p>
              REMAPPRO provides software optimization services for motorsport and off-road use only. 
              By using our services, the client acknowledges that modifications may void vehicle 
              warranties and may not be compliant with local road emission laws.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Disclaimer of Liability</h2>
            <p>
              REMAPPRO is not liable for any mechanical failures, engine damage, or legal consequences 
              arising from the use of our software. All files are provided "as-is" without any warranties, 
              express or implied, including but not limited to warranties of merchantability, fitness 
              for a particular purpose, or non-infringement.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Intended Use</h2>
            <p>
              Our tuning files are designed exclusively for vehicles used in controlled environments 
              such as race tracks, private property, or off-road conditions. The client assumes full 
              responsibility for ensuring compliance with all applicable laws and regulations in their 
              jurisdiction before using our services on any vehicle.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Warranty Implications</h2>
            <p>
              The client acknowledges and accepts that ECU modifications may void the manufacturer's 
              warranty on the vehicle and its components. REMAPPRO shall not be held responsible for 
              any warranty claims denied by vehicle manufacturers or dealers as a result of using our 
              services.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">5. File Delivery</h2>
            <p>
              Upon successful payment, tuning files will be processed and made available for download 
              through our secure portal. Delivery times vary based on complexity but typically range 
              from 2-4 hours during business hours. The client is responsible for correctly flashing 
              the provided file to their ECU.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Intellectual Property</h2>
            <p>
              All tuning files, software, and related materials provided by REMAPPRO are protected 
              by intellectual property laws. Files are licensed for use on the specified vehicle only 
              and may not be copied, redistributed, resold, or shared with third parties.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Governing Law</h2>
            <p>
              These terms shall be governed by and construed in accordance with the laws of the 
              Slovak Republic and the European Union. Any disputes arising from these terms shall 
              be subject to the exclusive jurisdiction of the courts of Slovakia.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">8. Contact</h2>
            <p>
              For questions regarding these terms, please contact us at{' '}
              <a href="mailto:info@remappro.eu" className="text-primary hover:underline">
                info@remappro.eu
              </a>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default TermsPage;
