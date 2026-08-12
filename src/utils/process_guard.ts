/**
 * Process-level safety net. Prevents a single failed async operation from
 * killing every active voice call. Handlers are installed once at startup.
 */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    console.error(' Unhandled promise rejection (kept serving):', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error(' Uncaught exception:', err);
    console.error('Shutting down to avoid corrupt state.');
    process.exit(1);
  });
}