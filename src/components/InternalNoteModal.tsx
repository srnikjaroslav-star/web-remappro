import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Save, X } from 'lucide-react';

interface InternalNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  orderNumber: string;
  initialNote: string;
  onSave: (note: string) => void;
  isSaving?: boolean;
}

const InternalNoteModal = ({
  isOpen,
  onClose,
  orderId,
  orderNumber,
  initialNote,
  onSave,
  isSaving = false,
}: InternalNoteModalProps) => {
  const [note, setNote] = useState(initialNote);

  useEffect(() => {
    setNote(initialNote);
  }, [initialNote, isOpen]);

  const handleSave = () => {
    onSave(note);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] bg-background border border-border/50">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            Internal Note — <span className="text-primary">{orderNumber}</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Enter internal notes, technical details, or reminders..."
            className="min-h-[200px] bg-secondary/30 border-border/30 focus:ring-primary/50 resize-y"
          />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving} className="rounded-none border-red-400/70 bg-red-500/10 text-red-400 shadow-[0_0_14px_rgba(248,113,113,0.32)] hover:bg-red-500/16 hover:text-red-400 hover:shadow-[0_0_16px_rgba(248,113,113,0.42)]">
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="rounded-none border border-primary/80 bg-primary/10 text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] hover:bg-primary/16 hover:text-primary hover:shadow-[0_0_16px_rgba(0,242,255,0.42)]">
            <Save className={`w-4 h-4 mr-2 ${isSaving ? 'animate-pulse' : ''}`} />
            {isSaving ? 'Saving...' : 'Save Note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InternalNoteModal;
