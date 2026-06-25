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
  alquimia: `El Alquimia es un peeling médico de última generación que combina distintos activos en fases para renovar la piel de forma profunda y progresiva. Lo que más les gusta a las pacientes es que desde la primera sesión se nota un cambio real: la piel queda más luminosa, pareja, sin manchas y mucho más suave.

Lo realiza la Dra. Sabrina con protocolo médico, así que es seguro y personalizado. ¿Ya te hiciste algún peeling antes o sería la primera vez?`,

  prp: `El PRP — Plasma Rico en Plaquetas — es un tratamiento 100% natural porque se trabaja con tu propia sangre. Se extrae una muestra, se procesa y se obtiene un concentrado con factores de crecimiento que regeneran la piel y estimulan el crecimiento del cabello.

Para la piel deja un efecto de luminosidad y firmeza muy bueno. Para la caída de cabello es de los más efectivos que hay. Y al ser autólogo no hay riesgo de rechazo.

¿Lo consultás para rostro o para cabello?`,

  mesoterapia: `La mesoterapia son microinyecciones de vitaminas, aminoácidos y activos específicos según lo que necesites. Sirve para flacidez, celulitis, caída de cabello, grasa localizada... los resultados se ven bastante rápido, desde las primeras sesiones.

Lo aplica la Dra. Sabrina. ¿Qué es lo que querés tratar?`,

  peeling: `El peeling químico renueva las capas superficiales de la piel. Mejora manchas, cicatrices de acné, poros dilatados y arrugas finas. La Dra. Sabrina evalúa tu tipo de piel y elige el peeling más adecuado para vos.

¿Ya te hiciste alguno antes o sería la primera vez?`,

  botox: `El Botox relaja temporalmente los músculos que forman las líneas de expresión — frente, entrecejo, patas de gallo. Es rápido, sin cirugía y con recuperación prácticamente inmediata. Lo que más valoran las pacientes es que queda natural, no da cara rígida.

Lo hace la Dra. Sabrina. Para este tratamiento recomendamos arrancar con una consulta para que te evalúe y te diga exactamente qué necesitás. ¿Te interesa que coordinemos eso?`,

  endymed: `El Endymed Intensif + FSR es radiofrecuencia fraccionada con microagujas — una de las tecnologías más avanzadas que hay para rejuvenecimiento. Combina dos tecnologías: el Intensif trabaja desde adentro estimulando colágeno (ideal para cicatrices y flacidez profunda), y el FSR perfecciona la superficie, textura y poros.

El resultado es piel más firme, pareja y rejuvenecida. Para este tratamiento la Dra. Sabrina te hace una consulta primero para armar el protocolo ideal para tu caso. ¿Qué es lo que querés mejorar?`,

  endyeyes: `El EndyEyes es el tratamiento de radiofrecuencia específico para el contorno de ojos. Estimula el colágeno en las capas profundas, mejora la firmeza, suaviza las líneas finas y reduce bolsas. La mirada queda mucho más descansada y rejuvenecida.

Es no invasivo, seguro para todo tipo de piel. ¿Consultas para ese tratamiento o querés info de algo más?`,

  endolift: `El Endolift es un tratamiento mínimamente invasivo con tecnología de hilo de luz Velas — básicamente un láser intradérmico que calienta y contrae los tejidos desde adentro, sin cirugía. Tensa la piel, define el óvalo facial, mejora la flacidez del cuello y también se puede hacer en cuerpo.

Los resultados son muy naturales y progresivos. Para este tratamiento la Dra. Sabrina hace una valoración previa para ver si es lo indicado para vos. ¿Querés que coordinemos eso?`,

  hifu: `El HIFU usa ultrasonido enfocado de alta intensidad para tensar la piel sin ninguna aguja ni corte. Llega a capas profundas que otros tratamientos no alcanzan, estimula el colágeno y el resultado es lifting progresivo durante los meses siguientes.

Se usa mucho para flacidez del rostro, cuello y papada. La Dra. Sabrina te hace una evaluación antes para ver el protocolo ideal. ¿Lo consultás para zona facial?`,

  criolipolisis: `La criolipólisis congela y elimina células grasas de forma definitiva en zonas específicas — panza, flancos, cartucheras, espalda. No es cirugía, no hay recuperación. El cuerpo va eliminando esas células de forma natural durante los meses siguientes.

Es ideal para esas zonas donde la dieta y el ejercicio no terminan de resolver. ¿Qué zona te interesa tratar?`,

  depilacion: `Para depilación definitiva trabajamos con Monolith Mediostar, que es tecnología láser diodo de última generación. Es la que mejores resultados da y es apta para todo tipo de vello y fototipo de piel.

Tenemos precio por zona y combos con descuento. ¿Qué zonas te interesaría tratar?`,

  limpieza: `La limpieza facial profunda combina vaporización, extracción, alta frecuencia y tratamiento final según tu tipo de piel. Deja la piel descongesionada, los poros limpios y mucho más luminosa.

Está buena hacerla cada 30-45 días como mantenimiento. ¿Cuándo fue la última vez que te hiciste una?`,

  suero: `Los sueros terapéuticos son tratamientos con vitaminas y nutrientes que se aplican de forma endovenosa. Los hace el Dr. Antuña. Hay distintos protocolos según lo que necesites — energía, defensas, hidratación, antioxidante.

¿Querés que te cuente más de alguno en particular?`,

  capilar: `Para caída y fortalecimiento del cabello tenemos mesoterapia capilar con microinyecciones de activos directamente en el cuero cabelludo, y también PRP capilar que es con tu propio plasma.

Los dos tienen muy buenos resultados. ¿Tenés diagnóstico previo o sería la primera consulta?`,
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
      await sock.sendMessage(jid, { text: INFO_TRATAMIENTOS[trat] });
      setConv(jid, 'esperando_previos', { tratamiento: trat });
    } else {
      await sock.sendMessage(jid, {
        text: `Contame un poco más — ¿qué es lo que querés mejorar o tratar? Así te oriento mejor.`,
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

  // ── DETECCIÓN DE TRATAMIENTO (siempre tiene prioridad) ──────────────────────
  const tratamientoDirecto = detectarTratamiento(body);
  if (tratamientoDirecto) {
    if (INFO_TRATAMIENTOS[tratamientoDirecto]) {
      await sock.sendMessage(jid, { text: INFO_TRATAMIENTOS[tratamientoDirecto] });
      setConv(jid, 'esperando_previos', { tratamiento: tratamientoDirecto });
    } else {
      await sock.sendMessage(jid, {
        text: `${saludoHora()}${nombre ? ' ' + nombre : ''}, te habla Aldana de One Depil. Consultame lo que necesitás que te ayudo.`,
      });
      setConv(jid, 'esperando_tratamiento');
    }
    return;
  }

  // ── INICIO DEL FLUJO (saludo o primer mensaje) ───────────────────────────────
  const esSaludo = matchesAny(body, cfg.KEYWORDS.saludo);
  const quiereTurno = matchesAny(body, cfg.KEYWORDS.turno);
  const quierePrecios = matchesAny(body, cfg.KEYWORDS.precios);
  const quiereServicios = matchesAny(body, cfg.KEYWORDS.servicios);

  if (quiereTurno) {
    await sock.sendMessage(jid, {
      text: `${saludoHora()}${nombre ? ' ' + nombre : ''}. ¿Qué tratamiento o consulta querés hacer?`,
    });
    setConv(jid, 'esperando_tratamiento');
    return;
  }

  if (quierePrecios) {
    await sock.sendMessage(jid, {
      text: `Los valores dependen del tratamiento y la zona. ¿Sobre qué tratamiento querés consultar?`,
    });
    setConv(jid, 'esperando_tratamiento');
    return;
  }

  if (quiereServicios) {
    await sock.sendMessage(jid, {
      text: `Hacemos depilación definitiva con láser Monolith Mediostar, Botox, Endolift, Endymed Intensif+FSR, EndyEyes, HIFU, Criolipolisis, Mesoterapia, PRP, Peeling, Alquimia, Limpiezas faciales, Suero terapias y también Ginecología y Descenso de peso. ¿Hay alguno en particular que te interesa?`,
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

// ─── CIERRE FINANCIERO ───────────────────────────────────────────────────────
function generarCierreFinanciero(data) {
  const hoy = today();
  const turnosHoy = (data.turnos || []).filter(t => t.fecha === hoy && t.estado !== 'cancelado');
  const fechaStr = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Argentina/San_Juan' });

  let totalCobrado = 0;
  let totalPendiente = 0;

  let txt = `*ONE DEPIL — Cierre del ${fechaStr}*\n\n`;

  if (turnosHoy.length === 0) {
    txt += 'Sin turnos registrados hoy.\n';
  } else {
    txt += `*${turnosHoy.length} turno(s):*\n\n`;
    turnosHoy.forEach((t, i) => {
      const cobro = (data.cobros || []).find(c => c.turnoId === t.id || (c.pacienteId === t.pacienteId && c.fecha === hoy));
      const monto = cobro?.monto || t.precio || 0;
      const estado = cobro?.estado || 'sin registrar';
      const metodo = cobro?.metodo || '-';
      const cuotas = cobro?.cuotas ? ` (${cobro.cuotas} cuotas)` : '';
      const saldo = cobro?.saldo || 0;

      if (cobro?.estado === 'pagado' || cobro?.estado === 'cobrado') totalCobrado += monto;
      else if (monto > 0) totalPendiente += saldo || monto;

      txt += `${i + 1}. *${t.paciente || '?'}* — ${t.hora}hs\n`;
      txt += `   Tratamiento: ${t.servicio || '-'}\n`;
      txt += `   Monto: ${fmtPeso(monto)}${cuotas}\n`;
      txt += `   Cobro: ${estado}${metodo !== '-' ? ' · ' + metodo : ''}\n`;
      if (saldo > 0) txt += `   Saldo pendiente: ${fmtPeso(saldo)}\n`;
      txt += '\n';
    });
  }

  txt += `─────────────────────\n`;
  txt += `Cobrado hoy: *${fmtPeso(totalCobrado)}*\n`;
  if (totalPendiente > 0) txt += `Pendiente de cobro: *${fmtPeso(totalPendiente)}*\n`;

  // cobros con cuotas vencidas de cualquier fecha
  const enCuotas = (data.cobros || []).filter(c => c.cuotas && c.saldo > 0 && c.estado !== 'pagado');
  if (enCuotas.length > 0) {
    txt += `\nPacientes con cuotas pendientes: ${enCuotas.length}`;
  }

  return txt;
}

function generarAlertaDeudores(data) {
  const enCuotas = (data.cobros || []).filter(c => c.cuotas && c.saldo > 0 && c.estado !== 'pagado');
  if (enCuotas.length === 0) return null;

  let txt = `*ONE DEPIL — Deudores con cuotas pendientes*\n\n`;
  enCuotas.forEach((c, i) => {
    const pac = (data.pacientes || []).find(p => p.id === c.pacienteId);
    const nombre = pac?.nombre || c.paciente || 'Paciente sin nombre';
    const tel = pac?.tel || c.tel || '-';
    txt += `${i + 1}. *${nombre}*\n`;
    txt += `   Tel: ${tel}\n`;
    txt += `   Tratamiento: ${c.servicio || '-'}\n`;
    txt += `   Saldo: ${fmtPeso(c.saldo)} (${c.cuotas} cuotas)\n\n`;
  });
  txt += `Comunicarse con cada uno para coordinar el pago.`;
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

  // Cierre financiero diario — 21:15hs, solo a DIRECCION (no Aldana)
  cron.schedule(cfg.CRON_CIERRE, async () => {
    const data = loadData();
    const txt  = generarCierreFinanciero(data);
    for (const m of cfg.DIRECCION) {
      await sock.sendMessage(m.wa, { text: txt }).catch(() => {});
    }
    console.log('[CRON] Cierre financiero enviado a DIRECCION');
  }, { timezone: 'America/Argentina/San_Juan' });

  // Alerta deudores — lunes 10am, solo a Aldana
  cron.schedule(cfg.CRON_DEUDORES, async () => {
    const data = loadData();
    const txt  = generarAlertaDeudores(data);
    if (!txt) { console.log('[CRON] Deudores: sin pendientes'); return; }
    await sock.sendMessage(cfg.ALDANA_WA, { text: txt }).catch(() => {});
    console.log('[CRON] Alerta deudores enviada a Aldana');
  }, { timezone: 'America/Argentina/San_Juan' });

  cron.schedule(cfg.CRON_SEMANAL_PROFS, async () => {
    const data = loadData();
    const ahora = new Date();
    // próxima semana: lunes a sábado
    const diasSemana = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const inicio = new Date(ahora);
    inicio.setDate(ahora.getDate() + 1); // mañana (lunes)
    inicio.setHours(0, 0, 0, 0);
    const fin = new Date(inicio);
    fin.setDate(inicio.getDate() + 5); // hasta sábado inclusive
    fin.setHours(23, 59, 59, 999);

    for (const prof of cfg.PROFESIONALES) {
      const turnosProf = (data.turnos || []).filter(t => {
        const fecha = new Date(t.fecha);
        return fecha >= inicio && fecha <= fin && (t.profId === prof.profId || (t.profesional || '').includes(prof.nombre.split(' ').slice(-1)[0]));
      }).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

      if (!turnosProf.length) continue;

      let txt = `📅 *Turnos semana del ${inicio.toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit'})} al ${fin.toLocaleDateString('es-AR', {day:'2-digit',month:'2-digit'})}*\n`;
      txt += `_${prof.nombre}_\n\n`;

      const agrupados = {};
      for (const t of turnosProf) {
        const f = new Date(t.fecha);
        const key = f.toLocaleDateString('es-AR', { weekday:'long', day:'2-digit', month:'2-digit' });
        if (!agrupados[key]) agrupados[key] = [];
        agrupados[key].push(t);
      }

      for (const [dia, ts] of Object.entries(agrupados)) {
        txt += `*${dia.charAt(0).toUpperCase() + dia.slice(1)}*\n`;
        for (const t of ts) {
          const h = new Date(t.fecha).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
          txt += `  • ${h} — ${t.paciente || 'Paciente'} (${t.tratamiento || t.servicio || 'Turno'})\n`;
        }
        txt += '\n';
      }

      txt += `_ONE DEPIL • ${cfg.CLINICA.horario}_`;
      await sock.sendMessage(prof.wa, { text: txt }).catch(() => {});
      console.log(`[CRON] Reporte semanal enviado a ${prof.nombre}`);
    }
  }, { timezone: 'America/Argentina/San_Juan' });

  console.log('[CRON] Recordatorios:', cfg.CRON_RECORDATORIOS);
  console.log('[CRON] Briefing:', cfg.CRON_BRIEFING);
  console.log('[CRON] Reporte consultas:', cfg.CRON_REPORTE);
  console.log('[CRON] Cierre financiero:', cfg.CRON_CIERRE);
  console.log('[CRON] Alerta deudores:', cfg.CRON_DEUDORES);
  console.log('[CRON] Reporte semanal profesionales:', cfg.CRON_SEMANAL_PROFS);
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
