# Despliegue en el VPS (IONOS + Coolify)

Guía paso a paso para dejar la plataforma publicada desde GitHub. Solo la parte 1 requiere
entrar al servidor; lo demás se hace desde el navegador.

## 1. Preparar el VPS (una sola vez)

1. En el panel de IONOS, el servidor debe tener **Ubuntu 24.04**.
2. **Firewall** (IONOS → Red → Políticas de firewall), permitir entrada TCP:
   - 22 (SSH)
   - 80 y 443 (web y certificados HTTPS)
   - 8000 (panel de Coolify; se puede cerrar al final, cuando el panel tenga su propio dominio)
   - 6001 y 6002 (actualizaciones en vivo del panel de Coolify)
3. Abrir la consola web del servidor en IONOS (o SSH como root) y ejecutar:

   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
   ```

4. Al terminar, abrir `http://IP-DEL-SERVIDOR:8000` y crear la cuenta de administrador de Coolify
   (usar una contraseña fuerte; este panel controla todo el servidor).

## 2. DNS

En el administrador de DNS de packatelas.mx crear registros **A** hacia la IP del VPS:

| Nombre | Uso |
|---|---|
| `nuevo` | Plataforma en pruebas (`nuevo.packatelas.mx`) |
| `coolify` | Panel de Coolify (`coolify.packatelas.mx`), opcional |

`admin.packatelas.mx` **no se toca** hasta el día de la migración.

## 3. Conectar GitHub

1. Coolify → Sources → **Add GitHub App** → instalarla en la organización **Computenga**.
2. Dar acceso solo al repositorio `packatelas-plataforma`.

## 4. Crear el proyecto

1. Coolify → Projects → New → **Docker Compose**, origen: la GitHub App, rama `main`,
   archivo `docker-compose.yml`.
2. Variables de entorno (Environment Variables):

   | Variable | Valor |
   |---|---|
   | `POSTGRES_PASSWORD` | Contraseña larga y aleatoria |
   | `ENCRYPTION_KEY` | Resultado de `openssl rand -base64 32` |
   | `GOOGLE_MAPS_API_KEY` | Llave de Places API (New), cuando exista |
   | `OSRM_URL` | Vacío por ahora (se agrega al montar OSRM) |

3. En el servicio **web**: dominio `https://nuevo.packatelas.mx`, puerto 3000.
4. Activar **Automatic deployment** (cada push a `main` publica).
5. Deploy. El servicio `migrate` crea las tablas antes de arrancar la web.

## 5. Primer usuario administrador

El seed de desarrollo no se usa en producción. Para el primer acceso:

1. Agregar en Coolify `BOOTSTRAP_ADMIN_USER` (p. ej. `cristhian`) y `BOOTSTRAP_ADMIN_PASSWORD`
   (12 caracteres o más) y desplegar. El servicio `migrate` crea ese administrador solo si
   todavía no existe ninguno.
2. Entrar con ese usuario y **borrar `BOOTSTRAP_ADMIN_PASSWORD`** de las variables.
3. Los demás usuarios se dan de alta desde Administración → Usuarios.

## 6. Abonos automáticos desde Gmail (Fondeadora)

El servicio `worker` revisa cada 2 minutos los correos "Depósito" de
`info@negocios.fondeadora.com` y aplica el abono cuando el concepto trae el ID del cliente
(`CMX00114`, `cmx00127-granjas`) o su referencia `PKT…`. Lo demás queda en Cobros →
"Pagos sin identificar". Solo necesita permiso de **lectura** del correo.

Autorización (una vez, con la cuenta que recibe los avisos, cguevara@computenga.com):

1. En [console.cloud.google.com](https://console.cloud.google.com), proyecto "Packatelas":
   - APIs y servicios → Biblioteca → activar **Gmail API**.
   - Pantalla de consentimiento de OAuth → tipo **Interno** (solo cuentas de computenga.com;
     así Google no exige verificación).
   - Credenciales → Crear → **ID de cliente de OAuth** → tipo "Aplicación web" → URI de
     redirección autorizado: `https://developers.google.com/oauthplayground`.
2. Abrir [OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
   - Engrane (⚙) → "Use your own OAuth credentials" → pegar el ID y el secreto del paso 1.
   - En el paso 1 del Playground escribir el alcance
     `https://www.googleapis.com/auth/gmail.readonly` → Authorize APIs → entrar con la cuenta.
   - Paso 2 → "Exchange authorization code for tokens" → copiar el **Refresh token**.
3. En Coolify agregar `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN` y
   volver a desplegar. En los registros del `worker` aparecerán los abonos aplicados.

Para revocar el acceso: myaccount.google.com → Seguridad → Apps con acceso a la cuenta.

## 7. Respaldos

- Coolify → servicio `db` → Backups → diario, guardando en un almacenamiento S3 externo
  (por ejemplo IONOS S3 Object Storage o Backblaze B2). No dejar los respaldos solo en el VPS.
- Las fotos de evidencia viven en el volumen `uploads`; incluirlo en el respaldo o moverlas a
  Object Storage (pendiente P10).

## 8. Verificación

- `https://nuevo.packatelas.mx/login` abre con candado (HTTPS).
- Iniciar sesión con el administrador, crear un cliente de prueba, escanear un código y
  revisar que aparezca en Pedidos.
- Instalar la app en un teléfono (menú del navegador → "Agregar a pantalla de inicio").
