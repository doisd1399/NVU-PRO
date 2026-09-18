import React, { useEffect, useState } from "react";
import { runDiagnostics, DiagnosticResult } from "../services/runtimeDiagnostics";
import { ArrowLeft, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Diagnostics() {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const navigate = useNavigate();

  const performCheck = async () => {
    setLoading(true);
    const res = await runDiagnostics();
    setResult(res);
    setLoading(false);
  };

  useEffect(() => {
    performCheck();
  }, []);

  const StatusIcon = ({ ready }: { ready: boolean }) =>
    ready ? (
      <CheckCircle className="w-5 h-5 text-emerald-500" />
    ) : (
      <XCircle className="w-5 h-5 text-red-500" />
    );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#09090b] text-gray-900 dark:text-gray-100 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-bold tracking-tight">System Diagnostics</h1>
          </div>
          <button
            onClick={performCheck}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </header>

        {loading && !result ? (
          <div className="text-center py-12 text-gray-500">Running checks...</div>
        ) : result ? (
          <div className="grid gap-6 md:grid-cols-2">
            {/* Platform Information */}
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 border-b border-gray-100 dark:border-gray-800 pb-2">
                Platform
              </h2>
              <ul className="space-y-3 text-sm">
                <li className="flex justify-between">
                  <span className="text-gray-500">Target</span>
                  <span className="font-mono">{result.platform}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-gray-500">Native Capacitor</span>
                  <span className="font-mono">{result.isNativePlatform ? "Yes" : "No"}</span>
                </li>
                <li className="flex justify-between items-center">
                  <span className="text-gray-500">Remote Config URL</span>
                  <span className="font-mono text-xs truncate max-w-[150px]">{result.remoteAppUrl}</span>
                </li>
              </ul>
            </div>

            {/* Build Manifest */}
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 border-b border-gray-100 dark:border-gray-800 pb-2">
                Build Manifest
              </h2>
              {result.buildManifest ? (
                <ul className="space-y-3 text-sm">
                  <li className="flex justify-between">
                    <span className="text-gray-500">Version</span>
                    <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                      {result.buildManifest.version}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-gray-500">Build ID</span>
                    <span className="font-mono text-xs">{result.buildManifest.buildId}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-gray-500">Env / Source</span>
                    <span className="font-mono">{result.buildManifest.source}</span>
                  </li>
                </ul>
              ) : (
                <div className="text-red-500 text-sm">
                  <p>Manifest not found or unavailable.</p>
                  <p className="text-xs mt-1 text-gray-500">{result.manifestError}</p>
                </div>
              )}
            </div>

            {/* Firebase Status */}
            <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm md:col-span-2">
              <h2 className="text-lg font-semibold mb-4 border-b border-gray-100 dark:border-gray-800 pb-2">
                Firebase Connectivity
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex flex-col items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <span className="text-xs text-gray-500 mb-2 uppercase tracking-wider">SDK</span>
                  <StatusIcon ready={result.firebase.initialized} />
                </div>
                <div className="flex flex-col items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <span className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Auth</span>
                  <StatusIcon ready={result.firebase.auth === 'ready'} />
                </div>
                <div className="flex flex-col items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <span className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Firestore</span>
                  <StatusIcon ready={result.firebase.firestore === 'ready'} />
                </div>
                <div className="flex flex-col items-center p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <span className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Storage</span>
                  <StatusIcon ready={result.firebase.storage === 'ready'} />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
