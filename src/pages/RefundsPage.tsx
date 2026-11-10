import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import Logo from '@/components/Logo';
const RefundsPage = () => {
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
        <h1 className="text-3xl font-bold mb-2">Refund Policy</h1>
        <p className="text-muted-foreground mb-8">Last updated: January 2026</p>
        
        <div className="prose prose-invert max-w-none space-y-8 text-muted-foreground">
          {/* Important Notice */}
          <section className="glass-card p-6 border-2 border-amber-500/50 bg-amber-500/5">
            <div className="flex items-start gap-4">
              <AlertTriangle className="w-8 h-8 text-amber-500 flex-shrink-0 mt-1" />
              <div>
                <h2 className="text-xl font-semibold text-amber-400 mb-3">Important Notice</h2>
                <p className="text-foreground">
                  Due to the nature of digital goods, <strong>all sales are final</strong>. Please 
                  read this policy carefully before placing your order.
                </p>
              </div>
            </div>
          </section>

          <section className="glass-card p-6 border border-primary/20">
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Digital Goods & EU Consumer Rights</h2>
            <p>
              Under EU law (Directive 2011/83/EU on consumer rights), the right of withdrawal is 
              lost at the moment the performance has begun with the consumer's prior express consent 
              and acknowledgment that they thereby lose their right of withdrawal.
            </p>
            <p className="mt-4">
              By clicking <strong>"Proceed to Payment"</strong> and completing your order, you 
              expressly consent to the immediate performance of the service and acknowledge that 
              you lose your right to a 14-day withdrawal period once the tuning file has been 
              processed and made available for download.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Why Refunds Are Not Possible</h2>
            <p>
              Each tuning file is custom-created for your specific vehicle based on the ECU file 
              you provide. Once our engineers have processed your file and created your custom 
              tune, the service has been fully rendered. Unlike physical goods, digital tuning 
              files cannot be "returned" as they have already been created and delivered.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">3. When We May Provide Remedies</h2>
            <p>
              While refunds are not available, we are committed to customer satisfaction. We may 
              provide remedies in the following situations:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-2">
              <li><strong>Technical Issues</strong> — If our file does not function correctly due to our error, we will provide a corrected file at no additional cost</li>
              <li><strong>Unprocessable Files</strong> — If we are unable to process your ECU file for technical reasons, we will issue a full refund</li>
              <li><strong>Service Cancellation</strong> — If you cancel before we begin processing your file, a refund may be issued minus any processing fees</li>
            </ul>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">4. File Revisions</h2>
            <p>
              If you are not satisfied with the results of your tune, we offer file revisions. 
              Please contact us with specific feedback about what adjustments you would like, 
              and our engineers will work with you to optimize the file to your preferences.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">5. Dispute Resolution</h2>
            <p>
              If you believe you are entitled to a refund or have a dispute regarding our services, 
              please contact us at{' '}
              <a href="mailto:info@remappro.eu" className="text-primary hover:underline">
                info@remappro.eu
              </a>
              {' '}with your order number and a detailed description of the issue. We will review 
              your case and respond within 48 business hours.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Chargebacks</h2>
            <p>
              Filing a chargeback with your payment provider without first contacting us constitutes 
              a breach of these terms. We maintain detailed records of all orders, consent 
              acknowledgments, and file deliveries. Fraudulent chargebacks will be contested 
              with full documentation.
            </p>
          </section>

          <section className="glass-card p-6">
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Contact</h2>
            <p>
              For refund inquiries or service issues, please contact:
            </p>
            <div className="mt-4 p-4 bg-secondary/30 rounded-lg">
              <p className="text-sm text-foreground">
                <strong>REMAPPRO Digital Solutions</strong><br />
                Email:{' '}
                <a href="mailto:info@remappro.eu" className="text-primary hover:underline">
                  info@remappro.eu
                </a><br />
                Slovakia, European Union
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default RefundsPage;
