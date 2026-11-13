import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import Footer from "@/components/Footer";
import PasswordRecovery from "@/components/PasswordRecovery";
import { LanguageProvider } from "@/i18n/LanguageContext";
import OrderPage from "./pages/OrderPage";
// OPRAVENÝ IMPORT: Mieri priamo na súbor v pages
import TrackPage from "./pages/TrackPage";
import ManagementPortal from "./pages/ManagementPortal";
import Login from "./pages/Login";
import PricingPage from "./pages/PricingPage";
import SuccessPage from "./pages/SuccessPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import RefundsPage from "./pages/RefundsPage";
import AboutPage from "./pages/AboutPage";
import ServiceDetail from "./pages/ServiceDetail";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const isRecoveryLink = () => {
  const raw = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(raw).get('type') === 'recovery';
};

const AppShell = () => {
  const [recovery, setRecovery] = useState(isRecoveryLink);
  const { pathname } = useLocation();
  const showFooter = pathname !== "/login" && pathname !== "/track" && pathname !== "/sprava-29-vk";

  if (recovery) {
    return (
      <PasswordRecovery
        onDone={() => {
          window.location.hash = '#/';
          setRecovery(false);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex w-full flex-grow flex-col">
        <Routes>
          {/* Koreň aplikácie je objednávkový formulár. */}
          <Route path="/" element={<OrderPage />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/objednavky" element={<OrderPage />} />
          <Route path="/profil" element={<OrderPage />} />

          {/* TRACKING: Toto je kľúčová cesta pre tvoj link z emailu */}
          <Route path="/track" element={<TrackPage />} />

          {/* Ostatné systémové stránky */}
          <Route path="/about" element={<AboutPage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/success" element={<SuccessPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/sprava-29-vk" element={<ManagementPortal />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refunds" element={<RefundsPage />} />

          <Route path="/services/:serviceSlug" element={<ServiceDetail />} />

          {/* 404 - Stránka nenájdená */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {showFooter && <Footer />}
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <LanguageProvider>
        <HashRouter>
          <AppShell />
        </HashRouter>
      </LanguageProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
