// Al arrancar el servidor web: vigila el latido del proceso en segundo plano (worker) y avisa a
// los administradores si se detiene, porque el worker no puede avisar de su propia caída [A20].
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { prisma, syncAlerts, workerAlert } = await import("@packatelas/db");
  const run = async () => {
    try {
      await syncAlerts(prisma, await workerAlert(prisma), "web");
    } catch (e) {
      console.error("[alertas] latido del worker:", e instanceof Error ? e.message : e);
    }
  };
  // Primera revisión a los 10 min: da tiempo a que el worker arranque tras un despliegue.
  setTimeout(() => {
    void run();
    setInterval(run, 5 * 60_000);
  }, 10 * 60_000);
}
