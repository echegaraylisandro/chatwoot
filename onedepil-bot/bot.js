const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const cron   = require('node-cron');
const pino   = require('pino');
const fs     = require('fs');
const cfg    = require('./config');

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
function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
function fmtFecha(d) { if (!d) return ''; const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y}`; }
function fmtPeso(n) { return '$' + Number(n || 0).toLocaleString('es-AR'); }
function normalize(txt) {
  return (txt || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').trim();
}
function matchesAny(msg, words) { const n = normalize(msg); return words.some(w => n.includes(normalize(w))); }

// ─── TRATAMIENTOS DE ALTO VALOR (requieren consulta previa) ───────────────────
const ALTO_VALOR_KEYWORDS = [
  'endolift','hifu','endymed','intensif','fsr','botox','relleno','baby botox',
  'criolipolisis','exonus','pdrn','nad','exo-v','peptonas','endolift corporal',
];

// Monto de consulta médica
const PRECIO_CONSULTA = 40000;

// ─── INFO DE TRATAMIENTOS ─────────────────────────────────────────────────────
const INFO_TRATAMIENTOS = {
  alquimia: `✨ *TRATAMIENTO ALQUIMIA — ONE DEPIL*

Es un peeling médico de última generación que combina activos en distintas fases para lograr una renovación profunda, progresiva y segura de la piel.

💎 *Beneficios:*
• Renueva la textura, logrando una piel más suave y uniforme
• Aporta luminosidad y vitalidad inmediata
• Disminuye manchas, poros dilatados e imperfecciones
• Estimula la producción de colágeno y mejora la firmeza
• Favorece la regeneración celular y el aspecto juvenil

👩‍⚕️ Realizado por profesionales con protocolos médicos que garantizan eficacia y seguridad.

🌿 *Resultado:* piel visiblemente más luminosa, fresca y rejuvenecida desde la primera aplicación. 🌟

📅 ¿Te interesa? Te agendamos una consulta con la Dra. Sabrina para que te oriente personalmente 😊`,

  prp: `🩸 *PRP — Plasma Rico en Plaquetas*

Es un tratamiento natural que se realiza con *tu propia sangre*. Se extrae una pequeña muestra, se procesa y se obtiene un concentrado rico en factores de crecimiento que ayudan a regenerar la piel y estimular el crecimiento del cabello.

✨ *En el rostro:* piel más luminosa, firme y saludable
💆‍♀️ *En el cuero cabelludo:* fortalece el cabello y ayuda a frenar la caída

Al ser autólogo, es completamente seguro y biocompatible, sin riesgo de rechazo 🌿

Es un tratamiento natural, seguro y *personalizado*, porque se trabaja con tu propio plasma.

📅 ¿Querés que te agendemos una consulta para evaluar tu caso? 😊`,

  mesoterapia: `💊 *Mesoterapia*

Es un tratamiento médico-estético con microinyecciones de vitaminas, aminoácidos y activos específicos según tu necesidad.

🔹 *¿Para qué sirve?*
• Mejora la flacidez y la celulitis
• Estimula la producción de colágeno
• Aporta luminosidad, firmeza e hidratación
• Trata la pérdida de cabello fortaleciendo los folículos desde la raíz
• Favorece la reducción localizada de grasa

🔹 Es un procedimiento seguro, rápido y con resultados visibles desde las primeras sesiones.

📅 Podemos coordinar una consulta para evaluar tu caso y armar un plan personalizado 😊`,

  peeling: `✨ *Peeling Químico — Dra. Sabrina Quiroga*

Tratamiento médico-estético que utiliza soluciones específicas para renovar las capas superficiales de la piel.

✅ Mejora manchas, cicatrices de acné, poros dilatados y arrugas finas
✅ Estimula la producción de colágeno
✅ Deja la piel más luminosa, uniforme y saludable
✅ Realizado de manera segura y personalizada por la Dra. Sabrina

La Dra. evalúa tu tipo de piel y elige el peeling más adecuado para vos, para lograr los mejores resultados sin riesgos ✨

