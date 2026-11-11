import { Link } from 'react-router-dom';

const NavLogo = () => (
  <Link
    to="/"
    aria-label="REMAPPRO-B2B"
    className="inline-flex h-9 shrink-0 items-center gap-2 no-underline leading-none antialiased"
  >
    <span className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-cyan-400/60 bg-transparent px-2.5 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
      <span className="text-2xl font-black leading-none tracking-tight text-white">R</span>
      <span className="neon-text text-2xl font-black leading-none tracking-tight">P</span>
    </span>
    <span className="whitespace-nowrap text-2xl font-semibold leading-none tracking-normal">
      <span className="neon-text">REMAP</span><span className="text-white">PRO</span><span className="text-white">-</span><span className="neon-text">B2</span><span className="text-white">B</span>
    </span>
  </Link>
);

export default NavLogo;
