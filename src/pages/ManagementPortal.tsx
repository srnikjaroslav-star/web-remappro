import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  Download, Upload, Eye, CheckCircle,
  RefreshCw, Search, Power, Save, Trash2, LogOut, FileText, X, RotateCcw
} from 'lucide-react';
import SystemStatus, { fetchSystemStatusFromDB, setSystemStatusInDB, isSystemOnline, SystemStatusMode } from '@/components/SystemStatus';
import SmartTooltip from '@/components/SmartTooltip';
import InternalNoteModal from '@/components/InternalNoteModal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { Order, ActivityLog } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SERVICES } from '@/data/services';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const ManagementPortal = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<Record<string, { checksum_crc: string; internal_note: string; important_note: string }>>({});
  const [importantNote, setImportantNote] = useState<string>('');
  const [savingImportantNote, setSavingImportantNote] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMode, setStatusMode] = useState<SystemStatusMode>('auto');
  const [statusLoading, setStatusLoading] = useState(false);
  const [noteModalOrder, setNoteModalOrder] = useState<Order | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [pendingCancelOrder, setPendingCancelOrder] = useState<Order | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [taxPointDate, setTaxPointDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [refundIban, setRefundIban] = useState<string>('');
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [financialStats, setFinancialStats] = useState<{ grossRevenue: number; refunds: number; netRevenue: number } | null>(null);
  
  // NEW: Refund Wizard Modal State
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundModalOrder, setRefundModalOrder] = useState<Order | null>(null);
  const [refundWizardAmount, setRefundWizardAmount] = useState<string>('');
  const [refundWizardReason, setRefundWizardReason] = useState('');
  const [issuingCreditNote, setIssuingCreditNote] = useState(false);
  
  // Aliasy pre kompatibilitu
  const isRefundModalOpen = refundModalOpen;
  const setIsRefundModalOpen = setRefundModalOpen;
  const selectedOrderForRefund = refundModalOrder;
  const setSelectedOrderForRefund = setRefundModalOrder;

  // Check authentication on mount - only allow specific email
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate('/login');
        return;
      }

      // Check if user email matches allowed email
      const allowedEmail = import.meta.env.VITE_ADMIN_EMAIL || 'info@remappro.eu';
      const userEmail = session.user?.email?.toLowerCase();
      
      if (userEmail !== allowedEmail.toLowerCase()) {
        toast.error('Nemáte oprávnenie na prístup k tomuto portálu');
        await supabase.auth.signOut();
        navigate('/login');
        return;
      }

      setIsCheckingAuth(false);
    };

    checkAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        navigate('/login');
        return;
      }

      // Re-check email on auth state change
      const allowedEmail = import.meta.env.VITE_ADMIN_EMAIL || 'info@remappro.eu';
      const userEmail = session.user?.email?.toLowerCase();
      
      if (userEmail !== allowedEmail.toLowerCase()) {
        toast.error('Nemáte oprávnenie na prístup k tomuto portálu');
        await supabase.auth.signOut();
        navigate('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  // Load initial status from DB
  useEffect(() => {
    if (isCheckingAuth) return;
    
    const loadStatus = async () => {
      const mode = await fetchSystemStatusFromDB();
      setStatusMode(mode);
    };
    loadStatus();
  }, [isCheckingAuth]);

  const cycleStatusMode = async () => {
    // Cycle: auto -> online -> offline -> auto
    const nextMode: Record<SystemStatusMode, SystemStatusMode> = {
      'auto': 'online',
      'online': 'offline',
      'offline': 'auto'
    };
    const newMode = nextMode[statusMode];
    
    setStatusLoading(true);
    const success = await setSystemStatusInDB(newMode);
    setStatusLoading(false);
    
    if (success) {
      setStatusMode(newMode);
      const messages: Record<SystemStatusMode, string> = {
        'auto': 'System status set to AUTO (follows schedule 08:00-20:00)',
        'online': 'System forced ONLINE (visible to customers)',
        'offline': 'System forced OFFLINE (visible to customers)'
      };
      toast.success(messages[newMode]);
    } else {
      toast.error('Failed to update system status. Check RLS policies.');
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders((data || []) as Order[]);
    } catch (error) {
      console.error('Fetch error:', error);
      toast.error('Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isCheckingAuth) return;

    fetchOrders();
    calculateFinancialStats();

    // Set up realtime subscription for orders table
    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all changes (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'orders'
        },
        (payload) => {
          console.log('Realtime update received:', payload);
          
          if (payload.eventType === 'INSERT') {
            setOrders(prev => [payload.new as Order, ...prev]);
            toast.info('New order received!');
          } else if (payload.eventType === 'UPDATE') {
            setOrders(prev => prev.map(order => 
              order.id === payload.new.id ? (payload.new as Order) : order
            ));
          } else if (payload.eventType === 'DELETE') {
            setOrders(prev => prev.filter(order => order.id !== payload.old.id));
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to orders realtime updates');
        }
      });

    return () => {
      console.log('Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [isCheckingAuth]);

  // Sync detailOrder with orders array when invoice_number or important_note changes
  useEffect(() => {
    if (detailOrder) {
      const updatedOrder = orders.find(o => o.id === detailOrder.id);
      if (updatedOrder && (
        updatedOrder.invoice_number !== detailOrder.invoice_number ||
        updatedOrder.invoice_url !== detailOrder.invoice_url ||
        updatedOrder.credit_note_number !== detailOrder.credit_note_number ||
        updatedOrder.credit_note_pdf !== detailOrder.credit_note_pdf ||
        updatedOrder.status !== detailOrder.status ||
        updatedOrder.result_file_url !== detailOrder.result_file_url ||
        updatedOrder.important_note !== detailOrder.important_note
      )) {
        setDetailOrder(updatedOrder);
        // Sync important_note from updated order to textarea
        if (updatedOrder.important_note !== detailOrder.important_note) {
          setImportantNote(updatedOrder.important_note || '');
        }
        
        // Fetch activity logs when detail order is set
        if (updatedOrder.id) {
          fetchActivityLogs(updatedOrder.id);
        }
      }
    }
  }, [orders, detailOrder]);

  // Initialize important_note when detailOrder changes (on open or refresh)
  useEffect(() => {
    if (detailOrder) {
      // Always sync with detailOrder.important_note to ensure persistence
      // This ensures the textarea shows the value from database
      setImportantNote(detailOrder.important_note || '');
      // Reset saved state when switching orders
      setSavedImportantNote(null);
    } else {
      // Clear when no detail order is selected
      setImportantNote('');
      setSavedImportantNote(null);
    }
  }, [detailOrder?.id, detailOrder?.important_note]);

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error('Chyba pri odhlasovaní');
        return;
      }
      toast.success('Úspešne odhlásený');
      navigate('/login');
    } catch (error: any) {
      toast.error('Chyba pri odhlasovaní');
    }
  };

  const sendStatusEmail = async (order: Order, status: string) => {
    // STRICT BLOCK: If status is 'cancelled', DO NOT send any emails
    if (status === 'cancelled' || order.status === 'cancelled') {
      console.warn('[sendStatusEmail] BLOCKED: Status is cancelled - email sending is forbidden');
      throw new Error('Email sending blocked: Order is cancelled. Credit note workflow must be used instead.');
    }
    
    try {
      const orderId = order.order_number || order.id.slice(0, 8).toUpperCase();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://kivqvwdfujsnuwfxjtcz.supabase.co';
      // Use anon key for client-side calls - Edge Function will use its own RESEND_API_KEY
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
      
      console.log('[sendStatusEmail] Sending email for order:', {
        orderId,
        orderNumber: orderId,
        customerEmail: order.customer_email,
        status,
      });
      
      // Call Edge Function via direct fetch (same method as admin notifications)
      const response = await fetch(`${supabaseUrl}/functions/v1/status-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          orderNumber: orderId,
          customerEmail: order.customer_email,
          customerName: order.customer_name || '',
          carBrand: order.car_brand || '',
          carModel: order.car_model || '',
          year: order.year || 0,
          status: status,
        }),
      });

      const responseData = await response.json();
      console.log('[sendStatusEmail] Response:', response.status, responseData);

      if (!response.ok) {
        console.error('[sendStatusEmail] HTTP error:', {
          status: response.status,
          statusText: response.statusText,
          body: responseData,
        });
        throw new Error(responseData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      if (responseData.success === false) {
        console.error('[sendStatusEmail] Email sending failed:', {
          error: responseData.error,
          details: responseData.details,
        });
        throw new Error(responseData.error || 'Email sending failed');
      }

      console.log('[sendStatusEmail] Email sent successfully');
      return responseData;
    } catch (error: any) {
      console.error('[sendStatusEmail] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      throw error;
    }
  };

  // IBAN Extractor function
  const extractIban = (order: Order): string | null => {
    // Try to extract IBAN from customer_notes
    if (order.customer_note) {
      const ibanRegex = /[A-Z]{2}\d{2}[A-Z0-9]{4,30}/gi;
      const matches = order.customer_note.match(ibanRegex);
      if (matches && matches.length > 0) {
        return matches[0].toUpperCase().replace(/\s/g, '');
      }
    }
    
    // Try to extract from Stripe metadata (if available)
    // Note: This would require fetching Stripe session data
    // For now, return null if not found in customer_notes
    return null;
  };

  // Log activity function
  const logActivity = async (orderId: string, action: string, details: Record<string, any>, adminId?: string) => {
    try {
      const { error } = await supabase
        .from('activity_logs')
        .insert({
          order_id: orderId,
          action,
          details,
          admin_id: adminId || 'system',
        });
      
      if (error) {
        console.error('[logActivity] Failed to log activity:', error);
      } else {
        console.log('[logActivity] Activity logged:', { orderId, action, details });
      }
    } catch (err) {
      console.error('[logActivity] Error logging activity:', err);
    }
  };

  // Fetch activity logs for an order
  const fetchActivityLogs = async (orderId: string) => {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setActivityLogs((data || []) as ActivityLog[]);
    } catch (error) {
      console.error('[fetchActivityLogs] Error fetching activity logs:', error);
      setActivityLogs([]);
    }
  };

  // Calculate financial statistics
  const calculateFinancialStats = async () => {
    try {
      // Try to select with refund_amount, but fallback to basic fields if column doesn't exist
      let ordersData: any[] = [];
      let error: any = null;
      
      try {
        const result = await supabase
          .from('orders')
          .select('total_price, invoice_number, credit_note_number, refund_amount');
        ordersData = result.data || [];
        error = result.error;
      } catch (err: any) {
        // If refund_amount column doesn't exist, select without it
        if (err?.message?.includes('refund_amount') || err?.code === 'PGRST204') {
          console.warn('[calculateFinancialStats] refund_amount column not found, using basic fields');
          const result = await supabase
            .from('orders')
            .select('total_price, invoice_number, credit_note_number');
          ordersData = result.data || [];
          error = result.error;
        } else {
          throw err;
        }
      }
      
      if (error) throw error;
      
      let grossRevenue = 0;
      let refunds = 0;
      
      (ordersData || []).forEach((order: any) => {
        const price = typeof order.total_price === 'string' 
          ? parseFloat(order.total_price) 
          : (order.total_price || 0);
        
        // Add to gross revenue if invoice exists
        if (order.invoice_number) {
          grossRevenue += price;
        }
        
        // Add to refunds if credit note exists
        if (order.credit_note_number) {
          // Use refund_amount if available, otherwise use full price
          const refundAmount = order.refund_amount !== undefined && order.refund_amount !== null
            ? (typeof order.refund_amount === 'string' ? parseFloat(order.refund_amount) : order.refund_amount)
            : price;
          refunds += Math.abs(refundAmount || 0);
        }
      });
      
      setFinancialStats({
        grossRevenue,
        refunds,
        netRevenue: grossRevenue - refunds,
      });
    } catch (error) {
      console.error('[calculateFinancialStats] Error calculating stats:', error);
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    console.log('Updating order status:', { orderId, newStatus });
    
    // THE REFUND CONNECTION: If changing to cancelled, COMPLETELY STOP old logic and redirect to processFullRefund
    if (newStatus === 'cancelled') {
      const order = orders.find(o => o.id === orderId);
      if (!order) {
        toast.error('Objednávka nebola nájdená');
        return;
      }
      
      // Extract IBAN if available
      const extractedIban = extractIban(order);
      if (extractedIban) {
        setRefundIban(extractedIban);
      }
      
      // Set default refund amount to 100% of total price
      const totalPrice = typeof order.total_price === 'string' 
        ? parseFloat(order.total_price) 
        : (order.total_price || 0);
      
      // If total_price is 0, use window.prompt to request amount
      if (totalPrice === 0 || isNaN(totalPrice) || !totalPrice) {
        const manualAmount = window.prompt('Order price is 0. Enter refund amount:');
        if (!manualAmount || manualAmount.trim() === '') {
          toast.error('Refund amount is required');
          return;
        }
        const parsedAmount = parseFloat(manualAmount.trim());
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
          toast.error('Please enter a valid amount greater than zero');
          return;
        }
        setRefundAmount(parsedAmount.toFixed(2));
      } else {
        setRefundAmount(totalPrice.toFixed(2));
      }
      
      // Set tax point date to today
      setTaxPointDate(new Date().toISOString().split('T')[0]);
      setRefundReason('');
      
      // Show dialog - when confirmed, it will call processFullRefund
      setPendingCancelOrder(order);
      setCancelDialogOpen(true);
      return; // STOP - don't proceed with normal status change
    }
    
    // For other statuses, proceed normally
    await executeStatusChange(orderId, newStatus);
  };

  const executeStatusChange = async (orderId: string, newStatus: string) => {
    console.log('Executing status change:', { orderId, newStatus });
    
    // Find the order before update
    const order = orders.find(o => o.id === orderId);
    const previousStatus = order?.status;
    
    // Optimistic UI update
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));

    try {
      // If changing to cancelled, multiply total_price by -1 for credit note
      const updateData: any = { status: newStatus };
      if (newStatus === 'cancelled' && order?.total_price) {
        const totalPrice = typeof order.total_price === 'string' 
          ? parseFloat(order.total_price) 
          : order.total_price;
        updateData.total_price = -Math.abs(totalPrice);
      }

      const { data, error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', orderId)
        .select();

      console.log('Update response:', { data, error });

      if (error) {
        console.error('Supabase update error:', error);
        throw error;
      }

      // DISCONNECTED: If cancelled, COMPLETELY STOP - NO automatic emails
      // Email is sent ONLY through Refund Wizard (openRefundModal -> issueCreditNote)
      if (newStatus === 'cancelled') {
        console.log('[executeStatusChange] Status is CANCELLED - NO automatic emails. Use Refund Wizard instead.');
        // Just update status, no emails
        return;
      }
      
      // For non-cancelled statuses, proceed with normal email workflows
      if (newStatus !== previousStatus && order && order.customer_email && newStatus !== 'cancelled') {
        // Send email for status changes to processing or completed (EXPLICITLY excluding cancelled)
        if (newStatus === 'processing' || newStatus === 'completed') {
          try {
            await sendStatusEmail(order, newStatus);
            toast.success('Status aktualizovaný a email odoslaný klientovi');
          } catch (emailError: any) {
            console.error('[executeStatusChange] Email sending failed:', {
              error: emailError,
              message: emailError?.message,
              stack: emailError?.stack,
              orderId: order.id,
              customerEmail: order.customer_email,
            });
            
            // Show detailed error message
            const errorMsg = emailError?.message || 'Neznáma chyba';
            if (errorMsg.includes('RESEND_API_KEY') || errorMsg.includes('API key')) {
              toast.error('Chyba: RESEND_API_KEY nie je nastavený alebo je neplatný');
            } else if (errorMsg.includes('domain') || errorMsg.includes('verified')) {
              toast.error('Chyba: Emailová doména nie je overená v Resend');
            } else {
              toast.error(`Chyba pri odosielaní emailu: ${errorMsg}`);
            }
            toast.success('Status aktualizovaný (email sa nepodarilo odoslať)');
          }
        } else {
          const statusLabels: Record<string, string> = {
            'pending': 'Čakajúce',
            'processing': 'V Procese',
            'completed': 'Dokončené',
            'paid': 'Zaplatené',
            'cancelled': 'Zrušené'
          };
          toast.success(`Stav zmenený na: ${statusLabels[newStatus] || newStatus}`);
        }
      } else {
        const statusLabels: Record<string, string> = {
          'pending': 'Čakajúce',
          'processing': 'V Procese',
          'completed': 'Dokončené',
          'paid': 'Zaplatené',
          'cancelled': 'Zrušené'
        };
        toast.success(`Stav zmenený na: ${statusLabels[newStatus] || newStatus}`);
      }

      await fetchOrders();
    } catch (error: any) {
      console.error('Update error:', error);
      toast.error(`Chyba pri aktualizácii statusu: ${error.message || 'Neznáma chyba'}`);
      // Revert optimistic update
      if (order) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: previousStatus || 'pending' } : o)));
      }
      await fetchOrders();
    }
  };

  // THE REFUND CONNECTION: processFullRefund - Complete refund workflow in one indivisible unit
  const processFullRefund = async (orderId: string, amount: number, reason: string) => {
    console.log('[processFullRefund] Starting complete refund workflow:', { orderId, amount, reason });
    
    // Show admin message
    toast.info('Generujem dobropis a odosielam refund email...');
    
    const order = orders.find(o => o.id === orderId);
    if (!order) {
      toast.error('Objednávka nebola nájdená');
      return;
    }

    try {
      // KROK A (Dáta): Create refundData object
      // total_price = original_price * -1
      // document_type = 'CREDIT_NOTE'
      const originalPrice = typeof order.total_price === 'string' 
        ? parseFloat(order.total_price) 
        : (order.total_price || 0);
      const negativeAmount = -Math.abs(amount);
      
      // VALIDATION: Ensure amount is negative
      if (negativeAmount >= 0) {
        console.error('[processFullRefund] CRITICAL ERROR: Amount is not negative!', { amount, negativeAmount });
        throw new Error('Dobropis musí mať zápornú sumu. Aktuálna suma: ' + amount);
      }
      
      const vatRate = 0.20; // 20% VAT
      const negativeSubtotal = negativeAmount / (1 + vatRate);
      const negativeTaxAmount = negativeAmount - negativeSubtotal;

      // Get original invoice number (if exists)
      const originalInvoiceNumber = order.invoice_number || null;
      
      // Generate credit note number: CN- + original invoice number
      let creditNoteNumber: string;
      if (originalInvoiceNumber && originalInvoiceNumber.startsWith('INV-')) {
        creditNoteNumber = originalInvoiceNumber.replace(/^INV-/, 'CN-');
      } else {
        // Fallback: Generate new number if no invoice exists
        const year = new Date().getFullYear();
        const random = Math.floor(1000 + Math.random() * 9000);
        creditNoteNumber = `CN-${year}-${random}`;
      }

      // Prepare items - single item for refund
      const items = [{
        name: `Storno objednávky ${order.order_number || order.id.slice(0, 8)}`,
        price: negativeAmount, // Already negative
        quantity: 1
      }];

      // KROK A: Create refundData object
      const refundData = {
        orderId: order.id,
        orderNumber: order.order_number || '',
        customerName: order.customer_name || 'Customer',
        customerEmail: order.customer_email,
        items: items,
        totalAmount: negativeAmount, // original_price * -1
        subtotal: negativeSubtotal, // Negative subtotal
        taxAmount: negativeTaxAmount, // Negative tax
        brand: order.car_brand || order.brand,
        model: order.car_model || order.model,
        fuelType: order.fuel_type,
        year: order.year,
        ecuType: order.ecu_type,
        vin: order.vin,
        documentType: 'CREDIT_NOTE' as const, // document_type = 'CREDIT_NOTE'
        creditNote: true,
        is_credit_note: true,
        originalInvoiceNumber: originalInvoiceNumber,
        creditNoteNumber: creditNoteNumber,
        refundAmount: negativeAmount,
        refundReason: reason,
        refundIban: refundIban,
        taxPointDate: taxPointDate,
      };

      console.log('[processFullRefund] KROK A: refundData created:', refundData);

      // KROK B (Generovanie): Call Edge function and WAIT for PDF URL
      console.log('[processFullRefund] KROK B: Calling Edge function generate-invoice...');
      
      const { data: invoiceResponse, error: invoiceError } = await supabase.functions.invoke('generate-invoice', {
        body: refundData,
      });

      // ERROR HANDLING: If PDF generation fails, DO NOT change status
      if (invoiceError) {
        console.error('[processFullRefund] KROK B FAILED: Credit note generation failed:', invoiceError);
        toast.error(`Chyba pri generovaní dobropisu: ${invoiceError.message}. Status objednávky sa nezmenil.`);
        throw new Error(`Chyba pri generovaní dobropisu: ${invoiceError.message}`);
      }

      console.log('[processFullRefund] KROK B SUCCESS: Credit note PDF generated and email sent by Edge function');

      // KROK C: Edge function already sent the email with PDF attachment
      // The Edge function (generate-invoice) handles:
      // - PDF generation with negative amounts
      // - Saving PDF to credit-notes bucket
      // - Saving credit_note_number and credit_note_pdf to database
      // - Sending email with PDF attachment
      // So KROK C is already complete!

      // Update order status to cancelled and save refund data
      // Note: credit_note_number and credit_note_pdf are already saved by Edge function
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          refund_amount: negativeAmount,
          refund_reason: reason || null,
          refund_iban: refundIban || null,
          tax_point_date: taxPointDate || null,
        })
        .eq('id', orderId);

      if (updateError) {
        console.error('[processFullRefund] Failed to update order status:', updateError);
        throw new Error(`Chyba pri aktualizácii statusu: ${updateError.message}`);
      }

      console.log('[processFullRefund] Complete refund workflow finished successfully');
      await fetchOrders();
      toast.success(`Dobropis ${creditNoteNumber} vygenerovaný a odoslaný zákazníkovi.`);
      
    } catch (error: any) {
      console.error('[processFullRefund] Refund workflow failed:', error);
      toast.error(`Chyba pri refundácii: ${error.message}. Status objednávky sa nezmenil.`);
      // Refresh orders to revert any optimistic updates
      await fetchOrders();
      throw error;
    }
  };

  // Legacy handleRefund - now redirects to processFullRefund
  const handleRefund = async (orderId: string, amount: number, reason: string) => {
    // Redirect to processFullRefund
    return processFullRefund(orderId, amount, reason);
  };

  // NEW: openRefundModal - Opens the Refund Wizard Modal
  const openRefundModal = (order: Order) => {
    console.log('[openRefundModal] Opening refund modal for order:', order.id);
    
    // Set default refund amount to order.total_price
    const totalPrice = typeof order.total_price === 'string' 
      ? parseFloat(order.total_price) 
      : (order.total_price || 0);
    
    setRefundWizardAmount(totalPrice > 0 ? totalPrice.toFixed(2) : '');
    setRefundWizardReason('');
    setRefundModalOrder(order);
    setRefundModalOpen(true);
  };

  // NEW: handleIssueCreditNote - Final action when confirming refund
  const handleIssueCreditNote = async () => {
    if (!refundModalOrder) {
      toast.error('Objednávka nebola nájdená');
      return;
    }

    // Ak je v DB nula, vezmeme manualAmount z Modalu
    const amountToRefund = parseFloat(refundWizardAmount) || refundModalOrder.total_price || 0;
    
    if (!amountToRefund || amountToRefund <= 0) {
      toast.error('Chyba: Suma pre dobropis musí byť vyššia ako 0.');
      return;
    }

    if (!refundWizardReason.trim()) {
      toast.error('Prosím zadajte dôvod refundácie');
      return;
    }

    setIssuingCreditNote(true);
    toast.info('Generujem dobropis a odosielam refund email...');

    try {
      // Presmerovanie: Použi ŠPECIÁLNY modul pre dobropisy
      console.log("Spúšťam ŠPECIÁLNY modul pre dobropisy...");
      
      const requestPayload = {
        orderId: refundModalOrder.id,
        orderNumber: refundModalOrder.order_number || '',
        customerEmail: refundModalOrder.customer_email,
        customerName: refundModalOrder.customer_name || undefined,
        totalAmount: parseFloat(amountToRefund.toFixed(2)), // Posielame plusové, Edge funkcia ho otočí na -1
        taxAmount: parseFloat(amountToRefund.toFixed(2)) * 0.20, // Výpočet DPH (ak si platca)
        refundReason: refundWizardReason,
      };
      
      // Debugging Frontendu: Console.log pred volaním funkcie
      console.log("INVOKING FUNCTION generate-credit-note WITH:", requestPayload);
      console.log('[handleIssueCreditNote] Sending request to generate-credit-note:', JSON.stringify(requestPayload, null, 2));
      
      const { data, error } = await supabase.functions.invoke('generate-credit-note', {
        body: requestPayload,
      });

      if (error) {
        console.error('[handleIssueCreditNote] Error:', error);
        throw new Error(`Chyba pri generovaní dobropisu: ${error.message}`);
      }

      // Edge funkcia už aktualizovala databázu (status, refund_amount, credit_note_number, credit_note_pdf)
      // Takže len refreshneme dáta
      console.log('[handleIssueCreditNote] Credit note generated successfully:', data);

      console.log('[handleIssueCreditNote] Dobropis úspešne vygenerovaný a odoslaný!');
      await fetchOrders();
      toast.success('Dobropis úspešne vygenerovaný a odoslaný!');
      
      // Close modal
      setRefundModalOpen(false);
      setRefundModalOrder(null);
      setRefundWizardAmount('');
      setRefundWizardReason('');
      
    } catch (error: any) {
      console.error('[handleIssueCreditNote] Failed:', error);
      toast.error(`Chyba: ${error.message}`);
    } finally {
      setIssuingCreditNote(false);
    }
  };

  const generateAndSendCreditNote = async (order: Order, partialAmount?: number | null) => {
    console.log('[generateAndSendCreditNote] Starting credit note generation for order:', order.id);
    
    // Use partial amount if provided, otherwise use full order amount
    const totalAmount = typeof order.total_price === 'string' 
      ? parseFloat(order.total_price) 
      : (order.total_price || 0);
    const refundAmountValue = partialAmount !== null && partialAmount !== undefined 
      ? partialAmount 
      : totalAmount;
    
    console.log('[generateAndSendCreditNote] Refund amount:', refundAmountValue, 'of', totalAmount, `(${((refundAmountValue / totalAmount) * 100).toFixed(1)}%)`);
    
    // Authorization moved to backend - Edge function has access to SERVICE_ROLE_KEY natively
    console.log('[generateAndSendCreditNote] Calling Edge function - authorization handled on backend');

    // Get original invoice number (if exists)
    const originalInvoiceNumber = order.invoice_number || null;
    
    // Generate credit note number by replacing INV- prefix with CN- prefix
    // If invoice is INV-2026-5857, credit note will be CN-2026-5857
    let creditNoteNumber: string;
    if (originalInvoiceNumber && originalInvoiceNumber.startsWith('INV-')) {
      creditNoteNumber = originalInvoiceNumber.replace(/^INV-/, 'CN-');
      console.log('[generateAndSendCreditNote] Original invoice:', originalInvoiceNumber);
      console.log('[generateAndSendCreditNote] Credit note number (mirrored):', creditNoteNumber);
    } else {
      // Fallback: Generate new number if no invoice exists
      const year = new Date().getFullYear();
      const random = Math.floor(1000 + Math.random() * 9000);
      creditNoteNumber = `CN-${year}-${random}`;
      console.log('[generateAndSendCreditNote] No original invoice found, generating new credit note number:', creditNoteNumber);
    }

    // Get order items for credit note
    // Try order_items table first, but fallback to service_type from orders table if it doesn't exist
    let orderItemsData: any[] | null = null;
    
    try {
      const { data, error } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', order.id);
      
      if (!error && data && data.length > 0) {
        orderItemsData = data;
        console.log('[generateAndSendCreditNote] Found order_items:', orderItemsData.length, 'items');
      } else {
        console.log('[generateAndSendCreditNote] order_items table not found or empty, using service_type from orders table');
      }
    } catch (err: any) {
      console.warn('[generateAndSendCreditNote] order_items table may not exist:', err?.message);
      // Continue with fallback
    }

    // Calculate negative amounts (THE MIRROR LOGIC)
    // Use refundAmountValue from parameter, or full order amount if not specified
    const originalTotalAmount = typeof order.total_price === 'string' 
      ? parseFloat(order.total_price) 
      : (order.total_price || 0);
    
    // THE PRICE RESCUE: If total_price is 0 or missing, use window.prompt to request amount
    let refundAmountToUse = refundAmountValue !== null && refundAmountValue !== undefined 
      ? refundAmountValue 
      : originalTotalAmount;
    
    if (refundAmountToUse === 0 || isNaN(refundAmountToUse) || !refundAmountToUse) {
      console.warn('[generateAndSendCreditNote] Total price is ZERO or missing - requesting manual input');
      const manualAmount = window.prompt('Order price is 0. Enter refund amount:');
      if (!manualAmount || manualAmount.trim() === '') {
        toast.error('Refund amount is required');
        return;
      }
      const parsedAmount = parseFloat(manualAmount.trim());
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        toast.error('Please enter a valid amount greater than zero');
        return;
      }
      refundAmountToUse = parsedAmount;
    }
    
    // Transform all amounts to negative (mirror logic)
    const negativeTotalAmount = -Math.abs(refundAmountToUse);
    const vatRate = 0.20; // 20% VAT
    const negativeSubtotal = negativeTotalAmount / (1 + vatRate);
    const negativeTaxAmount = negativeTotalAmount - negativeSubtotal;
    
    console.log('[generateAndSendCreditNote] THE MIRROR LOGIC - Transformed amounts:', {
      originalTotal: originalTotalAmount,
      refundAmount: refundAmountToUse,
      negativeTotal: negativeTotalAmount,
      negativeSubtotal: negativeSubtotal,
      negativeTax: negativeTaxAmount,
    });
    
    // CRITICAL: Final validation - ensure totalAmount is NOT zero and is valid
    if (negativeTotalAmount === 0 || isNaN(negativeTotalAmount) || !isFinite(negativeTotalAmount)) {
      console.error('[generateAndSendCreditNote] CRITICAL ERROR: Calculated negative total is ZERO or invalid!', {
        negativeTotalAmount,
        refundAmountToUse,
        originalTotalAmount,
      });
      throw new Error('Cannot generate credit note: Calculated amount is zero or invalid. Please check order data.');
    }

    // Prepare items for credit note (with negative prices)
    // If order_items exists, use it; otherwise use service_type from orders table
    let items: Array<{ name: string; price: number; quantity: number }>;
    
    if (orderItemsData && orderItemsData.length > 0) {
      // DATA EXTRACTION FIX: If item prices are zero, calculate from total_price
      const itemsWithPrices = orderItemsData.map(item => {
        const itemPrice = typeof item.price === 'string' ? parseFloat(item.price) : (item.price || 0);
        // If item price is zero or missing, calculate from total
        const finalPrice = itemPrice > 0 ? itemPrice : (Math.abs(negativeTotalAmount) / orderItemsData.length);
        return {
          name: item.service_type || item.name || 'Service',
          price: -Math.abs(finalPrice), // Ensure negative
          quantity: item.quantity || 1
        };
      });
      
      // Verify sum matches negativeTotalAmount (allow small rounding differences)
      const itemsSum = itemsWithPrices.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const difference = Math.abs(itemsSum - negativeTotalAmount);
      
      if (difference > 0.01) {
        // Adjust prices proportionally to match total
        const adjustmentFactor = negativeTotalAmount / itemsSum;
        items = itemsWithPrices.map(item => ({
          ...item,
          price: item.price * adjustmentFactor
        }));
        console.log('[generateAndSendCreditNote] Adjusted item prices to match total:', { itemsSum, negativeTotalAmount, adjustmentFactor });
      } else {
        items = itemsWithPrices;
      }
    } else {
      // Fallback: Use service_type from orders table
      // service_type can be an array or comma-separated string
      const serviceTypes = Array.isArray(order.service_type) 
        ? order.service_type 
        : (typeof order.service_type === 'string' ? order.service_type.split(',').map(s => s.trim()) : []);
      
      if (serviceTypes.length > 0) {
        const pricePerService = negativeTotalAmount / serviceTypes.length;
        items = serviceTypes.map(serviceName => ({
          name: serviceName.replace(/[\[\]"]/g, '').trim() || 'ECU Tuning Service',
          price: pricePerService,
          quantity: 1
        }));
      } else {
        // FALLBACK: Create artificial item if order_items doesn't exist
        // Single item with full negative amount
        items = [{
          name: `Refund of Order ${order.order_number || order.id.slice(0, 8)}`,
          price: negativeTotalAmount, // Already negative
          quantity: 1
        }];
        console.log('[generateAndSendCreditNote] Using fallback artificial item:', items[0]);
      }
    }
    
    // CRITICAL: Verify no zero prices
    const hasZeroPrice = items.some(item => item.price === 0 || Math.abs(item.price) < 0.01);
    if (hasZeroPrice) {
      console.error('[generateAndSendCreditNote] CRITICAL ERROR: Found zero prices in items!', items);
      throw new Error('Cannot generate credit note: Found zero prices in items. Please check order data.');
    }
    
    console.log('[generateAndSendCreditNote] Prepared items for credit note:', items);
    console.log('[generateAndSendCreditNote] Items total sum:', items.reduce((sum, item) => sum + (item.price * item.quantity), 0));

    // Call generate-invoice function with documentType: 'CREDIT_NOTE' and transformed data
    const requestPayload = {
      orderId: order.id,
      orderNumber: order.order_number || '',
      customerName: order.customer_name || 'Customer',
      customerEmail: order.customer_email,
      items: items,
      totalAmount: negativeTotalAmount, // Negative total (multiplied by -1)
      subtotal: negativeSubtotal, // Negative subtotal (multiplied by -1)
      taxAmount: negativeTaxAmount, // Negative tax (multiplied by -1)
      brand: order.car_brand || order.brand,
      model: order.car_model || order.model,
      fuelType: order.fuel_type,
      year: order.year,
      ecuType: order.ecu_type,
      vin: order.vin,
      documentType: 'CREDIT_NOTE' as const, // Explicit document type parameter
      creditNote: true, // Legacy flag for backward compatibility
      originalInvoiceNumber: originalInvoiceNumber,
      creditNoteNumber: creditNoteNumber,
      refundAmount: negativeTotalAmount, // Store as negative for dashboard calculation
      refundReason: refundReason,
      refundIban: refundIban,
      taxPointDate: taxPointDate,
    };
    
    console.log('[generateAndSendCreditNote] Calling Edge function - backend handles authorization and DB updates');
    
    // Use supabase.functions.invoke - backend handles all authorization and DB updates
    const { data: invoiceData, error: invoiceError } = await supabase.functions.invoke('generate-invoice', {
      body: requestPayload,
    });

    if (invoiceError) {
      console.error('[generateAndSendCreditNote] Invoice generation failed:', invoiceError);
      throw new Error(`Invoice generation failed: ${invoiceError.message}`);
    }

    console.log('[generateAndSendCreditNote] Credit note generated successfully - backend handled DB update');
    
    // Simple response handling - backend already updated the database
    // Just refresh the orders list to show updated data
    await fetchOrders();
    
    toast.success(`Credit Note ${creditNoteNumber} generated and sent to customer. Balance adjusted.`);
  };

  const handleFieldChange = (orderId: string, field: 'checksum_crc' | 'internal_note', value: string) => {
    setEditingFields(prev => ({
      ...prev,
      [orderId]: {
        checksum_crc: prev[orderId]?.checksum_crc ?? orders.find(o => o.id === orderId)?.checksum_crc ?? '',
        internal_note: prev[orderId]?.internal_note ?? orders.find(o => o.id === orderId)?.internal_note ?? '',
        [field]: value
      }
    }));
  };

  const handleFieldBlur = async (orderId: string, field: 'checksum_crc' | 'internal_note') => {
    const order = orders.find(o => o.id === orderId);
    const editedValue = editingFields[orderId]?.[field];
    const originalValue = order?.[field] ?? '';
    
    // Only save if value actually changed
    if (editedValue === undefined || editedValue === originalValue) return;
    
    setSavingId(orderId);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ [field]: editedValue || null })
        .eq('id', orderId);

      if (error) throw error;
      toast.success(`${field === 'checksum_crc' ? 'Checksum CRC' : 'Internal Note'} saved`);
      await fetchOrders();
      // Clear the editing state for this order
      setEditingFields(prev => {
        const newState = { ...prev };
        delete newState[orderId];
        return newState;
      });
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to save field');
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveFields = async (orderId: string) => {
    const fields = editingFields[orderId];
    if (!fields) return;

    setSavingId(orderId);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          checksum_crc: fields.checksum_crc || null,
          internal_note: fields.internal_note || null
        })
        .eq('id', orderId);

      if (error) throw error;
      toast.success('Admin fields saved');
      await fetchOrders();
      // Clear the editing state
      setEditingFields(prev => {
        const newState = { ...prev };
        delete newState[orderId];
        return newState;
      });
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to save fields');
    } finally {
      setSavingId(null);
    }
  };

  const getEditableValue = (order: Order, field: 'checksum_crc' | 'internal_note') => {
    if (editingFields[order.id]?.[field] !== undefined) {
      return editingFields[order.id][field];
    }
    return order[field] || '';
  };

  // Sanitize text input - remove potentially harmful HTML/JS
  const sanitizeText = (text: string): string => {
    return text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<[^>]+>/g, '') // Remove all HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  };

  const [savedImportantNote, setSavedImportantNote] = useState<string | null>(null);

  const handleSaveImportantNote = async (orderId: string) => {
    if (!importantNote.trim() && !detailOrder?.important_note) {
      toast.warning('Please enter a message or delete existing one');
      return;
    }

    setSavingImportantNote(orderId);
    try {
      const sanitizedNote = importantNote.trim() ? sanitizeText(importantNote) : null;
      
      const { error } = await supabase
        .from('orders')
        .update({ important_note: sanitizedNote })
        .eq('id', orderId);

      if (error) throw error;
      
      toast.success('Important message saved');
      
      // Refresh orders to get latest data
      await fetchOrders();
      
      // Update detailOrder if it's currently open - keep the saved value
      if (detailOrder?.id === orderId) {
        setDetailOrder(prev => prev ? { ...prev, important_note: sanitizedNote } : null);
        // Keep the text in textarea (don't clear it)
        // The textarea will show the saved value
        setSavedImportantNote(sanitizedNote);
        // Reset saved state after 2 seconds to show normal state again
        setTimeout(() => {
          setSavedImportantNote(null);
        }, 2000);
      }
    } catch (error) {
      console.error('Save important note error:', error);
      toast.error('Failed to save important message');
    } finally {
      setSavingImportantNote(null);
    }
  };

  const handleResultUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedOrderId) return;

    const orderId = selectedOrderId; // Store in local variable for clarity
    
    // Strict Upload Lock: Check if invoice already exists
    const order = orders.find(o => o.id === orderId);
    if (order?.invoice_number) {
      console.warn('[handleResultUpload] Invoice already sent for order:', orderId, 'Invoice:', order.invoice_number);
      toast.warning('Faktúra už bola odoslaná pre túto objednávku');
      if (e.target) {
        e.target.value = '';
      }
      return;
    }
    
    // Prevent multiple uploads - set uploading state immediately
    if (uploadingId === orderId) {
      console.warn('[handleResultUpload] Upload already in progress for order:', orderId);
      return;
    }
    
    setUploadingId(orderId);
    
    // Reset file input to allow same file selection again
    if (e.target) {
      e.target.value = '';
    }
    
    try {
      // Step 1: Upload file to storage
      const fileName = `result-${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('modified-files')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('modified-files')
        .getPublicUrl(fileName);

      // CRITICAL: Check if order is cancelled - if so, abort invoice generation
      const currentOrder = orders.find(o => o.id === orderId);
      if (currentOrder?.status === 'cancelled') {
        console.warn('[handleResultUpload] Order is CANCELLED - aborting invoice generation');
        toast.error('Cannot upload result file for cancelled order');
        setUploadingId(null);
        return;
      }
      
      // Step 2: Update status to 'completed' FIRST (Status First)
      console.log('[handleResultUpload] Step 1: Updating status to completed for orderId:', orderId);
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          result_file_url: publicUrl,
          status: 'completed',
        })
        .eq('id', orderId);

      if (updateError) {
        console.error('[handleResultUpload] Status update failed:', updateError);
        throw updateError;
      }
      
      console.log('[handleResultUpload] Status updated - orderId:', orderId);
      
      // Update local state immediately
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'completed', result_file_url: publicUrl } : o));

      // Step 3: Get order data for email
      const order = orders.find(o => o.id === orderId);
      if (!order) {
        console.error('[handleResultUpload] Order not found in local state, fetching...');
        // Fetch order from DB if not in local state
        const { data: fetchedOrder } = await supabase
          .from('orders')
          .select('*')
          .eq('id', orderId)
          .single();
        
        if (!fetchedOrder) {
          throw new Error('Order not found after status update');
        }
        
        // Use fetched order
        const finalOrder = fetchedOrder as Order;
        
        // Step 4: Send email notification (Email Second)
        if (finalOrder.customer_email) {
          try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://kivqvwdfujsnuwfxjtcz.supabase.co';
            const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
            
            console.log('[handleResultUpload] Step 2: Sending order-ready email for orderId:', orderId);
            console.log('[handleResultUpload] Email data:', {
              orderId: finalOrder.id,
              orderNumber: finalOrder.order_number,
              customerEmail: finalOrder.customer_email,
              resultFileUrl: publicUrl,
            });
            
            const response = await fetch(`${supabaseUrl}/functions/v1/order-ready`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${anonKey}`,
              },
              body: JSON.stringify({
                orderId: finalOrder.id,
                orderNumber: finalOrder.order_number || '',
                customerEmail: finalOrder.customer_email,
                customerName: finalOrder.customer_name || '',
                carBrand: finalOrder.car_brand || '',
                carModel: finalOrder.car_model || '',
                resultFileUrl: publicUrl,
                importantNote: finalOrder.important_note || null,
              }),
            });

            const responseData = await response.json();
            console.log('[handleResultUpload] Email sent - response:', response.status, responseData);

            if (!response.ok || responseData.success === false) {
              console.error('[handleResultUpload] Email notification failed:', {
                status: response.status,
                error: responseData.error,
                details: responseData.details,
              });
              toast.success('Result file uploaded! (Email notification failed)');
            } else {
              console.log('[handleResultUpload] Email sent successfully');
              toast.success('Result file uploaded and customer notified via email!');
            }
          } catch (emailError) {
            console.error('[handleResultUpload] Email notification error:', emailError);
            toast.success('Result file uploaded! (Email notification failed)');
          }
        } else {
          console.warn('[handleResultUpload] No customer email found for order:', orderId);
          toast.success('Result file uploaded and status updated to completed');
        }

        // Step 5: Generate invoice asynchronously (Invoice at the end, async, non-blocking)
        // This runs in separate try-catch and doesn't block previous steps
        // Upload -> Status Completed -> Invoice
        (async () => {
          try {
            console.log('[handleResultUpload] Step 3: Invoice started - generating invoice for orderId:', orderId);
            
            const { data: invoiceData, error: invoiceError } = await supabase.functions.invoke('generate-invoice', {
              body: {
                orderId: finalOrder.id,
                orderNumber: finalOrder.order_number || '',
                customerName: finalOrder.customer_name || 'Customer',
                customerEmail: finalOrder.customer_email,
                items: [{
                  name: 'ECU Tuning Service',
                  price: parseFloat(finalOrder.total_price?.toString() || '0'),
                }],
                totalAmount: parseFloat(finalOrder.total_price?.toString() || '0'),
                brand: finalOrder.car_brand || undefined,
                model: finalOrder.car_model || undefined,
                fuelType: finalOrder.fuel_type || undefined,
                year: finalOrder.year ? parseInt(finalOrder.year.toString()) : undefined,
                ecuType: finalOrder.ecu_type || undefined,
                vin: finalOrder.vin || undefined,
              },
            });

            console.log('[handleResultUpload] Invoice generation response:', invoiceData, invoiceError);

            if (invoiceError || !invoiceData || invoiceData.success === false) {
              console.error('[handleResultUpload] Invoice generation failed (non-fatal):', {
                error: invoiceError,
                data: invoiceData,
              });
            } else {
              console.log('[handleResultUpload] Invoice generated and sent successfully');
              // Strict Upload Lock: Update local state with invoice number to permanently lock the button
              if (invoiceData.invoiceNumber) {
                setOrders(prev => prev.map(o => 
                  o.id === finalOrder.id 
                    ? { ...o, invoice_number: invoiceData.invoiceNumber, invoice_url: invoiceData.invoiceUrl || null }
                    : o
                ));
              }
            }
          } catch (invoiceError) {
            console.error('[handleResultUpload] Invoice generation error (non-fatal):', invoiceError);
            // Non-fatal - invoice can be generated later, status and email are already done
          }
        })();
      } else {
        // Order found in local state
        if (order.customer_email) {
          try {
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://kivqvwdfujsnuwfxjtcz.supabase.co';
            const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
            
            console.log('[handleResultUpload] Step 2: Sending order-ready email for orderId:', orderId);
            console.log('[handleResultUpload] Email data:', {
              orderId: order.id,
              orderNumber: order.order_number,
              customerEmail: order.customer_email,
              resultFileUrl: publicUrl,
            });
            
            const response = await fetch(`${supabaseUrl}/functions/v1/order-ready`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${anonKey}`,
              },
              body: JSON.stringify({
                orderId: order.id,
                orderNumber: order.order_number || '',
                customerEmail: order.customer_email,
                customerName: order.customer_name || '',
                carBrand: order.car_brand || '',
                carModel: order.car_model || '',
                resultFileUrl: publicUrl,
                importantNote: order.important_note || null,
              }),
            });

            const responseData = await response.json();
            console.log('[handleResultUpload] Email sent - response:', response.status, responseData);

            if (!response.ok || responseData.success === false) {
              console.error('[handleResultUpload] Email notification failed:', {
                status: response.status,
                error: responseData.error,
                details: responseData.details,
              });
              toast.success('Result file uploaded! (Email notification failed)');
            } else {
              console.log('[handleResultUpload] Email sent successfully');
              toast.success('Result file uploaded and customer notified via email!');
            }
          } catch (emailError) {
            console.error('[handleResultUpload] Email notification error:', emailError);
            toast.success('Result file uploaded! (Email notification failed)');
          }
        } else {
          console.warn('[handleResultUpload] No customer email found for order:', orderId);
          toast.success('Result file uploaded and status updated to completed');
        }

        // Step 5: Generate invoice asynchronously (Invoice at the end, async, non-blocking)
        // Upload -> Status Completed -> Invoice
        (async () => {
          try {
            console.log('[handleResultUpload] Step 3: Invoice started - generating invoice for orderId:', orderId);
            
            const { data: invoiceData, error: invoiceError } = await supabase.functions.invoke('generate-invoice', {
              body: {
                orderId: order.id,
                orderNumber: order.order_number || '',
                customerName: order.customer_name || 'Customer',
                customerEmail: order.customer_email,
                items: [{
                  name: 'ECU Tuning Service',
                  price: parseFloat(order.total_price?.toString() || '0'),
                }],
                totalAmount: parseFloat(order.total_price?.toString() || '0'),
                brand: order.car_brand || undefined,
                model: order.car_model || undefined,
                fuelType: order.fuel_type || undefined,
                year: order.year ? parseInt(order.year.toString()) : undefined,
                ecuType: order.ecu_type || undefined,
                vin: order.vin || undefined,
              },
            });

            console.log('[handleResultUpload] Invoice generation response:', invoiceData, invoiceError);

            if (invoiceError || !invoiceData || invoiceData.success === false) {
              console.error('[handleResultUpload] Invoice generation failed (non-fatal):', {
                error: invoiceError,
                data: invoiceData,
              });
            } else {
              console.log('[handleResultUpload] Invoice generated and sent successfully');
              // Strict Upload Lock: Update local state with invoice number to permanently lock the button
              if (invoiceData.invoiceNumber) {
                setOrders(prev => prev.map(o => 
                  o.id === order.id 
                    ? { ...o, invoice_number: invoiceData.invoiceNumber, invoice_url: invoiceData.invoiceUrl || null }
                    : o
                ));
              }
            }
          } catch (invoiceError) {
            console.error('[handleResultUpload] Invoice generation error (non-fatal):', invoiceError);
            // Non-fatal - invoice can be generated later, status and email are already done
          }
        })();
      }
      
      fetchOrders();
      
      // On success: Keep button disabled (upload completed, no need to reset)
      // The button will be hidden/replaced when order status changes to 'completed'
      // Only reset on error to allow retry
    } catch (error) {
      console.error('[handleResultUpload] Upload error:', error);
      toast.error('Failed to upload result file');
      // Only reset on error to allow retry
      setUploadingId(null);
      setSelectedOrderId(null);
    }
  };

  const triggerUpload = (orderId: string) => {
    setSelectedOrderId(orderId);
    fileInputRef.current?.click();
  };

  const handleDownload = async (fileName: string, orderNumber: string, orderId: string) => {
    try {
      // Create Public URL from file name
      const { data: { publicUrl } } = supabase.storage
        .from('tunes')
        .getPublicUrl(fileName);

      if (!publicUrl) {
        toast.error('Nepodarilo sa vytvoriť URL pre sťahovanie');
        return;
      }

      // Force download for Supabase Storage URLs
      try {
        const response = await fetch(publicUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `order-${orderNumber || 'file'}-${fileName}`;
        document.body.appendChild(a);
        a.click();
        
        // Nekompromisný Update: Ihned po a.click() prepíš status na 'processing'
        console.log('Sťahujem a prepínam ID:', orderId);
        
        // 1. Zápis do databázy
        const { error: updateError } = await supabase
          .from('orders')
          .update({ status: 'processing' })
          .eq('id', orderId);
        if (updateError) console.error('DB UPDATE ERROR:', updateError);
        
        // 2. Okamžitá zmena v UI tabuľke
        setOrders(currentOrders => 
          currentOrders.map(o => o.id === orderId ? { ...o, status: 'processing' } : o)
        );
        
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (err) {
        console.error('Download error:', err);
        // Fallback: open in new tab
        window.open(publicUrl, '_blank');
      }
    } catch (error) {
      console.error('Error creating download URL:', error);
      toast.error('Chyba pri sťahovaní súboru');
    }
  };

  const filteredOrders = orders.filter((order) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      (order.order_number || '').toLowerCase().includes(searchLower) ||
      (order.customer_name || '').toLowerCase().includes(searchLower) ||
      (order.customer_email || '').toLowerCase().includes(searchLower) ||
      (order.car_brand || '').toLowerCase().includes(searchLower) ||
      (order.car_model || '').toLowerCase().includes(searchLower);
    
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const STATUS_TEXT_COLOR: Record<string, string> = {
    all: '#e5e7eb',
    paid: '#22c55e',
    pending: '#facc15',
    processing: '#06b6d4',
    completed: '#22c55e',
    cancelled: '#ef4444',
  };

  const STATUS_CELL_CLASS: Record<string, string> = {
    pending: 'text-yellow-400 bg-yellow-500/20 shadow-[inset_0_0_0_1px_rgba(250,204,21,0.55)]',
    processing: 'text-cyan-300 bg-cyan-500/20 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.6)]',
    completed: 'text-green-400 bg-green-500/20 shadow-[inset_0_0_0_1px_rgba(74,222,128,0.55)]',
    paid: 'text-green-400 bg-green-500/20 shadow-[inset_0_0_0_1px_rgba(74,222,128,0.55)]',
    cancelled: 'text-red-400 bg-red-500/20 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.6)]',
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'paid':
        return 'status-paid';
      case 'pending':
        return 'status-pending';
      case 'processing':
        return 'status-processing';
      case 'completed':
        return 'status-completed';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-pending';
    }
  };

  // Helper function to get display amount (negative for cancelled orders)
  const getDisplayAmount = (order: Order) => {
    const amount = parseFloat(order.total_price?.toString() || '0');
    if (order.status === 'cancelled') {
      return -Math.abs(amount); // Ensure negative for cancelled
    }
    return amount;
  };

const getServiceNames = (serviceIds: string[] | string | null) => {
    if (!serviceIds) return '';
    if (Array.isArray(serviceIds)) {
      return serviceIds.map((id: string) => SERVICES.find((s) => s.id === id)?.name || id).filter(Boolean).join(', ');
    }
    // Try to parse as JSON, otherwise treat as plain text
    try {
      const ids = JSON.parse(serviceIds);
      return ids.map((id: string) => SERVICES.find((s) => s.id === id)?.name || id).filter(Boolean).join(', ');
    } catch {
      // Already a plain text service name(s), return as-is
      return serviceIds;
    }
  };

  const formatLocalDateTime = (utcDateString: string) => {
    const date = new Date(utcDateString);
    return date.toLocaleString('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Fetch activity logs when detail order changes
  useEffect(() => {
    if (detailOrder?.id) {
      fetchActivityLogs(detailOrder.id);
    } else {
      setActivityLogs([]);
    }
  }, [detailOrder?.id]);

  // Show loading while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Kontrola prístupu...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleResultUpload}
        accept=".bin,.ori,.mod,.ecu"
      />

      <div className="max-w-[1600px] mx-auto w-full px-4 flex flex-col min-h-screen">
      {/* Header */}
      <header className="w-full border-b border-border/50 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6 shrink-0">
            <Link to="/" aria-label="REMAPPRO" className="inline-flex items-center gap-2 shrink-0 no-underline antialiased leading-none">
              <span className="inline-flex items-center justify-center h-9 px-3 rounded-full border border-cyan-400/60 bg-transparent shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                <span className="text-2xl font-black leading-none tracking-tight text-cyan-400">R</span>
                <span className="text-2xl font-black leading-none tracking-tight text-white">P</span>
              </span>
              <span className="text-2xl font-semibold leading-none tracking-normal text-cyan-400">REMAPPRO</span>
            </Link>
            <SystemStatus />
          </div>
          <div className="flex flex-nowrap items-center justify-end gap-3">
            <div className="relative w-72 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Hľadať objednávky..."
                className="h-[42px] w-full rounded-xl border border-primary/50 bg-transparent py-2 pl-9 pr-4 text-base leading-6 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="admin-filter-select w-40 shrink-0 py-2 px-4 text-base font-normal text-left rounded-lg border border-teal-500/30 bg-teal-950/40 shadow-none"
              style={{ color: STATUS_TEXT_COLOR[statusFilter] || STATUS_TEXT_COLOR.all }}
            >
              <option value="all" style={{ color: STATUS_TEXT_COLOR.all, backgroundColor: '#050505', fontSize: '16px' }}>Všetky</option>
              <option value="paid" style={{ color: STATUS_TEXT_COLOR.paid, backgroundColor: '#050505', fontSize: '16px' }}>Zaplatené</option>
              <option value="pending" style={{ color: STATUS_TEXT_COLOR.pending, backgroundColor: '#050505', fontSize: '16px' }}>Čakajúce</option>
              <option value="processing" style={{ color: STATUS_TEXT_COLOR.processing, backgroundColor: '#050505', fontSize: '16px' }}>V Procese</option>
              <option value="completed" style={{ color: STATUS_TEXT_COLOR.completed, backgroundColor: '#050505', fontSize: '16px' }}>Dokončené</option>
              <option value="cancelled" style={{ color: STATUS_TEXT_COLOR.cancelled, backgroundColor: '#050505', fontSize: '16px' }}>Zrušené</option>
            </select>
            <button
              onClick={cycleStatusMode}
              disabled={statusLoading}
              className={`py-2 px-4 flex items-center gap-2 rounded-lg border transition-all disabled:opacity-50 ${
                statusMode === 'online'
                  ? 'bg-green-500/20 border-green-500/50 text-green-400 hover:bg-green-500/30'
                  : statusMode === 'offline'
                    ? 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30'
                    : 'bg-primary/20 border-primary/50 text-primary hover:bg-primary/30'
              }`}
            >
              <Power className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`} />
              {statusLoading ? 'Updating...' : statusMode === 'online' ? 'Force ONLINE' : statusMode === 'offline' ? 'Force OFFLINE' : 'Auto (Schedule)'}
            </button>
            <button onClick={fetchOrders} className="btn-secondary py-2 px-4 flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button 
              onClick={handleLogout}
              className="btn-secondary py-2 px-4 flex items-center gap-2 hover:bg-red-500/20 hover:border-red-500/50 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Odhlásiť sa
            </button>
          </div>
        </div>
      </header>

      <div className="w-full flex-grow pt-3">
        <div className="mb-3 w-full grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="rounded-none p-3 bg-[#0f172a] border-t-4 border-t-cyan-400 shadow-[inset_0_0_28px_rgba(34,211,238,0.14)]">
            <p className="uppercase text-sm text-white font-extrabold tracking-wide">Celkové tržby</p>
            <p className="text-4xl font-black text-cyan-400 mt-1 leading-none">
              {(financialStats?.grossRevenue ?? 0).toFixed(2)} €
            </p>
          </div>
          <div className="rounded-none p-3 bg-[#0f172a] border-t-4 border-t-emerald-500 shadow-[inset_0_0_28px_rgba(16,185,129,0.14)]">
            <p className="uppercase text-sm text-white font-extrabold tracking-wide">Čistý zisk</p>
            <p className="text-4xl font-black text-emerald-400 mt-1 leading-none">
              {(financialStats?.netRevenue ?? 0).toFixed(2)} €
            </p>
          </div>
          <div className="rounded-none p-3 bg-[#0f172a] border-t-4 border-t-violet-500 shadow-[inset_0_0_28px_rgba(139,92,246,0.16)]">
            <p className="uppercase text-sm text-white font-extrabold tracking-wide">Dobropisy</p>
            <p className="text-4xl font-black text-violet-400 mt-1 leading-none">
              -{Math.abs(financialStats?.refunds ?? 0).toFixed(2)} €
            </p>
          </div>
          <div className="rounded-none p-3 bg-[#0f172a] border-t-4 border-t-yellow-500 shadow-[inset_0_0_28px_rgba(234,179,8,0.16)]">
            <p className="uppercase text-sm text-white font-extrabold tracking-wide">Čakajúce</p>
            <p className="text-4xl font-black text-yellow-400 mt-1 leading-none">
              {orders.filter((o) => o.status === 'pending').length}
            </p>
          </div>
          <div className="rounded-none p-3 bg-[#0f172a] border-t-4 border-t-red-500 shadow-[inset_0_0_28px_rgba(239,68,68,0.14)]">
            <p className="uppercase text-sm text-white font-extrabold tracking-wide">Zrušené</p>
            <p className="text-4xl font-black text-red-400 mt-1 leading-none">
              {orders.filter((o) => o.status === 'cancelled').length}
            </p>
          </div>
        </div>

        {/* Orders Table */}
        <div className="h-fit w-full shrink-0 rounded-xl bg-background/40 backdrop-blur-xl border border-primary/20 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
          <div className="overflow-x-auto">
            <table className="w-full text-base border-collapse">
              <thead className="sticky top-0 z-50">
                <tr className="bg-[#0a192f] border-b border-primary/30 shadow-md">
                  <th className="text-left p-2.5 border-r border-slate-500 text-sm font-bold uppercase tracking-wide align-middle text-white whitespace-nowrap">Faktúra</th>
                  <th className="text-left p-2.5 border-r border-slate-500 text-sm font-bold uppercase tracking-wide align-middle text-white whitespace-nowrap min-w-[12rem]">ID</th>
                  <th className="text-left p-2.5 border-r border-slate-500 text-sm font-bold uppercase tracking-wide align-middle text-white whitespace-nowrap">Dátum</th>
                  <th className="text-left p-2.5 border-r border-slate-500 text-sm font-bold uppercase tracking-wide align-middle text-white w-full min-w-[320px]">Zákazník</th>
                  <th className="text-center p-4 border-r border-slate-500 text-sm font-bold uppercase tracking-wide align-middle text-white whitespace-nowrap min-w-[8.5rem]">Cena</th>
                  <th className="text-center p-2.5 border-r border-slate-500 text-sm font-bold uppercase tracking-wide align-middle text-white whitespace-nowrap min-w-[9.5rem]">Stav</th>
                  <th className="text-center p-2.5 border-r border-slate-500 text-sm font-bold uppercase tracking-wide align-middle text-white whitespace-nowrap sticky right-0 bg-[#0a192f] z-10 min-w-[260px]">Akcie</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                <tr>
                      <td colSpan={7} className="text-center py-12 text-muted-foreground">
                        Načítavam objednávky...
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-12 text-muted-foreground">
                        Žiadne objednávky
                      </td>
                    </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const active = activeRowId === order.id;
                    const cell = (edge: 'first' | 'mid' | 'last' | 'fill') => {
                      const selected = active && edge !== 'last' ? 'bg-slate-800/40' : '';
                      return `px-4 py-2 align-middle border-r border-slate-800/60 ${selected}`;
                    };
                    const actionCell = 'w-12 flex-1 min-h-[48px] inline-flex items-center justify-center border-l border-slate-700/50 rounded-none bg-cyan-950/30 transition-all duration-200';
                    const documents: { number: string; href: string; title: string }[] = [];
                    if (order.invoice_number) {
                      documents.push({ number: order.invoice_number, href: order.invoice_url || '#', title: 'Zobraziť faktúru' });
                    }
                    if (order.credit_note_number) {
                      documents.push({ number: order.credit_note_number, href: order.credit_note_pdf || '#', title: 'Stiahnuť dobropis' });
                    }
                    return (
                    <tr
                      key={order.id}
                      onClick={() => setActiveRowId(order.id)}
                      className="align-middle border-b border-slate-800/60 cursor-pointer"
                    >
                      <td className={`${cell('first')} whitespace-nowrap`}>
                        {documents.length === 0 ? (
                          <span className="text-base text-slate-500">—</span>
                        ) : (
                          <div className="flex flex-col items-start gap-0.5">
                            {documents.map((doc) => (
                              <a
                                key={doc.number}
                                href={doc.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-base font-bold text-red-500 hover:text-red-400 whitespace-nowrap"
                                title={doc.title}
                              >
                                {doc.number}
                              </a>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className={`${cell('mid')} whitespace-nowrap min-w-[12rem]`}>
                        <span className="font-mono text-lg font-bold leading-none text-cyan-300 whitespace-nowrap">
                          {order.order_number || order.id.slice(0, 6).toUpperCase()}
                        </span>
                      </td>
                      <td className={`${cell('mid')} whitespace-nowrap`}>
                        <p className="text-base font-medium leading-none text-white whitespace-nowrap">
                          {formatLocalDateTime(order.created_at)}
                        </p>
                      </td>
                      <td className={`${cell('mid')} w-full min-w-[320px]`}>
                        <div>
                          <p className="whitespace-nowrap text-lg font-bold leading-none text-cyan-400" title={order.customer_name}>{order.customer_name}</p>
                          <p className="whitespace-nowrap text-xs leading-none text-white" title={order.customer_email}>{order.customer_email}</p>
                        </div>
                      </td>
                      <td className={`min-w-[8.5rem] whitespace-nowrap border-r border-slate-800/60 p-4 text-center align-middle ${active ? 'bg-slate-800/40' : ''}`}>
                        <p className={`flex items-center justify-center text-xl font-bold leading-none ${
                          order.status === 'cancelled' 
                            ? 'text-red-500' 
                            : 'text-primary'
                        }`}>
                          {getDisplayAmount(order).toFixed(2)}€
                        </p>
                      </td>
                      <td className={`h-px min-w-[9.5rem] whitespace-nowrap border-r border-slate-800/60 p-0 text-center ${active ? 'bg-slate-800/40' : ''}`}>
                        <select
                          value={order.status}
                          onChange={(e) => handleStatusChange(order.id, e.target.value)}
                          className={`status-cell-select flex h-full min-h-[48px] w-full cursor-pointer appearance-none items-center justify-center border-0 px-4 text-center font-bold outline-none ${STATUS_CELL_CLASS[order.status] || STATUS_CELL_CLASS.pending}`}
                        >
                          <option value="pending" style={{ color: STATUS_TEXT_COLOR.pending, backgroundColor: '#050505' }}>Čakajúce</option>
                          <option value="processing" style={{ color: STATUS_TEXT_COLOR.processing, backgroundColor: '#050505' }}>V Procese</option>
                          <option value="completed" style={{ color: STATUS_TEXT_COLOR.completed, backgroundColor: '#050505' }}>Dokončené</option>
                          <option value="cancelled" style={{ color: STATUS_TEXT_COLOR.cancelled, backgroundColor: '#050505' }}>Zrušené</option>
                        </select>
                      </td>
                      <td className="sticky right-0 z-10 h-px border-r border-slate-800/60 bg-[#070d16] p-0">
                        <div className="flex h-full items-stretch justify-end gap-0 p-0">
                          {order.file_url ? (
                            <button
                              onClick={() => handleDownload(order.file_url!, order.order_number || order.id.slice(0, 8), order.id)}
                              className={`${actionCell} text-yellow-500 hover:bg-yellow-500/20 hover:border-yellow-500/40`}
                              title="Stiahnuť súbor zákazníka"
                            >
                              <Download className="w-5 h-5" />
                            </button>
                          ) : (
                            <span className={`${actionCell} text-slate-600 cursor-not-allowed`} title="Súbor nie je k dispozícii">
                              <Download className="w-5 h-5" />
                            </span>
                          )}
                          {order.status === 'completed' || order.result_file_url ? (
                            <span className={`${actionCell} text-emerald-500 hover:bg-emerald-500/20 hover:border-emerald-500/40`} title="Hotový súbor je nahraný">
                              <CheckCircle className="w-5 h-5" />
                            </span>
                          ) : order.invoice_number ? (
                            <span className={`${actionCell} text-slate-500 cursor-not-allowed`} title="Súbor odoslaný">
                              <CheckCircle className="w-5 h-5" />
                            </span>
                          ) : (
                            <button
                              onClick={() => triggerUpload(order.id)}
                              disabled={uploadingId === order.id}
                              className={`${actionCell} ${
                                uploadingId === order.id
                                  ? 'text-slate-500 cursor-not-allowed'
                                  : 'text-emerald-500 hover:bg-emerald-500/20 hover:border-emerald-500/40'
                              }`}
                              title={uploadingId === order.id ? 'Odosielam...' : 'Nahrať hotový súbor'}
                            >
                              <Upload className={`w-5 h-5 ${uploadingId === order.id ? 'animate-pulse' : ''}`} />
                            </button>
                          )}
                          <button
                            onClick={() => setDetailOrder(order)}
                            className={`${actionCell} text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/40`}
                            title="Zobraziť detail objednávky"
                          >
                            <FileText className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => order.status !== 'cancelled' && openRefundModal(order)}
                            disabled={order.status === 'cancelled'}
                            className={
                              order.status === 'cancelled'
                                ? `${actionCell} cursor-not-allowed text-slate-600`
                                : `${actionCell} text-red-500 hover:bg-red-500/20 hover:border-red-500/40`
                            }
                            title="Vystaviť dobropis"
                          >
                            <RotateCcw className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              toast.info(
                                `Delete pre ${order.order_number || order.id.slice(0, 8).toUpperCase()} je pripravené na CRUD napojenie.`
                              )
                            }
                            className={`${actionCell} text-red-500 hover:bg-red-500/20 hover:border-red-500/40`}
                            title="Zmazať objednávku"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Order Detail Modal */}
        {detailOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="max-w-5xl w-full max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-xl border border-[rgba(0,242,255,0.4)] bg-[#070b10] shadow-[0_0_28px_rgba(0,242,255,0.16)]">
              <div className="p-2">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
                    <FileText className="w-6 h-6 text-primary" />
                    Detail objednávky
                  </h2>
                  <button
                    onClick={() => setDetailOrder(null)}
                    className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors duration-200 hover:bg-red-500/15 hover:text-red-500"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid min-w-0 grid-cols-1 items-start gap-2 lg:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                        Základné informácie
                      </h3>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div>
                          <p className="text-sm text-muted-foreground">ID objednávky</p>
                          <p className="break-all font-mono font-semibold text-primary">{detailOrder.order_number || detailOrder.id.slice(0, 8).toUpperCase()}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Dátum vytvorenia</p>
                          <p className="break-words text-foreground">{formatLocalDateTime(detailOrder.created_at)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Stav</p>
                          <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold ${getStatusClass(detailOrder.status)}`}>
                            {detailOrder.status === 'pending' ? 'Čakajúce' : detailOrder.status === 'processing' ? 'V Procese' : detailOrder.status === 'completed' ? 'Dokončené' : detailOrder.status === 'cancelled' ? 'Zrušené' : detailOrder.status === 'paid' ? 'Zaplatené' : detailOrder.status}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Celková cena</p>
                          <p className={`text-xl font-bold ${
                            detailOrder.status === 'cancelled'
                              ? 'text-red-500'
                              : 'text-primary'
                          }`}>
                            {getDisplayAmount(detailOrder).toFixed(2)}€
                          </p>
                        </div>
                      </div>
                    </section>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                        Vozidlo
                      </h3>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div>
                          <p className="text-sm text-muted-foreground">Značka / Model</p>
                          <p className="break-words font-medium text-foreground">{detailOrder.car_brand || 'Nezadané'} {detailOrder.car_model || ''}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Palivo</p>
                          <p className="break-words text-foreground">{detailOrder.fuel_type || '—'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Rok výroby</p>
                          <p className="break-words text-foreground">{detailOrder.year ? detailOrder.year.toString() : '—'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Typ ECU</p>
                          <p className="break-words text-foreground">{detailOrder.ecu_type || '—'}</p>
                        </div>
                      </div>
                    </section>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                        Poznámka zákazníka
                      </h3>
                      <p className="break-words whitespace-pre-wrap text-foreground">{detailOrder.customer_note || '—'}</p>
                    </section>
                  </div>

                  <div className="flex min-w-0 flex-col gap-1">
                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                        Zákazník
                      </h3>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div>
                          <p className="text-sm text-muted-foreground">Meno</p>
                          <p className="break-words font-medium text-foreground">{detailOrder.customer_name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">E-mail</p>
                          <p className="break-all text-foreground">{detailOrder.customer_email}</p>
                        </div>
                      </div>
                    </section>

                    <div className="grid grid-cols-2 gap-2">
                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                        Služby
                      </h3>
                      <p className="break-words text-foreground">{getServiceNames(detailOrder.service_type) || '—'}</p>
                    </section>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                        Faktúra a Dobropis
                      </h3>
                      {!detailOrder.invoice_number && !detailOrder.credit_note_number ? (
                        <p className="text-sm text-muted-foreground">—</p>
                      ) : (
                      <div className="space-y-1.5">
                      {detailOrder.invoice_number && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">Faktúra</p>
                          <a
                            href={detailOrder.invoice_url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-green-400 hover:text-green-300 underline"
                          >
                            <FileText className="w-4 h-4" />
                            <span className="break-all font-mono">{detailOrder.invoice_number}</span>
                          </a>
                        </div>
                      )}
                      {detailOrder.credit_note_number && (
                        <div>
                          <p className="text-sm text-muted-foreground mb-2">Dobropis</p>
                          <a
                            href={detailOrder.credit_note_pdf || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-red-500 hover:text-red-400 underline"
                          >
                            <FileText className="w-4 h-4" />
                            <span className="break-all font-mono">{detailOrder.credit_note_number}</span>
                          </a>
                        </div>
                      )}
                      </div>
                      )}
                    </section>
                    </div>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">Súbory</h3>
                      <div className="grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <p className="mb-1 text-xs text-muted-foreground">Súbor zákazníka</p>
                      {detailOrder.file_url ? (
                        <button
                          onClick={() => handleDownload(detailOrder.file_url!, detailOrder.order_number || detailOrder.id.slice(0, 8), detailOrder.id)}
                          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-transparent px-2 text-center text-xs leading-tight text-foreground"
                        >
                          <Download className="w-4 h-4" />
                          Stiahnuť súbor zákazníka
                        </button>
                      ) : (
                        <p className="text-muted-foreground text-sm">Súbor nie je k dispozícii</p>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-xs text-muted-foreground">Hotový súbor</p>
                      {detailOrder.result_file_url ? (
                        <a
                          href={detailOrder.result_file_url}
                          download
                          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-primary/40 bg-primary/15 px-2 text-center text-xs font-medium leading-tight text-primary"
                        >
                          <Eye className="w-4 h-4" />
                          Stiahnuť hotový súbor
                        </a>
                      ) : detailOrder.invoice_number ? (
                        <div className="space-y-2">
                          <p className="text-muted-foreground text-sm">Súbor už bol odoslaný</p>
                          <button
                            disabled={true}
                            className="flex h-9 w-full cursor-not-allowed items-center justify-center rounded-lg border border-white/10 bg-secondary px-2 text-center text-xs text-muted-foreground"
                          >
                            <span>Súbor odoslaný</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {uploadingId === detailOrder.id ? (
                            <div className="flex items-center gap-2 text-gray-400">
                              <span className="animate-pulse">⏳</span>
                              <span className="text-sm">Odosielam faktúru a notifikáciu klientovi...</span>
                            </div>
                          ) : (
                            <>
                              <p className="text-muted-foreground text-sm">Hotový súbor ešte nie je nahraný</p>
                              <button
                                onClick={() => {
                                  setDetailOrder(null);
                                  triggerUpload(detailOrder.id);
                                }}
                                disabled={uploadingId === detailOrder.id || detailOrder.invoice_number}
                                className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-center text-xs leading-tight ${
                                  uploadingId === detailOrder.id
                                    ? 'cursor-not-allowed border border-white/10 bg-white/5 text-gray-400'
                                    : detailOrder.invoice_number
                                    ? 'cursor-not-allowed border border-white/10 bg-secondary text-muted-foreground'
                                    : 'border border-primary/40 bg-primary/15 font-medium text-primary'
                                }`}
                              >
                                {uploadingId === detailOrder.id ? (
                                  <>
                                    <span className="animate-pulse">⏳</span>
                                    <span>Odosielam...</span>
                                  </>
                                ) : detailOrder.invoice_number ? (
                                  <span>Súbor odoslaný</span>
                                ) : (
                                  <>
                                    <Upload className="w-4 h-4" />
                                    Nahrať hotový súbor
                                  </>
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                    </section>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                        CRC
                      </h3>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          type="text"
                          value={getEditableValue(detailOrder, 'checksum_crc')}
                          onChange={(e) => {
                            handleFieldChange(detailOrder.id, 'checksum_crc', e.target.value);
                            if (!editingFields[detailOrder.id]) {
                              setEditingFields(prev => ({
                                ...prev,
                                [detailOrder.id]: { ...prev[detailOrder.id], checksum_crc: e.target.value }
                              }));
                            }
                          }}
                          placeholder="CRC..."
                          maxLength={6}
                          className="h-9 w-[120px] max-w-full rounded border border-gray-600 bg-secondary/50 px-3 py-2 font-mono text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <button
                          type="button"
                          onClick={() => setDetailOrder(null)}
                          className="rounded-lg border border-transparent bg-secondary px-4 py-2 text-foreground transition-all duration-200 hover:border-cyan-400/60 hover:bg-gray-800 hover:text-white hover:shadow-[0_0_16px_rgba(0,242,255,0.22)]"
                        >
                          Zrušiť
                        </button>
                        <button
                          onClick={() => handleSaveFields(detailOrder.id)}
                          disabled={savingId === detailOrder.id}
                          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/20 px-4 py-2 text-primary transition-colors hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Uložiť CRC"
                        >
                          <Save className={`w-4 h-4 ${savingId === detailOrder.id ? 'animate-pulse' : ''}`} />
                          Uložiť
                        </button>
                      </div>
                    </section>
                  </div>
                </div>

                {/* Interná poznámka */}
                {detailOrder.internal_note && (
                  <section className="mt-2 min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                    <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                      Interná poznámka
                    </h3>
                    <p className="break-words whitespace-pre-wrap text-foreground">{detailOrder.internal_note}</p>
                  </section>
                )}

                {/* Activity Log */}
                {activityLogs.length > 0 && (
                  <section className="mt-2 min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                    <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                      Časová os aktivít
                    </h3>
                    <div className="space-y-1.5">
                      {activityLogs.map((log, index) => {
                        const actionLabels: Record<string, string> = {
                          'INVOICE_GENERATED': 'Faktúra vystavená',
                          'CN_GENERATED': 'Dobropis vystavený',
                          'STATUS_CHANGED': 'Zmena statusu',
                          'FILE_UPLOADED': 'Súbor nahraný',
                        };
                        
                        const actionColors: Record<string, string> = {
                          'INVOICE_GENERATED': 'text-green-400',
                          'CN_GENERATED': 'text-red-400',
                          'STATUS_CHANGED': 'text-blue-400',
                          'FILE_UPLOADED': 'text-yellow-400',
                        };
                        
                        return (
                          <div key={log.id} className="flex items-start gap-3 pb-3 border-b border-primary/10 last:border-0">
                            <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-2" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <span className={`break-words font-medium ${actionColors[log.action] || 'text-foreground'}`}>
                                  {actionLabels[log.action] || log.action}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {new Date(log.created_at).toLocaleString('sk-SK')}
                                </span>
                              </div>
                              {log.details && Object.keys(log.details).length > 0 && (
                                <div className="mt-1 break-words text-sm text-muted-foreground">
                                  {log.action === 'INVOICE_GENERATED' && log.details.invoice_number && (
                                    <span>Faktúra: {log.details.invoice_number}</span>
                                  )}
                                  {log.action === 'CN_GENERATED' && log.details.credit_note_number && (
                                    <span>Dobropis: {log.details.credit_note_number}</span>
                                  )}
                                  {log.action === 'STATUS_CHANGED' && (
                                    <span>{log.details.from} → {log.details.to}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="mt-1 w-full min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                  <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                    *IMPORTANT*
                  </h3>
                  <div className="space-y-1.5">
                    <textarea
                      value={importantNote}
                      onChange={(e) => {
                        setImportantNote(e.target.value);
                        // Reset saved state when user starts typing again
                        if (savedImportantNote !== null && e.target.value !== savedImportantNote) {
                          setSavedImportantNote(null);
                        }
                      }}
                      placeholder="Enter important message for customer email..."
                      rows={2}
                      maxLength={500}
                      className="h-8 w-full resize-none rounded-lg border border-gray-600 bg-secondary/50 px-3 py-1 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
                        This message will appear in the customer email after file completion notification.
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailOrder(null)}
                          className="rounded-lg border border-transparent bg-secondary px-4 py-2 text-foreground transition-all duration-200 hover:border-cyan-400/60 hover:bg-gray-800 hover:text-white hover:shadow-[0_0_16px_rgba(0,242,255,0.22)]"
                        >
                          Zrušiť
                        </button>
                        <button
                        onClick={() => handleSaveImportantNote(detailOrder.id)}
                        disabled={savingImportantNote === detailOrder.id || (savedImportantNote !== null && importantNote === savedImportantNote)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          savedImportantNote !== null && importantNote === savedImportantNote
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-primary/20 hover:bg-primary/30 text-primary'
                        }`}
                        title={savedImportantNote !== null && importantNote === savedImportantNote ? 'Uložené!' : 'Uložiť dôležitú správu'}
                      >
                        {savedImportantNote !== null && importantNote === savedImportantNote ? (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            Uložené!
                          </>
                        ) : savingImportantNote === detailOrder.id ? (
                          <>
                            <Save className="w-4 h-4 animate-pulse" />
                            Ukladám...
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            Uložiť poznámku
                          </>
                        )}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* Internal Note Modal */}
        <InternalNoteModal
          isOpen={!!noteModalOrder}
          onClose={() => setNoteModalOrder(null)}
          orderId={noteModalOrder?.id || ''}
          orderNumber={noteModalOrder?.order_number || noteModalOrder?.id.slice(0, 8).toUpperCase() || ''}
          initialNote={noteModalOrder ? getEditableValue(noteModalOrder, 'internal_note') : ''}
          onSave={async (note) => {
            if (!noteModalOrder) return;
            handleFieldChange(noteModalOrder.id, 'internal_note', note);
            await handleSaveFields(noteModalOrder.id);
            setNoteModalOrder(null);
          }}
          isSaving={savingId === noteModalOrder?.id}
        />
      </div>

      <footer className="mt-8 w-full py-4 text-center text-xs text-gray-500">
        <p>REMAPPRO, IČO: 41281471, DIČ: 1041196607, Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia</p>
        <p className="mt-1">Copyright © 2026 REMAPPRO Digital Solutions. All rights reserved.</p>
      </footer>
      </div>

      {/* Cancel Order Confirmation Dialog */}
      <AlertDialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto border border-[rgba(0,242,255,0.45)] bg-[#070b10] shadow-[0_0_28px_rgba(0,242,255,0.22)] sm:max-w-[500px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Storno objednávky a vrátenie peňazí</AlertDialogTitle>
            <AlertDialogDescription>
              Vyplňte údaje pre vytvorenie dobropisu a storno objednávky.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="refund-amount">Suma na vrátenie (€)</Label>
              <Input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={refundAmount}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                    setRefundAmount(value);
                  }
                }}
                className="h-12 font-mono text-xl leading-none [appearance:textfield] md:text-xl [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="refund-reason">Dôvod storna</Label>
              <Textarea
                id="refund-reason"
                placeholder="Zadajte dôvod storna objednávky..."
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setCancelDialogOpen(false);
              setPendingCancelOrder(null);
              setRefundAmount('');
              setRefundReason('');
            }}>
              Zrušiť
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (pendingCancelOrder) {
                  const amount = parseFloat(refundAmount);
                  if (isNaN(amount) || amount <= 0) {
                    toast.error('Prosím zadajte platnú sumu väčšiu ako nula');
                    return;
                  }
                  
                  setCancelDialogOpen(false);
                  try {
                    await handleRefund(pendingCancelOrder.id, amount, refundReason);
                    setPendingCancelOrder(null);
                    setRefundAmount('');
                    setRefundReason('');
                  } catch (error: any) {
                    console.error('[CancelDialog] Refund failed:', error);
                    toast.error(error?.message || 'Chyba pri spracovaní refundácie');
                  }
                }
              }}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              Vytvoriť dobropis
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NEW: Refund Wizard Modal */}
      <Dialog open={refundModalOpen} onOpenChange={setRefundModalOpen}>
        <DialogContent hideCloseButton className="max-h-[90vh] overflow-y-auto overflow-x-hidden border border-[rgba(0,242,255,0.45)] bg-[#070b10] shadow-[0_0_28px_rgba(0,242,255,0.22)] sm:max-w-[500px]">
          <div className="flex items-start justify-between gap-3">
            <DialogHeader className="min-w-0 flex-1">
              <DialogTitle className="flex items-start gap-2 break-words text-xl font-bold leading-snug text-foreground">
                <RotateCcw className="w-5 h-5 text-red-500" />
                Refundácia objednávky {refundModalOrder?.order_number || refundModalOrder?.id.slice(0, 8).toUpperCase()}
              </DialogTitle>
              <DialogDescription>
                Vyplňte údaje pre vytvorenie dobropisu. Email s prílohou bude automaticky odoslaný zákazníkovi.
              </DialogDescription>
            </DialogHeader>
            <DialogClose className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors duration-200 hover:bg-red-500/15 hover:text-red-500">
              <X className="h-5 w-5" />
              <span className="sr-only">Zavrieť</span>
            </DialogClose>
          </div>
          <div className="grid gap-4 py-4">
            {refundModalOrder && (
              <>
                <div className="rounded-lg border border-[rgba(0,242,255,0.35)] bg-gradient-to-r from-cyan-500/15 to-secondary/40 px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Zákazník</p>
                  <p className="break-words font-semibold text-foreground">{refundModalOrder.customer_name}</p>
                  <p className="break-all text-sm text-white/80">{refundModalOrder.customer_email}</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="refund-wizard-amount">Refund Amount (€)</Label>
                  <Input
                    id="refund-wizard-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={refundWizardAmount}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || /^\d*\.?\d*$/.test(value)) {
                        setRefundWizardAmount(value);
                      }
                    }}
                    className="h-12 font-mono text-xl leading-none [appearance:textfield] md:text-xl [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Predvolená suma: {typeof refundModalOrder.total_price === 'string' 
                      ? parseFloat(refundModalOrder.total_price).toFixed(2) 
                      : (refundModalOrder.total_price || 0).toFixed(2)} €
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="refund-wizard-reason">Reason for Credit Note</Label>
                  <Textarea
                    id="refund-wizard-reason"
                    placeholder="Zadajte dôvod refundácie..."
                    value={refundWizardReason}
                    onChange={(e) => setRefundWizardReason(e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <button
              onClick={() => {
                setRefundModalOpen(false);
                setRefundModalOrder(null);
                setRefundWizardAmount('');
                setRefundWizardReason('');
              }}
              className="rounded-lg border border-transparent bg-secondary px-4 py-2 text-foreground transition-all duration-200 hover:border-cyan-400/60 hover:bg-gray-800 hover:text-white hover:shadow-[0_0_16px_rgba(0,242,255,0.22)]"
              disabled={issuingCreditNote}
            >
              Zrušiť
            </button>
            <button
              onClick={handleIssueCreditNote}
              disabled={issuingCreditNote || !refundWizardAmount || !refundWizardReason.trim()}
              className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {issuingCreditNote ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Spracovávam...
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" />
                  Potvrdiť a odoslať Dobropis
                </>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ManagementPortal;