📅 ¿Querés que te agendemos una consulta con la Dra. Sabrina para que te oriente y planifique tu tratamiento? 😊`,

  botox: `💉 *Botox — Dra. Sabrina Quiroga*

El Botox es un tratamiento seguro y mínimamente invasivo que relaja temporalmente los músculos responsables de las líneas de expresión.

✨ *Beneficios:*
• Suaviza arrugas en frente, entrecejo y patas de gallo
• Previene la formación de nuevas líneas de expresión
• Brinda un aspecto más descansado y rejuvenecido, manteniendo la naturalidad de tu rostro
• Procedimiento rápido con recuperación prácticamente inmediata

La Dra. Quiroga evaluará tu caso y te indicará la mejor opción para lograr un resultado armónico y natural 🌸

📅 ¿Querés que te coordinemos un turno? ¡Escribinos! 😊`,

  endymed: `🔬 *Endymed Intensif + FSR Facial*

Dispositivo de última generación para radiofrecuencia fraccionada con microagujas. Diseñado para rejuvenecimiento, mejora de texturas, reducción de poros, hiperpigmentación, arrugas y cicatrices.

*Es un combo de dos tecnologías:*

🔷 *EndyMed Intensif:* combina radiofrecuencia fraccionada con microagujas, estimulando la producción natural de colágeno y elastina para una piel firme, elástica y rejuvenecida.

🔷 *EndyMed FSR:* ablación superficial y calentamiento volumétrico simultáneo. Rejuvenece la piel y trata la aspereza, arrugas y cicatrices en la cara.

_Intensif actúa de adentro hacia afuera (ideal para cicatrices profundas), mientras que FSR perfecciona el tono y la textura de la superficie_ ✨

📅 Para este tratamiento recomendamos una consulta previa con la Dra. Sabrina para planificar el protocolo ideal para vos 😊`,

  endyeyes: `👁️ *EndyEyes — EndyMed*

Tratamiento estético no invasivo basado en tecnología de radiofrecuencia 3DEEP® que estimula la producción de colágeno en las capas profundas de la piel.

✨ *Beneficios:*
• Mejora la firmeza del contorno de ojos
• Suaviza líneas finas
• Reduce la flacidez
• Atenúa bolsas y signos de fatiga

El resultado: una mirada más joven, luminosa y descansada 👁️✨
Seguro y apto para todos los tipos de piel.

