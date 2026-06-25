# ONE DEPIL — Bot de WhatsApp

Bot de atención automática para la clínica ONE DEPIL (Dra. Sabrina Quiroga).

## Instalación (una sola vez)

```bash
# Necesitás Node.js 18 o superior
# Descargalo de https://nodejs.org si no lo tenés

cd onedepil-bot
npm install
```

## Conectar el número de WhatsApp

```bash
node bot.js
```

1. Aparece un código QR en la terminal
2. Abrí WhatsApp en tu celular → ⋮ → **Dispositivos vinculados** → **Vincular un dispositivo**
3. Escaneá el QR
4. El bot queda conectado ✅

La sesión se guarda en la carpeta `auth_info/`. La próxima vez que iniciás no pide QR.

## Sincronizar con el dashboard

Para que el bot tenga los turnos y pacientes actualizados:

1. En el dashboard → **⚙️ Config** → **Exportar JSON**
2. Renombrá el archivo a `data.json`
3. Copialo a la carpeta `onedepil-bot/`

> Tip: hacé esto cada mañana antes de arrancar, o cada vez que cargues turnos nuevos.

## Funciones automáticas

| Función | Cuándo |
|---|---|
| **Recordatorios de turno** | Todos los días a las 10:00am — avisa a los pacientes con turno al día siguiente |
| **Briefing matutino** | Lunes a sábado a las 8:00am — te manda el resumen del día al admin |
| **Respuestas automáticas** | 24/7 — responde preguntas de precios, horarios, servicios, turnos |

## Mensajes que reconoce

- "Hola", "Buenas" → Menú principal
- "Precios", "¿Cuánto sale...?" → Lista de precios
- "Turno", "Quiero sacar turno" → Inicia flujo de reserva
- "Confirmo" → Confirma el turno y notifica al admin
- "Cancelo", "No puedo ir" → Notifica al admin
- "Horario", "¿Cuándo atienden?" → Horarios y ubicación
- "Dónde quedan", "Cómo llegar" → Dirección + Google Maps
- Números 1-5 → Navegación del menú

## Mantenerlo corriendo 24/7 (opcional)

En Windows: usá **PM2** (gratis):
```bash
npm install -g pm2
pm2 start bot.js --name onedepil-bot
pm2 startup   # para que arranque automático al reiniciar la PC
pm2 save
```

## Configuración

Todo se edita en `config.js`:
- Horario de recordatorios (`CRON_RECORDATORIOS`)
- Horario del briefing (`CRON_BRIEFING`)
- Datos de la clínica
- Palabras clave que activan cada respuesta
