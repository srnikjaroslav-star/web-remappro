import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import Logo from "@/components/Logo";
const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex w-full flex-grow flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80">
        <div className="container mx-auto px-4 py-4">
          <Link to="/">
            <Logo size="md" />
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="flex flex-grow items-center justify-center">
        <div className="text-center">
          <h1 className="mb-4 text-6xl font-bold neon-text">404</h1>
          <p className="mb-6 text-xl text-muted-foreground">Oops! Page not found</p>
          <Link to="/" className="btn-primary inline-block">
            Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
