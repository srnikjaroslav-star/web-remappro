import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import Logo from '@/components/Logo';
const PrivacyPage = () => {
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
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last updated: January 2026</p>
        
        <div className="prose prose-invert max-w-none space-y-8 text-muted-foreground">
          <section className="glass-card p-6 border border-primary/20">
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Data We Collect</h2>
            <p>
              We process personal data (Name, Email, Vehicle Information, ECU Files, Order Details) 
              solely for order fulfillment and technical support. We collect only the minimum data 
              necessary to provide our services effectively.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Third-Party Processors</h2>
            <p>
              Data is shared with third-party processors in compliance with GDPR:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li><strong>Stripe</strong> — Payment processing (PCI-DSS compliant)</li>
              <li><strong>Resend</strong> — Email delivery and notifications</li>
              <li><strong>Supabase</strong> — Secure data storage and file hosting</li>
            </ul>
            <p className="mt-3">
              We do not sell, rent, or trade your personal data to any third parties for marketing purposes.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Data Retention</h2>
            <p>
              Personal data and order records are retained for the duration necessary to fulfill 
              our contractual obligations and comply with legal requirements. ECU files may be 
              retained for a limited period to provide technical support and revisions.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Your Rights Under GDPR</h2>
            <p>
              As a data subject under the General Data Protection Regulation (GDPR), you have the right to:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li>Access — Request a copy of your personal data</li>
              <li>Rectification — Request correction of inaccurate data</li>
              <li>Erasure — Request deletion of your data ("right to be forgotten")</li>
              <li>Portability — Request your data in a machine-readable format</li>
              <li>Object — Object to processing based on legitimate interests</li>
            </ul>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">5. Security Measures</h2>
            <p>
              We implement appropriate technical and organizational measures to protect your 
              personal data against unauthorized access, alteration, disclosure, or destruction. 
              All data transmissions are encrypted using TLS/SSL protocols.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Cookies</h2>
            <p>
              We use essential cookies required for the operation of our website. We do not use 
              tracking or advertising cookies. Session data is used solely to maintain your 
              order state during the checkout process.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Contact & Data Controller</h2>
            <p>
              For any privacy-related inquiries or to exercise your rights, please contact our 
              Data Protection contact at{' '}
              <a href="mailto:info@remappro.eu" className="text-primary hover:underline">
                info@remappro.eu
              </a>
            </p>
            <div className="mt-4 p-4 bg-secondary/30 rounded-lg">
              <p className="text-sm text-foreground">
                <strong>REMAPPRO Digital Solutions</strong><br />
                Slovakia, European Union
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPage;
