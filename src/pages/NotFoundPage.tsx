import React from 'react';
import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="cb-card-3d rounded-3xl p-8 sm:p-12 text-center max-w-xl mx-auto my-8 space-y-4">
      <div className="w-12 h-12 rounded-2xl bg-[#F6EAEC] text-[#85383E] flex items-center justify-center mx-auto">
        <Compass className="w-6 h-6" />
      </div>
      <div className="text-xs font-mono font-semibold uppercase tracking-widest text-[#85383E]">
        404 · Page Not Found
      </div>
      <h1 className="font-display text-2xl font-bold text-[#3E0911]">
        We couldn&apos;t find that CareBridge page
      </h1>
      <p className="text-sm text-[#5D4A44] leading-relaxed">
        The link you followed may have moved or is not part of your Care Circle workspace.
      </p>
      <div className="pt-2">
        <Link
          to="/dashboard"
          className="cb-btn-3d inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white text-sm font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
};
