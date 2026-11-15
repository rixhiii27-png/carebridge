import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred.',
    };
  }

  override componentDidCatch(error: Error) {
    console.error('CareBridge ErrorBoundary caught:', error);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#D7CAB7] flex items-center justify-center p-6">
          <div className="cb-card-3d max-w-lg w-full rounded-2xl p-8 text-[#3E0911]">
            <div className="flex items-center gap-3 text-[#85383E] mb-4">
              <AlertTriangle className="w-7 h-7 shrink-0" />
              <h1 className="text-xl font-bold">CareBridge Recovery Notice</h1>
            </div>
            <p className="text-sm text-[#5D4A44] mb-4 leading-relaxed">
              Something interrupted this view safely. Your saved records in Firestore remain protected.
            </p>
            <div className="bg-[#FAF7F2] border border-[#3E0911]/15 rounded-xl p-3 text-xs font-mono text-[#3E0911] break-words mb-6">
              {this.state.message}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="cb-btn-3d inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#71774B] hover:bg-[#5E633D] text-white font-semibold text-sm cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Reload CareBridge
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
