export const INITIAL_ORDER_STATUS = 'pending';
export const PROCESSING_ORDER_STATUS = 'processing';
export const FINAL_ORDER_STATUS = 'completed';

const WAITING_FOR_DOWNLOAD = new Set(['pending', 'paid']);

export const statusAfterClientFileDownload = (status: string) =>
  WAITING_FOR_DOWNLOAD.has(status) ? PROCESSING_ORDER_STATUS : status;

export const statusAfterResultDelivery = (status: string) =>
  status === 'cancelled' ? status : FINAL_ORDER_STATUS;
