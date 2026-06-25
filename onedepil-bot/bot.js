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

// ─── LOG DE CONSULTAS (para reporte cada 30 min) ──────────────────────────────
const consultasLog = []; // { ts, nombre, tel, mensaje }
function logConsulta(nombre, tel, mensaje) {
  consultasLog.push({ ts: new Date().toISOString(), nombre, tel, mensaje });
}

// ─── RESPUESTAS ───────────────────────────────────────────────────────────────
const RESP = {
  saludo: (nombre) => nombre
    ? `Hola ${nombre}! 😊 Soy Aldana, de *ONE DEPIL*. ¿En qué te puedo ayudar?`
    : `Hola! 😊 Soy Aldana, de *ONE DEPIL*. ¿En qué te puedo ayudar?`,

  horario: () =>
    `Atendemos *lunes a viernes de 15 a 21hs* y *sábados de 9 a 15hs* 🗓️\n\nEstamos en *${cfg.CLINICA.direccion}*.\n\n¿Querés que te agendemos un turno? 😊`,

  ubicacion: () =>
    `Estamos en el *Pase de Compras de Ayres Village Open Mall*, acá en San Juan 📍\n\nGoogle Maps: https://maps.app.goo.gl/AyresVillageSanJuan\n\n⏰ Atendemos lunes a viernes de 15 a 21hs, sábados de 9 a 15hs.\n\n¿Te agendo un turno? 😊`,

  servicios: () =>
    `En *ONE DEPIL* hacemos un montón de cosas! 💆‍♀️✨

🪒 *Depilación definitiva* — tecnología Monolith Mediostar
💉 *Botox, rellenos y Baby Botox*
⚡ *Endolift* facial y corporal
🔬 *Endymed* (facial e intensif)
🌊 *HIFU* facial y corporal
❄️ *Criolipolisis* y *Ultracavitación*
💊 *Mesoterapia* y *PRP*
✨ *Limpiezas faciales*
💧 *Suero terapias*
⚖️ *Descenso de peso* — Dra. Otiñano
🩺 *Ginecología* — Dr. Echegaray

¿Te interesa alguno en particular? Te cuento más 😊`,

  precios: () =>
    `Los valores varían según el tratamiento y la zona a tratar 😊

Para *depilación* tenemos precios por zona que van desde muy accesibles, y también armamos combos con descuento.

Para tratamientos como *Botox, Endolift, HIFU o Endymed* los valores los maneja directamente la Dra. Sabrina según la evaluación de cada paciente.

Lo mejor es que te agendemos una consulta sin cargo para que te asesoren bien y te den el precio exacto para tu caso 🌸

¿Qué día y horario te quedaría bien para venir?`,

  turno: (nombre) =>
    `Genial${nombre ? ', ' + nombre : ''}! 😊 Para agendarte necesito:\n\n• Tu nombre completo\n• El tratamiento que querés\n• Qué día y horario te viene bien\n\n¡Respondé con esa info y te confirmo enseguida! ✨`,

  confirmarSinTurno: () =>
    `Perfecto, anotado! 🙌 Si llegás a necesitar cambiar algo avisame, estamos acá 😊`,

  cancelarSinTurno: () =>
    `No hay problema, tranquila/o 🙏 Cuando quieras reagendar mandame un mensaje y te ubico enseguida.\n\n¡Hasta la próxima! 😊`,

  noEntiendo: (nombre) =>
    `${nombre ? 'Hola ' + nombre + '! ' : 'Hola! '}Soy Aldana de *ONE DEPIL* 😊\n\n¿En qué te puedo ayudar? Podés preguntarme por turnos, tratamientos, horarios o cómo llegar 🌸`,
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

  const conv = getConv(jid);

  // Loguear toda consulta entrante (para reporte 30 min)
  logConsulta(paciente?.nombre || '+' + num, num, body);

  // ── FLUJO: solicitud de turno en progreso ──────────────────────────────────
  if (conv?.step === 'esperando_turno_datos') {
    await sock.sendMessage(jid, {
      text: `Perfecto${nombre ? ', ' + nombre : ''}! 🙌 Ya le paso tu solicitud a la secretaría para que te confirmen el turno a la brevedad.\n\nSi necesitás algo más avisame 😊`,
    });
    for (const miembro of cfg.EQUIPO) {
      await sock.sendMessage(miembro.wa, {
        text: `📅 *Nueva solicitud de turno*\n👤 ${paciente?.nombre || '+' + num}\n📱 +${num}\n\n"${body}"\n\n⚡ Confirmar a la brevedad`,
      }).catch(() => {});
    }
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
        text: `Buenísimo${nombre ? ', ' + nombre : ''}! 🙌 Tu turno queda confirmado para el *${fmtFecha(t.fecha)} a las ${t.hora}hs*.\n\n¡Te esperamos! 🌸`,
      });
      for (const miembro of cfg.EQUIPO) {
        await sock.sendMessage(miembro.wa, {
          text: `✅ *Turno confirmado*\n👤 ${paciente?.nombre || num}\n📅 ${fmtFecha(t.fecha)} ${t.hora}hs — ${t.servicio || ''}`,
        }).catch(() => {});
      }
    } else {
      await sock.sendMessage(jid, { text: RESP.confirmarSinTurno() });
    }
    return;
  }

  // ── CANCELACIÓN ──────────────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.cancelar)) {
    await sock.sendMessage(jid, { text: RESP.cancelarSinTurno() });
    for (const miembro of cfg.EQUIPO) {
      await sock.sendMessage(miembro.wa, {
        text: `⚠️ *Cancelación*\n👤 ${paciente?.nombre || '+' + num}\n📱 +${num}\nMensaje: "${body}"`,
      }).catch(() => {});
    }
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
    await sock.sendMessage(jid, { text: RESP.turno(nombre) });
    return;
  }

  // ── FALLBACK ─────────────────────────────────────────────────────────────
  if (!conv) {
    await sock.sendMessage(jid, { text: RESP.noEntiendo(nombre) });
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

  // Briefing diario para el equipo
  cron.schedule(cfg.CRON_BRIEFING, async () => {
    const data = loadData();
    const txt = generarBriefing(data);
    for (const miembro of cfg.EQUIPO) {
      try {
        await sock.sendMessage(miembro.wa, { text: txt });
      } catch (e) {
        console.error('[CRON] Error briefing a ' + miembro.nombre + ':', e.message);
      }
    }
    console.log('[CRON] Briefing enviado al equipo');
  }, { timezone: 'America/Argentina/San_Juan' });

  // Reporte de consultas cada 30 min — lunes a sábado de 10 a 21hs
  cron.schedule(cfg.CRON_REPORTE, async () => {
    if (consultasLog.length === 0) return; // sin novedad, no molestamos
    const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/San_Juan' });
    let txt = `📋 *ONE DEPIL — Resumen ${hora}hs*\n\n`;
    txt += `*${consultasLog.length} consulta(s) en los últimos 30 min:*\n\n`;
    consultasLog.forEach((c, i) => {
      const h = new Date(c.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/San_Juan' });
      txt += `${i + 1}. *${c.nombre}* (+${c.tel}) — ${h}hs\n   _"${c.mensaje.slice(0, 80)}"_\n\n`;
    });
    txt += `_Para responder directamente, escribile al número correspondiente._`;
    consultasLog.length = 0; // limpiar log
    for (const miembro of cfg.EQUIPO) {
      try {
        await sock.sendMessage(miembro.wa, { text: txt });
      } catch (e) {
        console.error('[CRON] Error reporte a ' + miembro.nombre + ':', e.message);
      }
    }
    console.log('[CRON] Reporte de consultas enviado al equipo');
  }, { timezone: 'America/Argentina/San_Juan' });

  console.log('[CRON] Recordatorios:', cfg.CRON_RECORDATORIOS);
  console.log('[CRON] Briefing:', cfg.CRON_BRIEFING);
  console.log('[CRON] Reporte consultas:', cfg.CRON_REPORTE);
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