📅 ¿Te interesa? Te agendamos una consulta para que la Dra. evalúe tu caso 😊`,
};

// ─── KEYWORDS DE TRATAMIENTOS ─────────────────────────────────────────────────
function detectarTratamiento(msg) {
  const n = normalize(msg);
  if (n.includes('alquimia')) return 'alquimia';
  if (n.includes('prp') || n.includes('plasma')) return 'prp';
  if (n.includes('mesoterapia') || n.includes('meso')) return 'mesoterapia';
  if (n.includes('peeling') || n.includes('quimico')) return 'peeling';
  if (n.includes('botox') || n.includes('baby botox') || n.includes('toxina')) return 'botox';
  if (n.includes('endyeyes') || n.includes('endy eyes') || n.includes('ojos')) return 'endyeyes';
  if (n.includes('endymed') || n.includes('intensif') || n.includes('fsr')) return 'endymed';
  if (n.includes('depilacion') || n.includes('depilacion') || n.includes('laser') || n.includes('mediostar')) return 'depilacion';
  if (n.includes('endolift')) return 'endolift';
  if (n.includes('hifu')) return 'hifu';
  if (n.includes('criolipolisis') || n.includes('crioli')) return 'criolipolisis';
  if (n.includes('limpieza facial') || n.includes('limpieza')) return 'limpieza';
  if (n.includes('suero') || n.includes('vitamina')) return 'suero';
  if (n.includes('mesoterapia capilar') || n.includes('caida') || n.includes('pelo') || n.includes('cabello')) return 'capilar';
  return null;
}

function esAltoValor(tratamiento) {
  return ['botox','endymed','endyeyes','endolift','hifu','criolipolisis','prp'].includes(tratamiento);
}

// ─── LOG DE CONSULTAS ─────────────────────────────────────────────────────────
const consultasLog = [];
function logConsulta(nombre, tel, mensaje) {
  consultasLog.push({ ts: new Date().toISOString(), nombre, tel, mensaje });
}

// ─── ESTADO DE CONVERSACIÓN ───────────────────────────────────────────────────
const convState = new Map();
function getConv(jid) {
  const s = convState.get(jid);
  if (s && Date.now() - s.ts > 45 * 60 * 1000) { convState.delete(jid); return null; }
  return s || null;
}
function setConv(jid, step, data = {}) {
  const prev = convState.get(jid);
  convState.set(jid, { step, data: { ...(prev?.data || {}), ...data }, ts: Date.now() });
}
function clearConv(jid) { convState.delete(jid); }

// ─── NOTIFICAR AL EQUIPO ──────────────────────────────────────────────────────
async function notificarEquipo(sock, txt) {
  for (const m of cfg.EQUIPO) {
    await sock.sendMessage(m.wa, { text: txt }).catch(() => {});
  }
}

function saludoHora() {
  const h = new Date().toLocaleString('es-AR', {hour:'numeric', hour12:false, timeZone:'America/Argentina/San_Juan'});
  const n = parseInt(h);
  if (n < 12) return 'Buenos días';
  if (n < 20) return 'Buenas tardes';
  return 'Buenas noches';
}
// ─── FLUJO DE PROSPECCIÓN ─────────────────────────────────────────────────────
async function handleMessage(sock, msg) {
  const jid  = msg.key.remoteJid;
  if (!jid || jid.endsWith('@g.us')) return;

  const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  if (!body) return;

  const n   = normalize(body);
  const num = jid.replace('@s.whatsapp.net', '');

  const data     = loadData();
  const paciente = (data.pacientes || []).find(p => p.tel && p.tel.replace(/\D/g, '').endsWith(num.slice(-8)));
  const nombre   = paciente?.nombre?.split(' ')[0] || '';

  // Loguear para reporte
  logConsulta(paciente?.nombre || '+' + num, num, body);

  const conv = getConv(jid);

  // ── CONFIRMACIÓN DE TURNO ────────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.confirmar)) {
    const turnosPendientes = (data.turnos || []).filter(t =>
      t.estado === 'pendiente' && t.fecha >= today() &&
      (paciente ? t.pacienteId === paciente.id || normalize(t.paciente).includes(normalize(paciente.nombre)) : false)
    );
    if (turnosPendientes.length > 0) {
      const t = turnosPendientes[0];
      await sock.sendMessage(jid, {
        text: `Perfecto${nombre ? ' ' + nombre : ''}, turno confirmado para el ${fmtFecha(t.fecha)} a las ${t.hora}hs. Te esperamos.`,
      });
      await notificarEquipo(sock, `✅ *Turno confirmado*\n👤 ${paciente?.nombre || num}\n📅 ${fmtFecha(t.fecha)} ${t.hora}hs — ${t.servicio || ''}`);
    } else {
      await sock.sendMessage(jid, { text: `Perfecto, quedo a disposicion por cualquier consulta.` });
    }
    clearConv(jid);
    return;
  }

  // ── CANCELACIÓN ─────────────────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.cancelar)) {
    await sock.sendMessage(jid, { text: `No hay problema${nombre ? ' ' + nombre : ''}, cuando puedas coordinar avisame y te busco un turno.` });
    await notificarEquipo(sock, `⚠️ *Cancelación*\n👤 ${paciente?.nombre || '+' + num}\nMensaje: "${body}"`);
    clearConv(jid);
    return;
  }

  // ── HORARIO / UBICACIÓN ──────────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.horario)) {
    await sock.sendMessage(jid, { text: `Atendemos lunes a viernes de 15 a 21hs y sábados de 9 a 15hs. Estamos en el ${cfg.CLINICA.direccion}. ¿Te gustaría que coordinemos un turnito?` });
    return;
  }
  if (matchesAny(body, cfg.KEYWORDS.ubicacion)) {
    await sock.sendMessage(jid, { text: `Estamos en el Pase de Compras de Ayres Village Open Mall, San Juan. Atendemos lunes a viernes 15 a 21hs y sábados 9 a 15hs. ¿Te gustaría que coordinemos un turnito?` });
    return;
  }

  // ── FLUJO PASO A PASO ────────────────────────────────────────────────────────

  // PASO: esperando día/hora para turno
  if (conv?.step === 'esperando_horario') {
    const { tratamiento, tipo } = conv.data;
    const esConsulta = tipo === 'consulta';
    const monto = esConsulta ? PRECIO_CONSULTA : Math.round((conv.data.precio || 0) * 0.20);
    const desc = esConsulta ? `Consulta con Dra. Sabrina Quiroga` : tratamiento;

    await sock.sendMessage(jid, {
      text: `Perfecto, anotamos tu solicitud para ${desc}. Te confirmo el turno a la brevedad y te paso el link de pago para asegurar el lugar.${monto > 0 ? ' El monto a reservar es ' + fmtPeso(monto) + (esConsulta ? ' (se descuenta cuando realizás el tratamiento)' : ' (seña del 20%).') : ''} Quedo a disposicion.`,
    });
    await notificarEquipo(sock, `📅 *Nueva solicitud de turno*\n👤 ${paciente?.nombre || '+' + num}\n📱 +${num}\n🔸 Tratamiento: ${desc}\n🗓️ Preferencia horaria: "${body}"\n${monto > 0 ? `💰 Seña a cobrar: ${fmtPeso(monto)}\n` : ''}⚡ Confirmar y enviar link Naranja X`);
    clearConv(jid);
    return;
  }

  // PASO: esperando si ya hizo tratamientos previos
  if (conv?.step === 'esperando_previos') {
    const { tratamiento } = conv.data;
    const tuvoPrevios = matchesAny(body, ['si','sí','ya me hice','hice','realize','realice','tuve','me hice']);
    setConv(jid, 'esperando_horario', { previos: body });

    if (esAltoValor(tratamiento)) {
      await sock.sendMessage(jid, {
        text: `Comprendo. Para ese tratamiento te recomiendo arrancar con una consulta con la Dra. Sabrina para que evalúe tu caso y te arme el protocolo ideal. El valor de la consulta es $40.000 y ese monto se descuenta del tratamiento cuando lo realizás. ¿Qué día y horario te queda bien? Atendemos lunes a viernes 15 a 21hs y sábados 9 a 15hs.`,
      });
      setConv(jid, 'esperando_horario', { previos: body, tipo: 'consulta', precio: PRECIO_CONSULTA });
    } else {
      await sock.sendMessage(jid, {
        text: `Perfecto${nombre ? ' ' + nombre : ''}. ¿Qué día y horario te queda bien? Atendemos lunes a viernes de 15 a 21hs y sábados de 9 a 15hs.`,
      });
    }
    return;
  }

  // PASO: el paciente respondió qué tratamiento le interesa
  if (conv?.step === 'esperando_tratamiento') {
    const trat = detectarTratamiento(body);

    if (trat && INFO_TRATAMIENTOS[trat]) {
      // Tenemos info del tratamiento — la mandamos
      await sock.sendMessage(jid, { text: INFO_TRATAMIENTOS[trat] });
      await new Promise(r => setTimeout(r, 1200));
      await sock.sendMessage(jid, { text: `¿Ya te realizaste algún tratamiento similar antes, o sería tu primera vez?` });
      setConv(jid, 'esperando_previos', { tratamiento: trat });
    } else if (trat === 'depilacion') {
      await sock.sendMessage(jid, {
        text: `Para depilación definitiva trabajamos con tecnología Monolith Mediostar, láser diodo de última generación, apta para todo tipo de vello y fototipos de piel. Contamos con precio por zona y también combos con descuento. ¿Qué zonas te interesaría tratar?`,
      });
      setConv(jid, 'esperando_previos', { tratamiento: 'depilacion' });
    } else {
      // No detectamos tratamiento específico — preguntamos más
      await sock.sendMessage(jid, {
        text: `Para orientarte mejor, ¿podés contarme qué es lo que te gustaría mejorar o tratar? Así te comento qué opciones tenemos para tu caso.`,
      });
      setConv(jid, 'esperando_previos', { tratamiento: body.slice(0, 50) });
    }
    return;
  }

  // PASO: paciente respondió si es primera vez
  if (conv?.step === 'esperando_primera_vez') {
    const esPrimera = matchesAny(body, ['si','sí','primera vez','primera','nuevo','nueva','nunca','no conozco']);
    setConv(jid, 'esperando_tratamiento');

    if (esPrimera) {
      await sock.sendMessage(jid, {
        text: `Bienvenida/o a One Depil. Somos una clínica médico-estética, trabajamos con la Dra. Sabrina Quiroga y un equipo de profesionales. ¿Tenés algún tratamiento en mente o querés que te cuente las opciones?`,
      });
    } else {
      await sock.sendMessage(jid, {
        text: `Hola${nombre ? ' ' + nombre : ''}, qué bueno que nos escribís. ¿En qué te podemos ayudar?`,
      });
    }
    return;
  }

  // ── INICIO DEL FLUJO (saludo o primer mensaje) ───────────────────────────────
  const esSaludo = matchesAny(body, cfg.KEYWORDS.saludo);
  const quiereTurno = matchesAny(body, cfg.KEYWORDS.turno);
  const quierePrecios = matchesAny(body, cfg.KEYWORDS.precios);
  const quiereServicios = matchesAny(body, cfg.KEYWORDS.servicios);
  const tratamientoDirecto = detectarTratamiento(body);

  // Pregunta directa por un tratamiento específico
  if (tratamientoDirecto && !conv) {
    if (INFO_TRATAMIENTOS[tratamientoDirecto]) {
      await sock.sendMessage(jid, { text: INFO_TRATAMIENTOS[tratamientoDirecto] });
      await new Promise(r => setTimeout(r, 1200));
      await sock.sendMessage(jid, { text: `¿Ya te realizaste algún tratamiento similar antes, o sería tu primera vez?` });
      setConv(jid, 'esperando_previos', { tratamiento: tratamientoDirecto });
    } else if (tratamientoDirecto === 'depilacion') {
      await sock.sendMessage(jid, {
        text: `Para depilación definitiva trabajamos con tecnología Monolith Mediostar, láser diodo de última generación. ¿Qué zonas te interesan tratar?`,
      });
      setConv(jid, 'esperando_previos', { tratamiento: 'depilacion' });
    }
    return;
  }

  if (quiereTurno) {
    await sock.sendMessage(jid, {
      text: `${saludoHora()}${nombre ? ' ' + nombre : ''}. ¿Qué tratamiento o consulta querés hacer?`,
    });
    setConv(jid, 'esperando_tratamiento');
    return;
  }

  if (quierePrecios) {
    await sock.sendMessage(jid, {
      text: `Los valores dependen del tratamiento y la zona a tratar. ¿Sobre qué tratamiento querés consultar?`,
    });
    setConv(jid, 'esperando_tratamiento');
    return;
  }

  if (quiereServicios) {
    await sock.sendMessage(jid, {
      text: `En One Depil realizamos: depilación definitiva (Monolith Mediostar), Botox y Baby Botox, Endolift facial y corporal, Endymed Intensif + FSR, EndyEyes, HIFU, Criolipolisis, Ultracavitación, Mesoterapia, PRP, Limpiezas faciales, Peeling, Alquimia, Suero terapias, Descenso de peso y Ginecología. ¿Hay alguno en particular sobre el que quieras información?`,
    });
    setConv(jid, 'esperando_tratamiento');
    return;
  }

  // PASO: recibimos nombre/DNI y buscamos en la base
  if (conv?.step === 'esperando_identificacion') {
    // Buscar por teléfono (ya lo tenemos del JID) o por nombre ingresado
    const nombreIngresado = body.trim();
    const encontrado = paciente || (data.pacientes || []).find(p =>
      normalize(p.nombre).includes(normalize(nombreIngresado)) ||
      (p.tel && p.tel.replace(/\D/g,'').includes(nombreIngresado.replace(/\D/g,'')))
    );

    if (encontrado) {
      const primerNombre = encontrado.nombre.split(' ')[0];
      const tratamientosPrevios = encontrado.antecedentes || encontrado.notas || '';
      const ventas = encontrado.ventas ? ` Historial de tratamientos en la clínica: $${Number(encontrado.ventas).toLocaleString('es-AR')}.` : '';

      // Notificar al equipo que es paciente conocido
      await notificarEquipo(sock, `👤 *Paciente reconocida/o*\n*${encontrado.nombre}* (+${num})\n📱 Tel registrado: ${encontrado.tel || '-'}${ventas}\n🔔 Está consultando por WhatsApp`);

      await sock.sendMessage(jid, {
        text: `${saludoHora()} ${primerNombre}, te habla Aldana de One Depil.${tratamientosPrevios ? ' Vi que ya estuviste con nosotros.' : ''} ¿En qué te puedo ayudar?`,
      });
      setConv(jid, 'esperando_tratamiento', { pacienteEncontrado: encontrado, previos: tratamientosPrevios });
    } else {
      // Paciente nuevo
      await sock.sendMessage(jid, {
        text: `${saludoHora()}${nombreIngresado ? ' ' + nombreIngresado : ''}, te habla Aldana de One Depil. Bienvenida/o. ¿Sobre qué tratamiento querés consultar?`,
      });
      setConv(jid, 'esperando_tratamiento', { nombreIngresado });
    }
    return;
  }

  if (esSaludo || !conv) {
    // Si ya lo reconocemos por teléfono, saltamos la identificación
    if (paciente) {
      const primerNombre = paciente.nombre.split(' ')[0];
      await sock.sendMessage(jid, {
        text: `${saludoHora()} ${primerNombre}, te habla Aldana de One Depil. ¿En qué te puedo ayudar?`,
      });
      setConv(jid, 'esperando_tratamiento', { pacienteEncontrado: paciente });
    } else {
      await sock.sendMessage(jid, {
        text: `${saludoHora()}, te habla Aldana de One Depil. ¿Me decís tu nombre y apellido para buscarte en nuestro sistema?`,
      });
      setConv(jid, 'esperando_identificacion');
    }
    return;
  }
}

// ─── RECORDATORIOS ───────────────────────────────────────────────────────────
function generarRecordatorio(turno, paciente) {
  const nombre = (paciente?.nombre || turno.paciente || '').split(' ')[0];
  return (
    `Hola ${nombre}! 😊 Te escribo de *ONE DEPIL* para recordarte tu turno de *mañana*:\n\n` +
    `📅 *${fmtFecha(turno.fecha)} a las ${turno.hora}hs*\n` +
    `💆 ${turno.servicio || 'Tratamiento'}\n` +
    `📍 ${cfg.CLINICA.direccion}\n\n` +
    `¿Podés confirmarme que vas a venir? Respondé *CONFIRMO* ✅ o *CANCELO* si no podés 🙏`
  );
}

function generarBriefing(data) {
  const hoy = today();
  const turnosHoy = (data.turnos || [])
    .filter(t => t.fecha === hoy && t.estado !== 'cancelado')
    .sort((a, b) => a.hora.localeCompare(b.hora));

  const fechaStr = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/San_Juan' });
  let txt = `🌸 *ONE DEPIL — Agenda del ${fechaStr}*\n\n`;
  if (turnosHoy.length === 0) {
    txt += 'Sin turnos agendados para hoy.\n';
  } else {
    txt += `📅 *${turnosHoy.length} turno(s):*\n`;
    turnosHoy.forEach(t => { txt += `  • ${t.hora}hs — ${t.paciente} — ${t.servicio || '?'}\n`; });
  }
  const deudas = (data.cobros || []).filter(c => c.estado !== 'pagado' && (c.saldo || 0) > 0);
  if (deudas.length) {
    const total = deudas.reduce((a, c) => a + (c.saldo || 0), 0);
    txt += `\n💰 Cobros pendientes: ${fmtPeso(total)} (${deudas.length} pacientes)\n`;
  }
  txt += `\n¡Buen día a todo el equipo! ✨`;
  return txt;
}

// ─── CRONS ───────────────────────────────────────────────────────────────────
function iniciarCrons(sock) {
  // Recordatorios diarios a los pacientes
  cron.schedule(cfg.CRON_RECORDATORIOS, async () => {
    const data   = loadData();
    const manana = tomorrow();
    const turnos = (data.turnos || []).filter(t => t.fecha === manana && t.estado !== 'cancelado');
    console.log(`[CRON] Recordatorios: ${turnos.length} turno(s)`);
    for (const turno of turnos) {
      const pac = (data.pacientes || []).find(p => p.id === turno.pacienteId);
      const tel = pac?.tel || turno.tel;
      if (!tel) continue;
      const num = tel.replace(/\D/g, '');
      try {
        await sock.sendMessage(`${num}@s.whatsapp.net`, { text: generarRecordatorio(turno, pac) });
        await new Promise(r => setTimeout(r, 1500));
      } catch (e) { console.error('[CRON] Error recordatorio:', e.message); }
    }
  }, { timezone: 'America/Argentina/San_Juan' });

  // Briefing matutino al equipo
  cron.schedule(cfg.CRON_BRIEFING, async () => {
    const data = loadData();
    const txt  = generarBriefing(data);
    for (const m of cfg.EQUIPO) {
      await sock.sendMessage(m.wa, { text: txt }).catch(() => {});
    }
    console.log('[CRON] Briefing enviado');
  }, { timezone: 'America/Argentina/San_Juan' });

  // Reporte de consultas cada 30 min — lunes a sábado de 10 a 21hs
  cron.schedule(cfg.CRON_REPORTE, async () => {
    if (consultasLog.length === 0) return;
    const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/San_Juan' });
    let txt = `📋 *ONE DEPIL — Resumen ${hora}hs*\n\n*${consultasLog.length} consulta(s) en los últimos 30 min:*\n\n`;
    consultasLog.forEach((c, i) => {
      const h = new Date(c.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/San_Juan' });
      txt += `${i + 1}. *${c.nombre}* (+${c.tel}) — ${h}hs\n   _"${c.mensaje.slice(0, 80)}"_\n\n`;
    });
    txt += `_Respondé directamente al número de cada paciente._`;
    consultasLog.length = 0;
    for (const m of cfg.EQUIPO) {
      await sock.sendMessage(m.wa, { text: txt }).catch(() => {});
    }
    console.log('[CRON] Reporte enviado');
  }, { timezone: 'America/Argentina/San_Juan' });

  console.log('[CRON] Recordatorios:', cfg.CRON_RECORDATORIOS);
  console.log('[CRON] Briefing:', cfg.CRON_BRIEFING);
  console.log('[CRON] Reporte consultas:', cfg.CRON_REPORTE);
}

// ─── CONEXIÓN ────────────────────────────────────────────────────────────────
async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version, auth: state, logger,
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
      console.log('\n✅ Aldana (bot ONE DEPIL) conectada!');
      iniciarCrons(sock);
      sock.sendMessage(cfg.ADMIN_WA, {
        text: `✅ *Aldana online — ONE DEPIL*\n\nBot conectado y listo para atender consultas 🌸\n\n• Recordatorios: ${cfg.CRON_RECORDATORIOS}\n• Briefing: ${cfg.CRON_BRIEFING}\n• Reportes: cada 30 min de 10 a 21hs`,
      }).catch(() => {});
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconectar = code !== DisconnectReason.loggedOut;
      console.log(`⚠️  Conexión cerrada (código ${code}). Reconectando: ${reconectar}`);
      if (reconectar) setTimeout(conectar, 5000);
      else console.log('Sesión cerrada. Borrá auth_info y reiniciá.');
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

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
console.log('🌸 ONE DEPIL — Aldana (Bot de WhatsApp)');
console.log('   ' + cfg.CLINICA.direccion);
console.log('');
conectar().catch(console.error);
