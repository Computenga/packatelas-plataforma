# App Android de Packatelas [P03]

Envoltorio nativo de la plataforma (una sola pantalla con la web; el menú cambia según quién entra).

- **Ubicación en segundo plano** durante el turno del repartidor: servicio en primer plano con la notificación "En turno"; manda puntos a `/api/driver/location` cada 30 s, aun con la pantalla apagada. Se enciende y apaga solo con el botón de turno de la web (`window.PackatelasNative.setOnDuty`) y se apaga si la plataforma dice que el turno terminó.
- **Escáner y fotos**: cámara para el lector de QR de la web y para fotos de evidencia (las copias en el teléfono se borran al día siguiente). Los lectores PDA funcionan igual que en el navegador.
- **Avisos nativos**: consulta `/api/app/avisos` cada minuto en turno y cada ~15 min el resto del tiempo (rutas asignadas, recibos, documentos rechazados, fallas). No usa Firebase.
- Llamadas, WhatsApp, Maps y Waze se abren en su app; las descargas (CSV, recibos, documentos) van a Descargas.
- Sin librerías externas. Android 8 o superior.

## Compilar

```
echo "sdk.dir=/ruta/al/android-sdk" > local.properties
gradle assembleRelease                      # apunta a https://nuevo.packatelas.mx
gradle assembleRelease -PbaseUrl=https://admin.packatelas.mx   # el día del cambio de dominio
```

Firma: `keystore.properties` (no se sube) con `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. **Siempre la misma llave**: si cambia, los teléfonos no aceptan la actualización y hay que desinstalar. Sube `versionCode` en `app/build.gradle` en cada versión.

El APK firmado se publica en `apps/web/public/app/packatelas.apk` → https://nuevo.packatelas.mx/app/packatelas.apk

## Sacar una versión nueva

1. Sube `versionCode` (+1) y `versionName` en `apps/web/src/lib/app-release.json` (la única fuente: la usan Gradle y la plataforma).
2. `gradle assembleRelease` en `apps/android` (con `keystore.properties`; misma firma siempre o no se instala encima).
3. Copia `app/build/outputs/apk/release/app-release.apk` a `apps/web/public/app/packatelas.apk` y despliega.

Las apps instaladas se enteran solas: la 1.5+ muestra una ventana «Actualizar» que descarga e instala; las anteriores
reciben un aviso del sistema (una vez por versión) y una franja en la parte de arriba. En Repartidores se ve quién ya actualizó.
