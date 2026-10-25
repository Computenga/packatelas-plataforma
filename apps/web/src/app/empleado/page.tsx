import { requireUser } from "@/lib/auth";

export default async function EmpleadoHome() {
  const user = await requireUser(["EMPLEADO"]);
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-xl font-bold">Hola, {user.name.split(" ")[0]}</h1>
      <p className="mt-2 text-slate-600">
        Aquí verás tus recibos, checadas y avisos cuando se integre el portal empleado.
      </p>
    </div>
  );
}
