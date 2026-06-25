const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const cron   = require('node-cron');
const pino   = require('pino');
const fs     = require('fs');
const path   = require('path');
const cfg    = require('./config');

// ─── LOGGER ───────────────────────────────────────────────────────────────────
const logger = pino({ level: 'silent' });

// ─── DATA ─────────────────────────────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(cfg.DATA_FILE)) return JSON.parse(fs.readFileSync(cfg.DATA_FILE, 'utf8'));
  } catch {}
  return { turnos: [], pacientes: [], cobros: [], config: cfg.CLINICA };
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
function tomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function fmtFecha(d) {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}
function fmtPeso(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR');
}
function normalize(txt) {
  return (txt || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').trim();
}
function matchesAny(msg, words) {
  const n = normalize(msg);
  return words.some(w => n.includes(normalize(w)));
}

// ─── RESPUESTAS ───────────────────────────────────────────────────────────────
const MENU_PRINCIPAL = `🌸 *Hola! Soy el asistente de ${cfg.CLINICA.nombre}*

¿En qué te puedo ayudar?

1️⃣ Ver servicios y precios
2️⃣ Horarios y ubicación
3️⃣ Sacar / consultar turno
4️⃣ Confirmar un turno
5️⃣ Cancelar un turno

Respondé con el número o escribí tu consulta 😊`;

const RESP = {
  saludo: (nombre) =>
    `¡Hola${nombre ? ' ' + nombre : ''}! 👋✨\n\nBienvenida/o a *${cfg.CLINICA.nombre}*\n${cfg.CLINICA.profesional}\n\n${MENU_PRINCIPAL}`,

  horario: () =>
    `⏰ *Horarios de atención:*\n${cfg.CLINICA.horario}\n\n📍 *Dónde estamos:*\n${cfg.CLINICA.direccion}\n\n📲 Este número: wa.me/${cfg.CLINICA.wa}\n📸 Instagram: ${cfg.CLINICA.instagram}`,

  ubicacion: () =>
    `📍 *Cómo llegar:*\nEstamos en el *${cfg.CLINICA.direccion}*\n\nGoogle Maps: https://maps.app.goo.gl/AyresVillageSanJuan\n\n⏰ ${cfg.CLINICA.horario}`,

  servicios: () =>
    `💆 *Nuestros tratamientos:*

✨ *Depilación Definitiva* — Monolith Mediostar (última tecnología)
💉 *Botox & Rellenos*
⚡ *Endolift Facial y Corporal* — Velas
🔬 *Endimed* (Facial / Corporal / Intensivo)
💊 *Mesoterapia* Facial · Corporal · Capilar
🩸 *Plasma Rico en Plaquetas (PRP)*
🌊 *CM Slim* — Remodelado corporal
🔄 *Encurve*
💧 *Suero Terapias* (Dr. Walter Antuña)
🌿 *Masajes* Terapéuticos y Modeladores
🩺 *Ginecología* — Dr. Andrés Echegaray
⚖️ *Endocrinología / Descenso de Peso* — Dra. Otiñano

Para ver precios respondé *2* o escribí *precios* 😊`,

  precios: () =>
    `💰 *Precios (actualizado Jun 2026):*

🪒 *Depilación Definitiva (Monolith Mediostar):*
  • Axilas: ${fmtPeso(22000)} lista / ${fmtPeso(19000)} contado
  • Bikini: ${fmtPeso(22000)} / ${fmtPeso(19000)}
  • Bozo: ${fmtPeso(10000)} / ${fmtPeso(8000)}
  • Cara completa: ${fmtPeso(30000)} / ${fmtPeso(26000)}
  • Pierna completa: ${fmtPeso(26500)} / ${fmtPeso(23000)}
  • Cuerpo completo (mujer): ${fmtPeso(160000)} / ${fmtPeso(140000)}

💉 *Médico-Estéticos:*
  • Botox (1 zona): ${fmtPeso(311000)} / ${fmtPeso(290000)}
  • Baby Botox: ${fmtPeso(277000)} / ${fmtPeso(258000)}
  • PRP facial: ${fmtPeso(70000)} / ${fmtPeso(65000)}
  • Relleno labial: ${fmtPeso(255000)} / ${fmtPeso(237000)}
  • Endolift Facial: ${fmtPeso(480000)} / ${fmtPeso(445000)}
  • Endolift Corporal: ${fmtPeso(550000)} / ${fmtPeso(510000)}
  • HIFU Facial: ${fmtPeso(350000)} / ${fmtPeso(325000)}
  • Criolipolisis: ${fmtPeso(250000)} / ${fmtPeso(232000)}

✨ *Estética Facial:*
  • Limpieza facial simple: ${fmtPeso(25000)} / ${fmtPeso(20000)}
  • Limpieza facial profunda: ${fmtPeso(32000)} / ${fmtPeso(26000)}
  • Endymed Facial (sesión): ${fmtPeso(180000)} / ${fmtPeso(165000)}
  • Mesoterapia facial: ${fmtPeso(90000)} / ${fmtPeso(80000)}

💧 *Sueros & Terapias:*
  • Suero terapia: ${fmtPeso(55000)} / ${fmtPeso(50000)}

📦 *Packs con descuento disponibles!*
Precio lista = tarjeta · Precio contado = efectivo/transferencia

Para turnos → escribí *turno* o respondé *3* 😊`,

  turno: () =>
    `📅 *Sacar turno en ${cfg.CLINICA.nombre}*

Para reservar tu turno necesitamos:
• Tu nombre completo
• El tratamiento que buscás
• Día y horario preferido

📞 Respondé este mensaje con esa información y te confirmamos a la brevedad ✨

⏰ Atendemos: ${cfg.CLINICA.horario}`,

  confirmarSinTurno: () =>
    `✅ Gracias por confirmar!\n\nSi necesitás más información o querés cambiar el horario, escribinos. ¡Te esperamos! 🌸`,

  cancelarSinTurno: () =>
    `Entendemos, no hay problema 🙏\n\nCuando quieras reagendar, estamos disponibles:\n⏰ ${cfg.CLINICA.horario}\n\n¡Hasta pronto! 😊`,

  noEntiendo: () =>
    `Lo siento, no entendí bien tu consulta 😊\n\n${MENU_PRINCIPAL}`,
};

// ─── RECORDATORIO ─────────────────────────────────────────────────────────────
function generarRecordatorio(turno, paciente) {
  const nombre = (paciente?.nombre || turno.paciente || '').split(' ')[0];
  return (
    `✨ *Recordatorio de turno — ${cfg.CLINICA.nombre}*\n\n` +
    `Hola ${nombre}! Te recordamos tu turno de *mañana*:\n` +
    `📅 ${fmtFecha(turno.fecha)} a las *${turno.hora}hs*\n` +
    `💆 ${turno.servicio || 'Tratamiento'}\n` +
    `📍 ${cfg.CLINICA.direccion}\n\n` +
    `Por favor confirmá tu asistencia respondiendo *CONFIRMO* ✅\n` +
    `Si no podés venir, respondé *CANCELO* para liberar el turno 🙏`
  );
}

function generarBriefing(data) {
  const hoy = today();
  const turnosHoy = (data.turnos || [])
    .filter(t => t.fecha === hoy && t.estado !== 'cancelado')
    .sort((a, b) => a.hora.localeCompare(b.hora));

  const fechaStr = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  let txt = `🌸 *${cfg.CLINICA.nombre} — Briefing ${fechaStr}*\n\n`;
  if (turnosHoy.length === 0) {
    txt += 'Sin turnos agendados para hoy.\n';
  } else {
    txt += `📅 *${turnosHoy.length} turno(s):*\n`;
    turnosHoy.forEach(t => {
      txt += `  • ${t.hora}hs — ${t.paciente} — ${t.servicio || '?'}\n`;
    });
  }

  const deudas = (data.cobros || []).filter(c => c.estado !== 'pagado' && (c.saldo || 0) > 0);
  if (deudas.length) {
    const total = deudas.reduce((a, c) => a + (c.saldo || 0), 0);
    txt += `\n💰 Deudas pendientes: ${fmtPeso(total)} (${deudas.length} cobros)\n`;
  }

  txt += `\n¡Buen día a todo el equipo! ✨`;
  return txt;
}

// ─── ESTADO DE CONVERSACIÓN ───────────────────────────────────────────────────
const convState = new Map(); // jid → { step, data, ts }

function getConv(jid) {
  const s = convState.get(jid);
  // Expirar después de 30 minutos de inactividad
  if (s && Date.now() - s.ts > 30 * 60 * 1000) { convState.delete(jid); return null; }
  return s || null;
}
function setConv(jid, step, data = {}) {
  convState.set(jid, { step, data, ts: Date.now() });
}
function clearConv(jid) { convState.delete(jid); }

// ─── LÓGICA DE MENSAJES ───────────────────────────────────────────────────────
async function handleMessage(sock, msg) {
  const jid  = msg.key.remoteJid;
  if (!jid || jid.endsWith('@g.us')) return; // ignorar grupos

  const body = msg.message?.conversation ||
               msg.message?.extendedTextMessage?.text || '';
  if (!body) return;

  const n   = normalize(body);
  const num = jid.replace('@s.whatsapp.net', '');

  // Buscar paciente por número
  const data      = loadData();
  const paciente  = (data.pacientes || []).find(p =>
    p.tel && p.tel.replace(/\D/g, '').endsWith(num.slice(-8))
  );
  const nombre    = paciente?.nombre?.split(' ')[0] || '';

  // ── FLUJO: solicitud de turno en progreso ──────────────────────────────────
  const conv = getConv(jid);
  if (conv?.step === 'esperando_turno_datos') {
    // Guardar solicitud y notificar admin
    await sock.sendMessage(jid, {
      text: `✅ Recibimos tu solicitud!\n\n📋 *Resumen:*\n${body}\n\nTe confirmamos el turno a la brevedad. ¡Gracias! 😊`,
    });
    await sock.sendMessage(cfg.ADMIN_WA, {
      text: `📅 *Nueva solicitud de turno*\n\nDe: ${paciente?.nombre || num}\nTel: +${num}\n\n${body}`,
    });
    clearConv(jid);
    return;
  }

  // ── CONFIRMACIÓN DE TURNO ─────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.confirmar)) {
    const turnosPendientes = (data.turnos || []).filter(t =>
      t.estado === 'pendiente' && t.fecha >= today() &&
      (paciente ? t.pacienteId === paciente.id || normalize(t.paciente).includes(normalize(paciente.nombre)) : false)
    );
    if (turnosPendientes.length > 0) {
      const t = turnosPendientes[0];
      await sock.sendMessage(jid, {
        text: `✅ *Turno confirmado!*\n📅 ${fmtFecha(t.fecha)} a las ${t.hora}hs\n💆 ${t.servicio || ''}\n\n¡Te esperamos! 🌸`,
      });
      await sock.sendMessage(cfg.ADMIN_WA, {
        text: `✅ Turno CONFIRMADO\n👤 ${paciente?.nombre || num}\n📅 ${fmtFecha(t.fecha)} ${t.hora}hs — ${t.servicio || ''}`,
      });
    } else {
      await sock.sendMessage(jid, { text: RESP.confirmarSinTurno() });
    }
    return;
  }

  // ── CANCELACIÓN ──────────────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.cancelar)) {
    await sock.sendMessage(jid, { text: RESP.cancelarSinTurno() });
    await sock.sendMessage(cfg.ADMIN_WA, {
      text: `⚠️ Cancelación/ausencia\n👤 ${paciente?.nombre || '+'+num}\nMensaje: "${body}"`,
    });
    return;
  }

  // ── MENÚ NUMÉRICO ────────────────────────────────────────────────────────
  if (/^[1-5]$/.test(n)) {
    const respMap = {
      '1': RESP.servicios(),
      '2': RESP.precios(),
      '3': (() => { setConv(jid, 'esperando_turno_datos'); return RESP.turno(); })(),
      '4': RESP.confirmarSinTurno(),
      '5': RESP.cancelarSinTurno(),
    };
    await sock.sendMessage(jid, { text: respMap[n] });
    return;
  }

  // ── KEYWORDS ─────────────────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.saludo)) {
    await sock.sendMessage(jid, { text: RESP.saludo(nombre) });
    return;
  }
  if (matchesAny(body, cfg.KEYWORDS.horario)) {
    await sock.sendMessage(jid, { text: RESP.horario() });
    return;
  }
  if (matchesAny(body, cfg.KEYWORDS.ubicacion)) {
    await sock.sendMessage(jid, { text: RESP.ubicacion() });
    return;
  }
  if (matchesAny(body, cfg.KEYWORDS.servicios)) {
    await sock.sendMessage(jid, { text: RESP.servicios() });
    return;
  }
  if (matchesAny(body, cfg.KEYWORDS.precios)) {
    await sock.sendMessage(jid, { text: RESP.precios() });
    return;
  }
  if (matchesAny(body, cfg.KEYWORDS.turno)) {
    setConv(jid, 'esperando_turno_datos');
    await sock.sendMessage(jid, { text: RESP.turno() });
    return;
  }

  // ── FALLBACK ─────────────────────────────────────────────────────────────
  // Solo responder si es el primer mensaje (no spamear)
  if (!conv) {
    await sock.sendMessage(jid, { text: RESP.noEntiendo() });
  }
}

