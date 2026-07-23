export interface DatabaseHealth {
  checkConnection(): Promise<void>;
  disconnect(): Promise<void>;
}
