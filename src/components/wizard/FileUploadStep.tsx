import { useState, useRef } from 'react';
import { Upload, File, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { uploadOrderFile } from '@/lib/ecuFile';
import { supabase } from '@/lib/supabase';

interface FileUploadStepProps {
  onFileUploaded: (url: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

const FileUploadStep = ({ onFileUploaded, onBack, onSubmit, isSubmitting }: FileUploadStepProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setError(null);
    setUploading(true);
    setUploadProgress(0);
    
    try {
      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const { data: authData } = await supabase.auth.getUser();
      const storedFile = await uploadOrderFile(selectedFile, authData.user?.id || 'guest');

      clearInterval(progressInterval);

      setUploadProgress(100);
      setUploadComplete(true);
      onFileUploaded(storedFile);
    } catch (err) {
      console.error('Upload error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="animate-fadeIn">
      <h2 className="text-2xl font-bold mb-2">Upload ECU File</h2>
      <p className="text-muted-foreground mb-8">Upload your original ECU file for tuning</p>
      
      <div
        onClick={() => fileInputRef.current?.click()}
        className={`
          glass-card p-12 border-2 border-dashed cursor-pointer transition-all duration-300
          flex flex-col items-center justify-center text-center
          ${uploadComplete ? 'border-green-500/50' : 'border-primary/30 hover:border-primary/60'}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
          accept=".bin,.ori,.mod,.ecu"
        />
        
        {uploading ? (
          <div className="w-full max-w-xs">
            <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
            <p className="font-medium mb-2">Uploading...</p>
            <div className="progress-bar">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground mt-2">{uploadProgress}%</p>
          </div>
        ) : uploadComplete ? (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mb-4" />
            <p className="font-medium text-green-500 mb-2">Upload Complete!</p>
            <div className="flex items-center gap-2 text-muted-foreground">
              <File className="w-4 h-4" />
              <span className="text-sm">{file?.name}</span>
            </div>
          </>
        ) : (
          <>
            <Upload className="w-12 h-12 text-primary mb-4" />
            <p className="font-medium mb-2">Click to upload your ECU file</p>
            <p className="text-sm text-muted-foreground">
              Supported formats: .bin, .ori, .mod, .ecu
            </p>
          </>
        )}
      </div>
      
      {error && (
        <div className="mt-4 p-4 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-3 text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}
      
      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="btn-secondary">
          Back
        </button>
        <button 
          onClick={onSubmit} 
          disabled={!uploadComplete || isSubmitting}
          className={`btn-primary flex items-center gap-2 ${(!uploadComplete || isSubmitting) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? 'Submitting...' : 'Submit Order'}
        </button>
      </div>
    </div>
  );
};

export default FileUploadStep;