// ─── CRON: RECORDATORIOS ─────────────────────────────────────────────────────
function iniciarCrons(sock) {
  // Recordatorios automáticos de turnos de mañana
  cron.schedule(cfg.CRON_RECORDATORIOS, async () => {
    const data    = loadData();
    const manana  = tomorrow();
    const turnos  = (data.turnos || []).filter(t =>
      t.fecha === manana && t.estado !== 'cancelado'
    );

    console.log(`[CRON] Recordatorios: ${turnos.length} turno(s) para mañana`);

    for (const turno of turnos) {
      const paciente = (data.pacientes || []).find(p => p.id === turno.pacienteId);
      const tel = paciente?.tel || turno.tel;
      if (!tel) continue;
      const num = tel.replace(/\D/g, '');
      try {
        await sock.sendMessage(`${num}@s.whatsapp.net`, {
          text: generarRecordatorio(turno, paciente),
        });
        await new Promise(r => setTimeout(r, 1500)); // pausa entre mensajes
      } catch (e) {
        console.error(`[CRON] Error enviando a ${num}:`, e.message);
      }
    }
  }, { timezone: 'America/Argentina/San_Juan' });

  // Briefing diario para el admin
  cron.schedule(cfg.CRON_BRIEFING, async () => {
    const data = loadData();
    try {
      await sock.sendMessage(cfg.ADMIN_WA, { text: generarBriefing(data) });
      console.log('[CRON] Briefing enviado al admin');
    } catch (e) {
      console.error('[CRON] Error briefing:', e.message);
    }
  }, { timezone: 'America/Argentina/San_Juan' });

  console.log('[CRON] Recordatorios:', cfg.CRON_RECORDATORIOS);
  console.log('[CRON] Briefing:', cfg.CRON_BRIEFING);
}

