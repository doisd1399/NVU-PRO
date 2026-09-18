import React, { useState, useRef } from "react";
import { uploadService, UploadError } from "../../services/uploadService";
import { UploadCloud, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import {
  normalizeFileAccessError,
  snapshotSelectedFile,
} from "../../lib/fileAccess";

export const UploadTest: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Example user data that would normally come from your auth context
  const mockUser = {
    companyId: "TEST_COMPANY_123",
    userId: "USER_456",
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const selectedFile = input.files?.[0];
    input.value = "";

    if (selectedFile) {
      try {
        const { file: stableFile } = await snapshotSelectedFile(selectedFile, {
          maxBytes: 10 * 1024 * 1024,
          fallbackName: `upload-${Date.now()}.jpg`,
        });
        setFile(stableFile);
      } catch (error) {
        setFile(null);
        setError(normalizeFileAccessError(error).message);
        return;
      }
      setError(null);
      setUploadedUrl(null);
      setProgress(0);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Por favor, selecione um arquivo primeiro.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setProgress(0);

    try {
      const url = await uploadService.uploadImage({
        file,
        companyId: mockUser.companyId,
        userId: mockUser.userId,
        folder: "receipts", // specific folder inside the company
        onProgress: (percent) => setProgress(Math.round(percent)),
      });

      setUploadedUrl(url);
      setFile(null); // Clear selected file after success
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      if (err instanceof UploadError) {
        setError(err.message);
      } else {
        setError("Ocorreu um erro inesperado durante o upload.");
      }
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="max-w-md w-full bg-white dark:bg-[#1A1F26] rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-6 overflow-hidden">
      <div className="flex items-center space-x-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400">
          <UploadCloud size={20} />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Teste de Upload Firebase
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Suporta JPG, PNG, WEBP (Max 5MB)
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* File Selection Area */}
        <div className="w-full">
          <input
            type="file"
            accept="image/jpeg, image/png, image/webp"
            onChange={handleFileChange}
            disabled={isUploading}
            ref={fileInputRef}
            className="block w-full text-sm text-gray-500 dark:text-gray-400
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-medium
              file:bg-gray-50 file:text-gray-700
              hover:file:bg-gray-100 dark:file:bg-gray-800 dark:file:text-gray-300
              disabled:opacity-50"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-start p-3 text-sm text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-400 rounded-md border border-red-100 dark:border-red-900">
            <AlertCircle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {/* Upload Button & Progress */}
        <div className="pt-2">
          {isUploading ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Enviando...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleUpload}
              disabled={!file}
              className="w-full flex items-center justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-300 dark:disabled:bg-gray-800 disabled:cursor-not-allowed transition-colors"
            >
              Iniciar Upload
            </button>
          )}
        </div>

        {/* Success Feedback */}
        {uploadedUrl && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-500/10 rounded-md border border-green-100 dark:border-green-900/30">
            <div className="flex items-center text-green-700 dark:text-green-400 mb-2">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium">
                Upload concluído com sucesso!
              </span>
            </div>
            <a
              href={uploadedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline break-all block mt-2"
            >
              {uploadedUrl}
            </a>

            {/* Simple Preview */}
            <div className="mt-3 aspect-video bg-gray-100 dark:bg-gray-900 rounded overflow-hidden border border-gray-200 dark:border-gray-800">
              <img
                src={uploadedUrl}
                alt="Upload preview"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
