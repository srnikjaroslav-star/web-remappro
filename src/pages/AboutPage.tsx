import { Link } from 'react-router-dom';
import { Zap, ShieldCheck, Cpu, ArrowRight, Gauge, Settings, Wrench } from 'lucide-react';
import Logo from '@/components/Logo';
import SystemStatus from '@/components/SystemStatus';
const AboutPage = () => {
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
            <Link to="/about" className="text-primary hover:text-primary/80 transition-colors font-medium">
              O nás & Služby
            </Link>
            <Link to="/track" className="text-muted-foreground hover:text-foreground transition-colors">
              Track Order
            </Link>
            <Link to="/order" className="btn-primary">
              Order Now
            </Link>
          </nav>
          <div className="md:hidden flex items-center gap-4">
            <Link to="/about" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
              O nás
            </Link>
            <Link to="/order" className="btn-primary py-2 text-sm">
              Order
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-24 md:py-32">
        <div className="container mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-8 animate-fadeIn">
            <Zap className="w-4 h-4" />
            REMAPPRO Software Engineering
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight animate-fadeIn" style={{ animationDelay: '0.1s' }}>
            Profesionálny Chip Tuning
            <br />
            <span className="neon-text">a Úpravy ECU</span>
          </h1>
          
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10 animate-fadeIn" style={{ animationDelay: '0.2s' }}>
            REMAPPRO poskytuje špičkové softvérové riešenia pre úpravy elektronických riadiacich jednotiek (ECU). 
            Naša expertíza zahŕňa zvýšenie výkonu, optimalizáciu spotreby a špecializované funkcie pre motoršportové aplikácie.
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fadeIn" style={{ animationDelay: '0.3s' }}>
            <Link to="/order" className="btn-primary flex items-center gap-2 text-lg">
              Začať objednávku
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link to="/pricing" className="btn-secondary flex items-center gap-2">
              Cenník služieb
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Services Grid - 3 Cards */}
      <section className="relative py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Naše Služby</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Komplexné riešenia pre všetky typy vozidiel a požiadavky
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
            {/* Card 1: Zvýšenie výkonu */}
            <div className="glass-card-hover p-8">
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Gauge className="w-8 h-8 text-cyan-400" />
              </div>
              <h3 className="text-2xl font-semibold mb-4 text-foreground">Zvýšenie výkonu</h3>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Stage 1 & Stage 2 tuning</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Zvýšenie krútiaceho momentu</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Bezpečná optimalizácia výkonu</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Individuálne nastavenie pre každé vozidlo</span>
                </li>
              </ul>
            </div>

            {/* Card 2: Emisné riešenia */}
            <div className="glass-card-hover p-8">
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <ShieldCheck className="w-8 h-8 text-cyan-400" />
              </div>
              <h3 className="text-2xl font-semibold mb-4 text-foreground">Emisné riešenia</h3>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Softvérová diagnostika a úpravy</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>AdBlue systém off</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>DPF (Diesel Particulate Filter) úpravy</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>EGR (Exhaust Gas Recirculation) úpravy</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span className="text-xs italic">*Pre motoršportové účely</span>
                </li>
              </ul>
            </div>

            {/* Card 3: ECU Funkcie */}
            <div className="glass-card-hover p-8">
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
                <Cpu className="w-8 h-8 text-cyan-400" />
              </div>
              <h3 className="text-2xl font-semibold mb-4 text-foreground">ECU Funkcie</h3>
              <ul className="space-y-3 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Pop & Bangs (výfukové efekty)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Launch Control</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>V-Max odblokovanie</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Start-Stop systém off</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>Vlastné mapy a kalibrácie</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Expert Block - Detailed Information */}
      <section className="relative py-20 border-t border-gray-800/50">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="glass-card p-10 md:p-12">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Wrench className="w-6 h-6 text-cyan-400" />
                </div>
                <h2 className="text-3xl md:text-4xl font-bold text-foreground">Odborný prístup</h2>
              </div>
              
              <div className="space-y-6 text-muted-foreground leading-relaxed">
                <p className="text-lg">
                  REMAPPRO využíva najmodernejšie technológie a softvérové nástroje pre úpravy elektronických riadiacich jednotiek. 
                  Naša práca je založená na hĺbkovom porozumení motorov, palivových systémov a emisných kontrolných mechanizmov.
                </p>
                
                <p>
                  Špecializujeme sa na úpravy pre vozidlá v regióne <strong className="text-foreground">Veľký Krtíš, Lučenec, Zvolen</strong> a celú strednú a južnú časť Slovenska. 
                  Každé vozidlo je jedinečné, preto pristupujeme k každej objednávke individuálne a vytvárame špeciálne prispôsobené riešenia.
                </p>
                
                <p>
                  Naša metodika zahŕňa dôkladnú analýzu pôvodného softvéru, identifikáciu optimalizačných možností a vytvorenie bezpečných, 
                  testovaných úprav, ktoré respektujú limity motoru a zabezpečujú dlhodobú spoľahlivosť.
                </p>
                
                <div className="pt-6 border-t border-gray-800/50">
                  <h3 className="text-xl font-semibold text-foreground mb-4">Prečo si vybrať REMAPPRO?</h3>
                  <ul className="space-y-3">
                    <li className="flex items-start gap-3">
                      <Settings className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                      <span>Profesionálne softvérové riešenia založené na rokoch skúseností</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <ShieldCheck className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                      <span>Bezpečné a testované úpravy s dôrazom na spoľahlivosť</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Zap className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                      <span>Rýchle spracovanie objednávok s priemernou dobou dodania 2-4 hodiny</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <Cpu className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
                      <span>Individuálny prístup a podpora pre každého zákazníka</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Legal Disclaimer */}
      <section className="relative py-12 border-t border-gray-800/50">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <p className="text-xs text-muted-foreground/70 leading-relaxed text-center">
              <strong className="text-muted-foreground">Právne upozornenie:</strong> Úpravy emisných systémov (AdBlue, DPF, EGR) 
              sú poskytované výlučne pre motoršportové účely a použitie na uzavretých okruhoch. Tieto úpravy nie sú vhodné pre 
              bežné použitie na verejných komunikáciách a môžu byť v rozporu s platnou legislatívou v niektorých krajinách. 
              Zákazník je zodpovedný za dodržiavanie všetkých platných zákonov a predpisov v súvislosti s používaním upraveného vozidla.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20 border-t border-gray-800/50">
        <div className="container mx-auto px-4">
          <div className="glass-card p-12 text-center relative overflow-hidden max-w-4xl mx-auto">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5" />
            <div className="relative">
              <Zap className="w-16 h-16 text-cyan-400 mx-auto mb-6" />
              <h2 className="text-3xl font-bold mb-4">Pripravení začať?</h2>
              <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
                Kontaktujte nás alebo vytvorte objednávku a zažite profesionálny chip tuning od REMAPPRO.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link to="/order" className="btn-primary inline-flex items-center gap-2 text-lg">
                  Vytvoriť objednávku
                  <ArrowRight className="w-5 h-5" />
                </Link>
                <a 
                  href="mailto:info@remappro.eu" 
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  Kontaktovať nás
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};

export default AboutPage;