// ─── CONEXIÓN ─────────────────────────────────────────────────────────────────
async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth:   state,
    logger,
    printQRInTerminal: false,
    browser: ['ONE DEPIL Bot', 'Chrome', '1.0'],
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n──────────────────────────────────────');
      console.log('  Escaneá este QR con WhatsApp:');
      console.log('  (Abrí WA → ⋮ → Dispositivos vinculados → Vincular)');
      console.log('──────────────────────────────────────\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'open') {
      console.log('\n✅ Bot conectado como ONE DEPIL!');
      iniciarCrons(sock);
      sock.sendMessage(cfg.ADMIN_WA, {
        text: `🤖 *Bot ONE DEPIL online*\n✅ Conectado y listo\n\n📋 Funciones activas:\n• Respuestas automáticas\n• Recordatorios (${cfg.CRON_RECORDATORIOS})\n• Briefing diario (${cfg.CRON_BRIEFING})\n\nPara pausar el bot, cerrá esta terminal.`,
      }).catch(() => {});
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconectar = code !== DisconnectReason.loggedOut;
      console.log(`\n⚠️  Conexión cerrada (código ${code}). Reconectando: ${reconectar}`);
      if (reconectar) setTimeout(conectar, 5000);
      else console.log('Sesión cerrada. Borrá la carpeta auth_info y reiniciá.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      try { await handleMessage(sock, msg); }
      catch (e) { console.error('[MSG]', e.message); }
    }
  });

  return sock;
}

// ─── ARRANQUE ─────────────────────────────────────────────────────────────────
console.log('🌸 ONE DEPIL — Bot de WhatsApp');
console.log('   Clínica: ' + cfg.CLINICA.nombre);
console.log('   ' + cfg.CLINICA.direccion);
console.log('');
conectar().catch(console.error);
