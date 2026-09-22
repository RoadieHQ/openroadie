import { toast } from '@roadiehq/ui/toaster';

export interface AlertMessage {
  message: string;
  severity?: 'success' | 'info' | 'warning' | 'error';
  display?: 'permanent' | 'transient';
}

export interface AlertApi {
  post(alert: AlertMessage): void;
}

export class AlertApiImpl implements AlertApi {
  post(alert: AlertMessage): void {
    const options =
      alert.display === 'permanent' ? { duration: Infinity } : undefined;
    switch (alert.severity) {
      case 'success':
        toast.success(alert.message, options);
        return;
      case 'warning':
        toast.warning(alert.message, options);
        return;
      case 'error':
        toast.error(alert.message, options);
        return;
      default:
        toast.info(alert.message, options);
    }
  }
}
