# Sistema de Votación por Coeficiente en Tiempo Real
### Conjunto Residencial La Reserva de Sopó 2 &bull; Ley 675 de 2001

Este sistema fue desarrollado a la medida para gestionar votaciones electrónicas en tiempo real durante asambleas de copropietarios, calculando de forma instantánea el **voto ponderado por coeficiente de copropiedad** y el **voto nominal**, garantizando la inmutabilidad y la prevención estricta de doble voto.

---

## 🚀 Inicio Rápido

### Opción 1: En tu Computador con Enlace Público Gratuito (Recomendada)
1. Haz doble clic en el archivo **`start_publico.bat`**.
2. Se iniciará el servidor y se abrirá una ventana que te dará un enlace público seguro `https://...loca.lt` o similar.
3. Ese enlace es el que compartes por el chat de Zoom o Meet para que los propietarios ingresen desde sus teléfonos móviles.

### Opción 2: Solo Local (Para pruebas en tu máquina)
1. Haz doble clic en **`start.bat`** (o ejecuta en consola: `node server/server.js`).
2. Abre en tu navegador:
   * **Residentes (Celular):** [http://localhost:3000](http://localhost:3000)
   * **Mesa Directiva (Admin):** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)
   * **Pantalla de Proyección (Zoom):** [http://localhost:3000/proyeccion.html](http://localhost:3000/proyeccion.html)

> **Clave de Acceso Administrador:** `admin2026`

---

## 🔑 Credenciales y Distribución de PINs

En la raíz del proyecto se generó automáticamente el archivo:
📄 **`PINS_ASAMBLEA.xlsx`**

Este archivo contiene los **468 apartamentos** organizados por Torre y Apartamento con:
* **Área (m²)** y **Coeficiente (%)** exacto.
* **PIN de Acceso:** Clave numérica de 4 dígitos única por apartamento.
* **Enlace Directo:** Link único que inicia sesión automáticamente con un solo clic (ideal para enviar por WhatsApp o correo sin que el usuario tenga que escribir nada).

---

## 🖥️ Dinámica durante la Asamblea Virtual

1. **Compartir Pantalla en Zoom/Meet:**
   * Abre [http://localhost:3000/proyeccion.html](http://localhost:3000/proyeccion.html) y compártela en Zoom en pantalla completa. Esta vista es limpia, elegante y de alto contraste (no tiene botones de control, solo muestra gráficos y resultados oficiales).
2. **Gestionar Votaciones (Mesa Directiva):**
   * En tu otra pantalla o navegador, ten abierto [http://localhost:3000/admin.html](http://localhost:3000/admin.html).
   * **Crear Pregunta:** Usa la plantilla rápida "Aprobación (Sí / No / Blanco)" o "Elección de Personas / Candidatos".
   * Presiona **"Lanzar Votación Ahora"**.
   * La pregunta aparecerá automáticamente en la pantalla de los teléfonos de todos los propietarios simultáneamente.
3. **Radar de Faltantes:**
   * Mientras la votación está abierta, el panel te muestra exactamente qué apartamentos faltan por votar clasificados por Torre.
   * Cuenta con un botón **"Copiar lista para Zoom / Chat"** que formatea un mensaje listo para pegar en el chat del Zoom advirtiendo a los vecinos que faltan.
4. **Cerrar Votación:**
   * Cuando el presidente dé por finalizado el tiempo, presiona **"Cerrar Votación Ahora"**. En ese instante se bloquean los votos y el resultado queda fijado como oficial.
5. **Descargar Acta Oficial:**
   * Presiona el botón verde **"Descargar Acta Excel"** en la esquina superior derecha del panel administrador. Descargará un libro de Excel con:
     1. Resumen de Quórum registrado.
     2. Resultados de todas las preguntas (nominales y por coeficiente).
     3. Auditoría voto a voto (apartamento, fecha, hora y coeficiente aplicado).

---

## ☁️ Despliegue en la Nube 100% Gratis ($0)

Si prefieres tener el sistema alojado en la nube en lugar de correrlo en tu laptop:

### En Google Cloud Run (Usando tu cuenta de Google)
1. Instala el CLI de Google Cloud (`gcloud`).
2. Abre la terminal en esta carpeta y ejecuta:
   ```bash
   gcloud run deploy sistema-votacion --source . --platform managed --region us-central1 --allow-unauthenticated
   ```
3. Cloud Run te devolverá una URL HTTPS permanente y gratuita. La capa gratuita de Cloud Run incluye 2 millones de peticiones al mes, por lo que el costo será de **$0.00 USD**.

### En Render.com
1. Crea una cuenta gratuita en [Render.com](https://render.com).
2. Crea un **New Web Service**, conecta esta carpeta o repositorio, y selecciona el entorno **Node**.
3. Comando de inicio: `node server/server.js`.
4. Te entregará una URL HTTPS pública gratuita sin necesidad de configurar nada más.
