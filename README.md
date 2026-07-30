# 🏓 Pino-Pong: Casa de Apuestas

Aplicación interactiva construida en React para gestionar torneos, cuotas de apuestas, rachas y estadísticas de ping-pong. 

## Filosofía
En esta mesa demostramos que somos **más que un equipo una piña**. Cada partido está pensado para quienes tienen **madera de campeones**, llevando la competición **de las raices a la copa**. Aquí jugamos con **resina en la sangre**.

## Instalación
1. Clona el repositorio.
2. Instala las dependencias con `npm install`.
3. Configura Firebase (ver abajo) antes de arrancar, o los datos no se guardarán.
4. Arranca el servidor local con `npm run dev`.

## ☁️ Datos compartidos entre todos (Firebase)

Antes, cada móvil guardaba su propia copia de los datos (localStorage), así que
cada amigo veía cosas distintas — y en el iPhone, al añadir la app a la
pantalla de inicio, ese "icono" usa un almacenamiento todavía distinto al de
Safari, por lo que solo aparecían los 6 partidos de la demo inicial en vez del
historial real.

Ahora todos los móviles leen y escriben el mismo estado en la nube (Firebase
Realtime Database), en tiempo real. Para activarlo:

1. Ve a [console.firebase.google.com](https://console.firebase.google.com/) e
   inicia sesión con una cuenta de Google.
2. **Crear proyecto** → ponle un nombre (p. ej. `pinamax`) → puedes
   desactivar Google Analytics → **Crear proyecto**.
3. En el menú lateral: **Compilación → Realtime Database → Crear base de
   datos**. Elige una ubicación (p. ej. `europe-west1`) y arranca en
   **modo de prueba** (acceso abierto; es una app privada para un grupo de
   amigos, sin login).
4. Ve a **Configuración del proyecto** (icono de engranaje, arriba a la
   izquierda) → pestaña **General** → baja hasta "Tus apps" → pulsa el icono
   **`</>`** (Web) → dale un nombre (p. ej. `pinamax-web`) → **Registrar app**.
   *No hace falta* configurar Firebase Hosting.
5. Firebase te mostrará un objeto `firebaseConfig` con varias claves
   (`apiKey`, `authDomain`, `databaseURL`, etc.). Copia esos valores dentro de
   `src/firebaseConfig.js`, sustituyendo los `"PEGA_AQUI_..."`.
6. En **Realtime Database → Reglas**, para que cualquiera del grupo pueda
   leer y escribir sin cuenta, usa:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   (Al ser reglas abiertas, no compartas la URL de la app fuera del grupo de
   amigos: cualquiera con el enlace podría editar los datos.)
7. Ejecuta `npm install` (instala el paquete `firebase`) y `npm run dev` /
   despliega de nuevo. Todos los móviles que abran la misma URL verán y
   editarán el mismo historial, jugadores y apuestas en tiempo real.