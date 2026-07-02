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

// Duración en minutos por tratamiento
const DURACION = {
  consulta: 30, depilacion: 60, botox: 45, endolift: 90, endymed: 60,
  endyeyes: 45, hifu: 60, criolipolisis: 90, mesoterapia: 45, prp: 60,
  limpieza: 60, peeling: 45, alquimia: 60, encurve: 45, cmslim: 45,
  suero: 60, capilar: 45, masajes: 60, ginecologia: 30, endocrinologia: 30,
};

// Slots de trabajo por día de semana (0=Dom, 1=Lun ... 6=Sáb)
const SLOTS_DIA = {
  1: ['15:00','16:00','17:00','18:00','19:00','20:00'], // lunes
  2: ['15:00','16:00','17:00','18:00','19:00','20:00'],
  3: ['15:00','16:00','17:00','18:00','19:00','20:00'],
  4: ['15:00','16:00','17:00','18:00','19:00','20:00'],
  5: ['15:00','16:00','17:00','18:00','19:00','20:00'], // viernes
  6: ['09:00','10:00','11:00','12:00','13:00','14:00'], // sábado
};

function getSlotsDisponibles(tratamiento, data, cantMax = 4) {
  const durMin = DURACION[tratamiento] || 60;
  const slotsLibres = [];
  const ahora = new Date();

  for (let dia = 1; dia <= 10 && slotsLibres.length < cantMax; dia++) {
    const fecha = new Date(ahora);
    fecha.setDate(ahora.getDate() + dia);
    const dow = fecha.getDay(); // 0=dom
    const slotsDelDia = SLOTS_DIA[dow];
    if (!slotsDelDia) continue;

    const fechaStr = fecha.toISOString().slice(0, 10);
    const turnosDia = (data.turnos || []).filter(t => t.fecha === fechaStr);

    for (const slot of slotsDelDia) {
      const [h, m] = slot.split(':').map(Number);
      // Ver si este slot choca con algún turno existente
      const slotInicio = h * 60 + m;
      const slotFin = slotInicio + durMin;
      const ocupado = turnosDia.some(t => {
        const [th, tm] = (t.hora || '00:00').split(':').map(Number);
        const tInicio = th * 60 + tm;
        const tDur = DURACION[t.tratamiento] || DURACION[t.servicio] || 60;
        const tFin = tInicio + tDur;
        return slotInicio < tFin && slotFin > tInicio;
      });
      // No ofrecer slots que ya pasaron hoy
      if (!ocupado) {
        const DIAS_ES = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
        slotsLibres.push({
          fecha: fechaStr,
          hora: slot,
          label: `${DIAS_ES[dow]} ${fecha.getDate()}/${fecha.getMonth()+1} a las ${slot}hs`,
        });
        if (slotsLibres.length >= cantMax) break;
      }
    }
  }
  return slotsLibres;
}

// ─── INFO DE TRATAMIENTOS ─────────────────────────────────────────────────────
const INFO_TRATAMIENTOS = {
  alquimia: `Mirá, el Alquimia es uno de los favoritos de nuestras pacientes. Es un peeling médico que trabaja en varias fases para renovar la piel de forma profunda — desde la primera sesión se nota diferencia real: piel más luminosa, pareja, sin manchas.

Lo hace la Dra. Sabrina con protocolo personalizado según tu piel. ¿Ya te hiciste algún peeling antes o sería la primera vez?`,

  prp: `El PRP es buenísimo y muy valorado porque es 100% natural — se trabaja con tu propia sangre, así que no hay riesgo de ningún tipo.

Se usa mucho para dos cosas: rejuvenecer el rostro (firmeza, luminosidad) y tratar la caída de cabello. En capilar es de los tratamientos más efectivos que hay. ¿Lo consultás para rostro o para cabello?`,

  mesoterapia: `La mesoterapia funciona muy bien para flacidez, celulitis, caída de cabello o grasa localizada. Son microinyecciones de vitaminas y activos específicos según lo que necesites — resultados se empiezan a ver bastante rápido.

Lo aplica la Dra. Sabrina. ¿Qué zona o qué es lo que querés tratar?`,

  peeling: `El peeling químico renueva la piel y mejora manchas, poros dilatados, cicatrices de acné y arrugas finas. La Dra. Sabrina evalúa tu tipo de piel y elige la fórmula exacta para vos — no es algo genérico.

¿Ya te hiciste alguno antes o sería la primera vez?`,

  botox: `El Botox relaja los músculos que forman arrugas de expresión — frente, entrecejo, patas de gallo. Lo que más valoran las pacientes es que queda totalmente natural, no da cara rígida cuando está bien aplicado.

Lo hace la Dra. Sabrina. Para este tratamiento arrancamos con una consulta para que te evalúe y te diga exactamente qué necesitás y cuánto. La consulta son $40.000 que se descuentan del tratamiento. ¿Te interesa que coordinemos eso?`,

  endymed: `El Endymed Intensif + FSR es de las tecnologías más avanzadas para rejuvenecimiento. Combina radiofrecuencia fraccionada con microagujas — el Intensif trabaja en profundidad estimulando colágeno (ideal para flacidez y cicatrices), y el FSR afina textura y poros.

El resultado es piel notoriamente más firme y pareja. La Dra. Sabrina te hace una consulta previa para armar el protocolo ideal para tu caso. ¿Qué es lo que querés mejorar?`,

  endyeyes: `El EndyEyes es radiofrecuencia específica para el contorno de ojos — estimula colágeno, mejora firmeza, suaviza líneas finas y reduce bolsas. La mirada queda mucho más descansada y rejuvenecida.

No invasivo, sin agujas, seguro para todo tipo de piel. ¿Te interesa coordinar un turno para verlo?`,

  endolift: `El Endolift es mínimamente invasivo — usa un hilo de luz láser intradérmico que calienta y contrae los tejidos desde adentro, sin cirugía. Tensa la piel, define el óvalo facial, mejora la flacidez del cuello. Los resultados son muy naturales y progresivos.

Para este tratamiento la Dra. Sabrina hace una valoración previa para ver si es lo indicado para vos. La consulta son $40.000 que se descuentan después. ¿Querés que coordinemos esa consulta?`,

  hifu: `El HIFU es básicamente un lifting sin agujas ni cirugía — usa ultrasonido enfocado que llega a capas profundas de la piel que otros tratamientos no alcanzan. Estimula colágeno y el resultado es un lifting progresivo que se va notando durante los meses siguientes.

Ideal para flacidez del rostro, cuello y papada. La Dra. Sabrina te evalúa primero para ver el protocolo ideal. ¿Lo consultás para zona facial?`,

  criolipolisis: `La criolipólisis congela células de grasa de forma definitiva — el cuerpo las elimina naturalmente durante las semanas siguientes. Sin cirugía, sin recuperación, sin dolor.

Es ideal para esas zonas donde la dieta y el ejercicio no terminan de resolver: panza, flancos, cartucheras, espalda. ¿Qué zona te interesa tratar?`,

  depilacion: `Para depilación definitiva trabajamos con el Monolith Mediostar — tecnología láser diodo de última generación, apta para todo tipo de piel y vello.

Tenemos precio por zona y combos con descuento para quienes hacen varias zonas juntas. ¿Qué zonas te interesaría tratar?`,

  limpieza: `La limpieza facial profunda deja la piel descongesionada, los poros limpios y muy luminosa — combina vaporización, extracción, alta frecuencia y tratamiento final según tu tipo de piel.

Está muy buena hacerla cada 30-45 días como mantenimiento. ¿Cuándo fue la última vez que te hiciste una?`,

  suero: `Los sueros terapéuticos son vitaminas y nutrientes que se aplican de forma endovenosa — efecto muy notorio en energía, defensas, hidratación o antioxidante según el protocolo. Los hace el Dr. Antuña.

¿Querés que te cuente los distintos tipos o coordinamos una consulta directamente?`,

  capilar: `Para caída y fortalecimiento del cabello tenemos dos opciones muy buenas: mesoterapia capilar (microinyecciones de activos en el cuero cabelludo) y PRP capilar (con tu propio plasma). Los dos dan muy buenos resultados.

¿Tenés diagnóstico previo o sería la primera consulta?`,

  encurve: `El enCurve reduce grasa localizada y remodela el cuerpo con radiofrecuencia sin contacto — calienta las células de grasa para que el cuerpo las elimine naturalmente, sin ningún tipo de cirugía ni dolor.

Funciona muy bien para panza, flancos y cartucheras. Los cambios se empiezan a notar desde las primeras sesiones. ¿Qué zona te interesa?`,

  cmslim: `El CM Slim es el tratamiento ideal si querés tonificar y reducir al mismo tiempo — combina campos electromagnéticos con radiofrecuencia, haciendo el equivalente a miles de contracciones musculares en una sola sesión.

Buenísimo para abdomen, glúteos, brazos y piernas. ¿Qué zona querés trabajar?`,

  masajes: `Hacemos masajes terapéuticos para contracturas y dolor muscular, y masajes modeladores con técnicas de drenaje linfático y reducción de medidas. Son muy buenos para complementar tratamientos estéticos.

¿Estás pensando en algo terapéutico o más para modelar el cuerpo?`,

  ginecologia: `El Dr. Andrés Echegaray atiende consultas ginecológicas en la clínica — controles, consultas o lo que necesites.

La consulta tiene un valor de $40.000. ¿Querés que te busque un turno disponible?`,

  endocrinologia: `La Dra. Laura Otiñano atiende endocrinología y descenso de peso — metabolismo, tiroides, diabetes, o seguimiento médico para bajar de peso de forma segura y sostenida.

La consulta son $40.000. ¿Querés que coordinemos un turno?`,

  estetica: `El Dr. Rolando Ribaudo atiende consultas de estética médica — evaluación de tratamientos, indicación de procedimientos y seguimiento general. Ideal si no sabés por dónde empezar o querés una orientación médica completa.

La consulta son $40.000. ¿Querés que coordinemos?`,
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
  if (n.includes('encurve') || n.includes('en curve')) return 'encurve';
  if (n.includes('cmslim') || n.includes('cm slim') || n.includes('electro') || n.includes('slim')) return 'cmslim';
  if (n.includes('masaje')) return 'masajes';
  if (n.includes('ginecolog') || n.includes('gineco')) return 'ginecologia';
  if (n.includes('endocrinolog') || n.includes('descenso de peso') || n.includes('adelgazar') || n.includes('bajar de peso')) return 'endocrinologia';
  if (n.includes('ribaudo') || n.includes('estetica medica') || n.includes('consulta estetica') || n.includes('consulta medica')) return 'estetica';
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

// ─── CONTROL HUMANO ──────────────────────────────────────────────────────────
// Cuando un operador humano responde manualmente, el bot se silencia 2hs
const HUMANO_TIMEOUT = 2 * 60 * 60 * 1000; // 2 horas
const humanControl = new Map(); // jid → timestamp del último mensaje humano
const botMsgIds = new Set();    // IDs de mensajes enviados por el bot

function marcarMensajeBot(msgId) { botMsgIds.add(msgId); }
function humanoCargo(jid) { humanControl.set(jid, Date.now()); }
function humanActivo(jid) {
  const ts = humanControl.get(jid);
  if (!ts) return false;
  if (Date.now() - ts > HUMANO_TIMEOUT) { humanControl.delete(jid); return false; }
  return true;
}
function liberarHumano(jid) { humanControl.delete(jid); }

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

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
// ─── CONFIRMAR TURNO Y PEDIR SEÑA ────────────────────────────────────────────
async function confirmarTurnoConSena(sock, jid, paciente, num, horario, desc, monto, profIdTurno=null) {
  const montoTexto = fmtPeso(monto);
  const esConsulta = desc.toLowerCase().includes('consulta');
  const notaDescuento = esConsulta ? '\n_(Este monto se descuenta del tratamiento que arranques después.)_' : '';
  await botSend(sock, jid, {
    text: `Genial! Anoto tu turno para *${desc}* — *${horario}* ✅\n\nPara reservar el lugar te pedimos una seña de *${montoTexto}*.${notaDescuento}\n\nTransferís al alias:\n👉 *${cfg.ALIAS_PAGO}*\n\nCuando hagas la transferencia mandame el comprobante acá y queda confirmado 🙌`,
  });
  await notificarEquipo(sock, `📅 *Nueva solicitud de turno*\n👤 ${paciente?.nombre || '+' + num}\n📱 +${num}\n🔸 ${desc}\n🗓️ ${horario}\n💰 Seña: ${montoTexto}\n⏳ Esperando comprobante`);
  convState.set(jid, { step: 'esperando_comprobante', data: { desc, monto, profIdTurno }, ts: Date.now() });
}

// ─── ENVÍO REGISTRADO (para distinguir bot vs humano) ────────────────────────
async function botSend(sock, jid, content) {
  const sent = await sock.sendMessage(jid, content);
  if (sent?.key?.id) marcarMensajeBot(sent.key.id);
  return sent;
}

// ─── FLUJO DE PROSPECCIÓN ─────────────────────────────────────────────────────
async function handleMessage(sock, msg) {
  const jid  = msg.key.remoteJid;
  if (!jid || jid.endsWith('@g.us')) return;

  const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
  const tieneImagen = !!(msg.message?.imageMessage || msg.message?.documentMessage);
  if (!body && !tieneImagen) return;

  // Si un humano tomó el control, el bot no interviene
  if (humanActivo(jid)) {
    console.log(`🤫 [BOT] Silenciado en ${jid} — operador humano activo`);
    return;
  }

  const num = jid.replace('@s.whatsapp.net', '');
  const data = loadData();

  // Paciente por teléfono O por nombre guardado en conv
  const conv = getConv(jid);
  let paciente = (data.pacientes || []).find(p => p.tel && p.tel.replace(/\D/g, '').endsWith(num.slice(-8)));
  if (!paciente && conv?.data?.pacienteEncontrado) paciente = conv.data.pacienteEncontrado;
  const nombre = paciente?.nombre?.split(' ')[0] || conv?.data?.nombreIngresado?.split(' ')[0] || '';

  logConsulta(paciente?.nombre || '+' + num, num, body);

  // ── FILTRO DE CONTENIDO INAPROPIADO (siempre, antes de todo) ────────────────
  const nMsg = normalize(body);
  const palabrasInapropiadas = ['puta','mierda','idiota','imbecil','estupid','inutil','sexo','prostitut','porno','drogas','pedo','boludo','pelotud','concha','culo','pija','mogolico'];
  if (palabrasInapropiadas.some(p => nMsg.includes(p))) {
    await botSend(sock, jid, {
      text: `Hola, soy Aldana de One Depil. Solo puedo ayudarte con consultas sobre nuestros tratamientos y turnos. ¿Te puedo orientar en algo?`,
    });
    clearConv(jid);
    return;
  }

  // ── CONFIRMACIÓN DE TURNO ────────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.confirmar)) {
    const turnosPendientes = (data.turnos || []).filter(t =>
      t.estado === 'pendiente' && t.fecha >= today() &&
      (paciente ? t.pacienteId === paciente.id || normalize(t.paciente).includes(normalize(paciente.nombre)) : false)
    );
    if (turnosPendientes.length > 0) {
      const t = turnosPendientes[0];
      await botSend(sock, jid, {
        text: `Perfecto${nombre ? ' ' + nombre : ''}, turno confirmado para el ${fmtFecha(t.fecha)} a las ${t.hora}hs. Te esperamos.`,
      });
      await notificarEquipo(sock, `✅ *Turno confirmado*\n👤 ${paciente?.nombre || num}\n📅 ${fmtFecha(t.fecha)} ${t.hora}hs — ${t.servicio || ''}`);
    } else {
      await botSend(sock, jid, { text: `Perfecto, quedo a disposicion por cualquier consulta.` });
    }
    clearConv(jid);
    return;
  }

  // ── CANCELACIÓN ─────────────────────────────────────────────────────────────
  if (matchesAny(body, cfg.KEYWORDS.cancelar)) {
    await botSend(sock, jid, { text: `No hay problema${nombre ? ' ' + nombre : ''}, cuando puedas coordinar avisame y te busco un turno.` });
    await notificarEquipo(sock, `⚠️ *Cancelación*\n👤 ${paciente?.nombre || '+' + num}\nMensaje: "${body}"`);
    clearConv(jid);
    return;
  }

  // ── FLUJO PASO A PASO ────────────────────────────────────────────────────────

  // PASO: esperando comprobante de transferencia
  if (conv?.step === 'esperando_comprobante') {
    const { desc, monto } = conv.data;
    const tieneImagen = !!(msg.message?.imageMessage || msg.message?.documentMessage);
    const nB0 = normalize(body);
    // Detectar si quieren cancelar en lugar de pagar
    if (matchesAny(body, cfg.KEYWORDS.cancelar) || nB0.includes('no voy') || nB0.includes('cancela') || nB0.includes('dejo')) {
      await botSend(sock, jid, { text: `No hay problema, el turno queda sin reservar. Si en otro momento querés coordinar, escribime cuando quieras 😊` });
      clearConv(jid);
      return;
    }
    if (tieneImagen || body.length > 10) {
      await botSend(sock, jid, {
        text: `Perfecto, recibimos el comprobante! 🙌 Tu turno para *${desc}* queda *confirmado*. Ya te notificamos al equipo. ¡Nos vemos pronto!`,
      });
      await notificarEquipo(sock, `💰 *Seña recibida*\n👤 ${paciente?.nombre || '+' + num}\n📱 +${num}\n🔸 ${desc}\n💵 Seña: ${fmtPeso(monto)}\n⚡ Confirmar turno en la agenda`);
      clearConv(jid);
    } else {
      await botSend(sock, jid, {
        text: `Para confirmar el turno necesito el comprobante de la transferencia. Podés mandarlo como imagen o captura de pantalla desde tu app del banco 📲`,
      });
    }
    return;
  }

  // PASO: turno anotado esperando comprobante — recordatorio
  if (conv?.step === 'turno_anotado') {
    const { desc, monto } = conv.data;
    await botSend(sock, jid, {
      text: `Tu turno para ${desc} queda confirmado una vez que recibamos la seña de ${fmtPeso(monto)}. Transferí al alias *${cfg.ALIAS_PAGO}* y enviame el comprobante acá.`,
    });
    setConv(jid, 'esperando_comprobante', { desc, monto });
    return;
  }

  // PASO: mostrar slots disponibles al paciente
  if (conv?.step === 'esperando_horario') {
    const { tratamiento, tipo } = conv.data;
    const esConsulta = tipo === 'consulta';
    const tratKey = esConsulta ? 'consulta' : (tratamiento || '').toLowerCase();
    // Especialidades médicas — doctor asignado
    const ESPECIALIDAD_PROF = {
      ginecologia:    { desc: 'Consulta ginecológica — Dr. Andrés Echegaray',      profId: 'p2' },
      endocrinologia: { desc: 'Consulta endocrinológica — Dra. Laura Otiñano',     profId: 'p5' },
      suero:          { desc: 'Sueroterapia — Dr. Walter Antuña',                  profId: 'p4' },
      estetica:       { desc: 'Consulta estética médica — Dr. Rolando Ribaudo',    profId: 'p3' },
    };
    const espProf = ESPECIALIDAD_PROF[tratamiento];
    const desc = espProf ? espProf.desc : esConsulta ? `Consulta con Dra. Sabrina Quiroga` : (tratamiento || 'el tratamiento');
    const profIdTurno = espProf ? espProf.profId : esConsulta ? 'p1' : null;
    const monto = (esConsulta || espProf) ? PRECIO_CONSULTA : 40000;

    const slots = getSlotsDisponibles(tratKey, data);
    if (slots.length === 0) {
      await botSend(sock, jid, {
        text: `En este momento no tengo horarios cargados para mostrarte, pero te coordino igual. ¿Qué día y horario te quedaría mejor? Atendemos lunes a viernes de 15 a 21hs y sábados de 9 a 15hs.`,
      });
      setConv(jid, 'esperando_slot_manual', { desc, monto, tratamiento, profIdTurno });
      return;
    }

    let txt = `Mirá, estos son los turnos disponibles para *${desc}*:\n\n`;
    slots.forEach((s, i) => { txt += `*${i + 1}.* ${s.label}\n`; });
    txt += `\n¿Cuál te viene mejor? Respondé con el número 😊`;
    await botSend(sock, jid, { text: txt });
    setConv(jid, 'esperando_slot', { desc, monto, slots, tratamiento, profIdTurno });
    return;
  }

  // PASO: paciente eligió un slot
  if (conv?.step === 'esperando_slot') {
    const { desc, monto, slots } = conv.data;
    const nB = normalize(body);
    const idx = parseInt(body.trim()) - 1;
    const slot = (idx >= 0 && idx < slots.length) ? slots[idx] : null;

    const { profIdTurno } = conv.data;
    if (!slot) {
      // Cualquier texto que no sea un número se trata como horario libre escrito
      const esDia = /lunes|martes|miercoles|jueves|viernes|sabado|\d{1,2}\/\d|\d{1,2}hs|a las \d|mismo horario|misma hora/.test(nB);
      if (esDia || body.trim().length > 5) {
        await confirmarTurnoConSena(sock, jid, paciente, num, body, desc, monto, profIdTurno);
        return;
      }
      await botSend(sock, jid, { text: `Respondé con el número de la opción (1, 2, 3...) o escribí el día y hora que te convenga.` });
      return;
    }

    await confirmarTurnoConSena(sock, jid, paciente, num, `${slot.label}`, desc, monto, profIdTurno);
    return;
  }

  // PASO: horario libre escrito a mano
  if (conv?.step === 'esperando_slot_manual') {
    const { desc, monto, profIdTurno } = conv.data;
    await confirmarTurnoConSena(sock, jid, paciente, num, body, desc, monto, profIdTurno);
    return;
  }

  // PASO: esperando confirmación para arrancar con consulta (alto valor)
  if (conv?.step === 'esperando_confirmacion_consulta') {
    const { tratamiento } = conv.data;
    const nB = normalize(body);
    const confirma = matchesAny(body, ['si','sí','dale','ok','bueno','claro','perfecto','quiero','me interesa','coordina','agendame','cuando','disponible','horario','turno']);
    const objeta = nB.includes('caro') || nB.includes('pienso') || nB.includes('despues') || nB.includes('después') || nB.includes('no se') || nB.includes('no sé') || nB.includes('duda');
    if (objeta) {
      await botSend(sock, jid, {
        text: `Entiendo, no hay apuro. La consulta son $40.000 y ese monto se descuenta del tratamiento cuando arrancás — o sea que en realidad es gratis si seguís con el procedimiento.\n\nCuando quieras coordinar, escribime y te busco un turno 😊`,
      });
      clearConv(jid);
      return;
    }
    if (confirma) {
      await botSend(sock, jid, {
        text: `Dale, te busco un turno. ¿Algún día o franja horaria que te quede mejor? Atendemos lunes a viernes de 15 a 21hs y sábados de 9 a 15hs.`,
      });
      setConv(jid, 'esperando_horario', { tipo: 'consulta', precio: PRECIO_CONSULTA, tratamiento });
    } else {
      await botSend(sock, jid, {
        text: `Cuando quieras coordinar la consulta, escribime y lo armamos. ¿Hay algo más en lo que te pueda ayudar?`,
      });
      clearConv(jid);
    }
    return;
  }

  // PASO: el paciente respondió qué tratamiento le interesa
  if (conv?.step === 'esperando_tratamiento') {
    const trat = detectarTratamiento(body);
    const nB = normalize(body);

    // Paciente conocido dice "lo mismo de siempre"
    const loMismo = nB.includes('lo mismo') || nB.includes('mismo de siempre') || nB.includes('lo habitual') || nB.includes('lo de siempre');
    if (loMismo && paciente) {
      const ultimoTurno = (data.turnos || [])
        .filter(t => t.pacienteId === paciente.id && t.servicio)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
      if (ultimoTurno) {
        await botSend(sock, jid, {
          text: `Perfecto${nombre ? ' ' + nombre : ''}, te busco turno para *${ultimoTurno.servicio}* como la última vez. ¿Qué día te viene mejor? Atendemos lunes a viernes 15 a 21hs y sábados 9 a 15hs.`,
        });
        setConv(jid, 'esperando_horario', { tratamiento: ultimoTurno.servicio });
      } else {
        await botSend(sock, jid, {
          text: `Claro${nombre ? ' ' + nombre : ''}, ¿podés decirme qué tratamiento querés? No tengo registrado el anterior.`,
        });
      }
      return;
    }

    // Manejo de objeciones — "está caro", "lo pienso", "no sé si es para mí"
    const esCaro = nB.includes('caro') || nB.includes('mucho') || nB.includes('muy caro') || nB.includes('no llego') || nB.includes('no tengo plata');
    const loPiensa = nB.includes('lo pienso') || nB.includes('voy a pensar') || nB.includes('despues te aviso') || nB.includes('después te aviso') || nB.includes('en otro momento') || nB.includes('lo veo') || nB.includes('ya te aviso');
    const tieneDudas = nB.includes('no se si') || nB.includes('no sé si') || nB.includes('no estoy segur') || nB.includes('tengo dudas') || nB.includes('no se para') || nB.includes('sirve para mi') || nB.includes('sirve para mí');

    if (esCaro) {
      await botSend(sock, jid, {
        text: `Entendemos que los precios importan. Lo que te puedo decir es que trabajamos con profesionales médicos y tecnología de primera — no es una estética común.\n\nTambién tenemos combos y opciones de pago. ¿Querés que veamos alguna alternativa que se adapte a lo que buscás?`,
      });
      setConv(jid, 'esperando_tratamiento', conv?.data);
      return;
    }

    if (loPiensa) {
      await botSend(sock, jid, {
        text: `Dale, sin problema! Cuando estés lista/o escribime y te coordino el turno.\n\nSolo te digo que los turnos se llenan bastante, así que si tenés alguna fecha en mente conviene reservar con anticipación. ¡Cualquier consulta estoy acá! 😊`,
      });
      clearConv(jid);
      return;
    }

    if (tieneDudas) {
      await botSend(sock, jid, {
        text: `Normal tener dudas, es algo que te hacés en el cuerpo. Por eso siempre recomendamos arrancar con una consulta con la Dra. Sabrina o con el Dr. Ribaudo — te evalúan, te cuentan qué esperás del tratamiento y si es lo indicado para vos.\n\n¿Querés coordinar una consulta para salir de la duda?`,
      });
      setConv(jid, 'esperando_confirmacion_consulta', { tratamiento: trat || 'consulta' });
      return;
    }

    // Preguntas sobre sesiones / cuánto dura / cuántas veces
    const preguntaSesiones = nB.includes('cuantas sesiones') || nB.includes('cuántas sesiones') || nB.includes('cuanto dura') || nB.includes('cuánto dura') || nB.includes('cuantas veces') || nB.includes('cada cuanto');
    if (preguntaSesiones) {
      const respSesiones = trat === 'depilacion'
        ? `Para depilación láser generalmente se hacen entre 6 y 10 sesiones espaciadas cada 4-8 semanas según la zona. Los resultados son permanentes en el vello tratado. ¿Qué zona te interesa?`
        : trat === 'botox' || trat === 'endolift' || trat === 'hifu'
        ? `Los resultados de este tratamiento duran entre 6 meses y 1 año según el caso. La Dra. Sabrina te da el detalle exacto en la consulta previa, que es el primer paso. ¿La coordinamos?`
        : `Depende del tratamiento y del caso particular. La mejor forma de saberlo es en la consulta con la Dra. Sabrina, donde te arma el protocolo a medida. ¿Querés que coordinemos eso?`;
      await botSend(sock, jid, { text: respSesiones });
      if (trat) setConv(jid, 'esperando_confirmacion_consulta', { tratamiento: trat });
      return;
    }

    // Detección de frustración o confusión
    const estaConfundido = (nB.includes('no sabes') || nB.includes('no entiendo') || (nB.includes('que') && body.endsWith('?') && body.length < 15)) && !trat;
    if (estaConfundido) {
      await botSend(sock, jid, {
        text: `Disculpá! Te cuento las opciones para que sea más fácil:\n\n• Depilación láser\n• Tratamientos faciales (Endolift, Botox, Endymed, HIFU)\n• Reducción corporal (Criolipólisis, enCurve, CM Slim)\n• Consulta estética — Dra. Sabrina Quiroga\n• Consulta estética médica — Dr. Rolando Ribaudo\n• Ginecología — Dr. Andrés Echegaray\n• Endocrinología / descenso de peso — Dra. Laura Otiñano\n• Sueroterapia — Dr. Walter Antuña\n\n¿Cuál te interesa?`,
      });
      return;
    }

    const esConsultaDirecta = nB.includes('consulta') || nB.includes('sabrina') || nB.includes('agend');

    // Preguntas sobre precios, promos o información general
    const esPrecio = nB.includes('precio') || nB.includes('cuanto sale') || nB.includes('cuanto cuesta') || nB.includes('cuanto cobran') || nB.includes('cuanto es') || nB.includes('valor') || nB.includes('costo');
    const esPromo = nB.includes('promo') || nB.includes('descuento') || nB.includes('oferta') || nB.includes('combo') || nB.includes('paquete');
    const esCuerpoCompleto = nB.includes('cuerpo completo') || nB.includes('cuerpo entero') || nB.includes('todo el cuerpo');
    const esZonaDepil = nB.includes('axila') || nB.includes('bikini') || nB.includes('pierna') || nB.includes('brazo') || nB.includes('espalda') || nB.includes('abdomen') || nB.includes('bozo') || nB.includes('cavado') || nB.includes('gluteo') || nB.includes('rostro') || nB.includes('labio') || nB.includes('zona');

    if (esCuerpoCompleto && (esPrecio || esPromo || trat === 'depilacion' || nB.includes('depil'))) {
      await botSend(sock, jid, { text: `Para depilación de cuerpo completo armamos combos según las zonas que necesitás. Los más pedidos:\n\n• *Combo Mujer 1* — Axilas + Cavado + Tiro de Cola\n• *Combo Mujer 2* — Axilas + Cavado + ½ Pierna\n• *Combo Mujer 3* — Axilas + Cavado + TdC + Pierna completa\n\nTambién podés armar tu combo con las zonas que quieras y te damos precio especial. ¿Qué zonas tenés en mente?` });
      setConv(jid, 'esperando_tratamiento', conv?.data);
      return;
    }

    if ((esPrecio || esPromo) && (trat === 'depilacion' || esZonaDepil || nB.includes('depil'))) {
      await botSend(sock, jid, { text: `Los precios de depilación láser van por zona:\n\n• Axilas — $22.000\n• Cavado — $23.000\n• Media pierna — $22.000\n• Pierna completa — $26.500\n• Bozo — $12.650\n\nHaciendo varias zonas juntas te armamos un combo con descuento. ¿Qué zonas te interesan?` });
      setConv(jid, 'esperando_tratamiento', conv?.data);
      return;
    }

    if (esPrecio || esPromo) {
      await botSend(sock, jid, { text: `Los precios dependen del tratamiento. ¿Sobre cuál querés consultar?\n\n• Depilación láser\n• Tratamientos faciales (Botox, Endolift, Endymed, HIFU)\n• Reducción corporal (Criolipólisis, enCurve, CM Slim)\n• Consultas médicas — $40.000\n• Sueroterapia` });
      setConv(jid, 'esperando_tratamiento', conv?.data);
      return;
    }

    // Especialidades médicas van directo a agendar (no pasan por alto valor)
    const ESPECIALIDADES = ['ginecologia','endocrinologia','estetica','suero'];
    if (trat && ESPECIALIDADES.includes(trat)) {
      await botSend(sock, jid, { text: INFO_TRATAMIENTOS[trat] });
      setConv(jid, 'esperando_confirmacion_consulta', { tratamiento: trat });
    } else if (trat && INFO_TRATAMIENTOS[trat]) {
      await botSend(sock, jid, { text: INFO_TRATAMIENTOS[trat] });
      if (esAltoValor(trat)) {
        setConv(jid, 'esperando_confirmacion_consulta', { tratamiento: trat });
      } else {
        setConv(jid, 'esperando_horario', { tratamiento: trat });
      }
    } else if (esConsultaDirecta) {
      await botSend(sock, jid, {
        text: `Dale, te busco los horarios disponibles para una consulta con la Dra. Sabrina.`,
      });
      setConv(jid, 'esperando_horario', { tipo: 'consulta', precio: PRECIO_CONSULTA, tratamiento: 'Consulta con Dra. Sabrina Quiroga' });
    } else {
      await botSend(sock, jid, {
        text: `Te puedo ayudar con:\n\n• Depilación láser\n• Tratamientos faciales (Botox, Endolift, Endymed, HIFU)\n• Reducción corporal (Criolipólisis, enCurve, CM Slim)\n• Consultas médicas (Dra. Sabrina, Dr. Ribaudo, Ginecología, Endocrinología, Sueroterapia)\n• Precios e información\n\n¿Cuál te interesa?`,
      });
    }
    return;
  }

  // PASO: paciente respondió si es primera vez
  if (conv?.step === 'esperando_primera_vez') {
    const esPrimera = matchesAny(body, ['si','sí','primera vez','primera','nuevo','nueva','nunca','no conozco']);
    setConv(jid, 'esperando_tratamiento');

    if (esPrimera) {
      await botSend(sock, jid, {
        text: `Bienvenida/o a One Depil! Somos una clínica médico-estética en San Juan. Trabajamos con la Dra. Sabrina Quiroga y un equipo de profesionales médicos.\n\nTenemos depilación láser, tratamientos faciales, reducción corporal, y también consultas de ginecología, endocrinología y sueroterapia. ¿Tenés algo en mente o querés que te oriente?`,
      });
    } else {
      await botSend(sock, jid, {
        text: `Hola${nombre ? ' ' + nombre : ''}, qué bueno que nos escribís de nuevo! ¿En qué te puedo ayudar hoy?`,
      });
    }
    return;
  }

  // ── RECOMENDACIÓN POR ZONA / OBJETIVO ────────────────────────────────────────
  const nBody = normalize(body);
  const quiereRecomendacion = nBody.includes('que me recomiendas') || nBody.includes('que tratamiento') || nBody.includes('que me recomendas') || nBody.includes('cual me recomiendas') || nBody.includes('que opcion') || nBody.includes('por donde empiezo') || nBody.includes('no se por donde');
  if (quiereRecomendacion) {
    let resp = '';
    if (nBody.includes('abdomen') || nBody.includes('panza') || nBody.includes('barriga') || nBody.includes('vientre')) {
      resp = `Para reducir abdomen tenemos tres opciones, según el objetivo:\n\n• *Criolipólisis* — elimina grasa de forma definitiva (sin cirugía, sin recuperación)\n• *enCurve* — radiofrecuencia que reduce y remodela\n• *CM Slim* — tonifica músculo y reduce grasa al mismo tiempo\n\nLo más recomendable es una consulta con la Dra. Sabrina para que evalúe tu caso. La consulta son $40.000 y se descuentan del tratamiento. ¿Te interesa coordinarla?`;
    } else if (nBody.includes('rostro') || nBody.includes('cara') || nBody.includes('facial') || nBody.includes('arrugas') || nBody.includes('flacidez')) {
      resp = `Para el rostro depende de qué querés mejorar:\n\n• *Endolift* — tensa y define el óvalo, muy natural\n• *Endymed Intensif+FSR* — firmeza, textura y poros\n• *HIFU* — lifting progresivo sin agujas ni cirugía\n• *Botox* — suaviza líneas de expresión\n\nSi querés una evaluación personalizada, te coordino una consulta con la Dra. Sabrina. ¿Te interesa?`;
    } else if (nBody.includes('celulitis') || nBody.includes('cartuchera') || nBody.includes('flanco') || nBody.includes('muslo')) {
      resp = `Para celulitis y cartucheras las mejores opciones son:\n\n• *Criolipólisis* — reduce volumen de grasa\n• *Mesoterapia corporal* — mejora textura y circulación\n• *enCurve* — remodela y afirma\n\nUna consulta con la Dra. Sabrina te ayuda a elegir el que más te conviene. ¿La coordinamos?`;
    } else if (nBody.includes('gluteo') || nBody.includes('glúteo') || nBody.includes('cola')) {
      resp = `Para glúteos el *CM Slim* es excelente — tonifica y da volumen muscular sin cirugía. Hace el equivalente a miles de contracciones en una sola sesión.\n\n¿Querés que te coordine un turno para probarlo?`;
    } else if (nBody.includes('manchas') || nBody.includes('poros') || nBody.includes('acne') || nBody.includes('acné')) {
      resp = `Para manchas, poros y acné tenemos:\n\n• *Alquimia* — peeling médico de renovación profunda, el más completo\n• *Peeling químico* — para manchas específicas\n• *Endymed FSR* — mejora textura y poros de forma progresiva\n\nEl Alquimia es muy bueno para resultados rápidos. ¿Te cuento más de ese?`;
    } else {
      resp = `Contame — ¿qué zona o qué resultado querés lograr? Con eso te oriento mucho mejor. Por ejemplo: ¿es para el rostro, el cuerpo, depilación, algo médico?`;
    }
    await botSend(sock, jid, { text: resp });
    setConv(jid, 'esperando_tratamiento');
    return;
  }

  // ── IDENTIFICACIÓN DE NOMBRE (antes de detectar tratamientos) ───────────────
  if (conv?.step === 'esperando_identificacion') {
    const nombreIngresado = body.trim();
    const pareceNombre = /^[a-záéíóúüñ\s]{3,}$/i.test(nombreIngresado);
    if (!pareceNombre) {
      await botSend(sock, jid, { text: `¿Me decís tu nombre y apellido para buscarte?` });
      return;
    }
    const encontrado = (data.pacientes || []).find(p =>
      normalize(p.nombre).includes(normalize(nombreIngresado)) ||
      (p.tel && p.tel.replace(/\D/g,'').includes(nombreIngresado.replace(/\D/g,'')))
    );
    if (encontrado) {
      const primerNombre = encontrado.nombre.split(' ')[0];
      const ventas = encontrado.ventas ? ` (historial: $${Number(encontrado.ventas).toLocaleString('es-AR')})` : '';
      await notificarEquipo(sock, `👤 *Paciente reconocido*\n*${encontrado.nombre}* (+${num})${ventas}\n🔔 Consultando por WhatsApp`);
      const ultimoT = (data.turnos || []).filter(t => t.pacienteId === encontrado.id).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha))[0];
      const historialT = ultimoT ? ` La última vez viniste para ${ultimoT.servicio}.` : '';
      await botSend(sock, jid, { text: `Hola ${primerNombre}! Soy Aldana de One Depil 😊${historialT} ¿En qué te puedo ayudar hoy?` });
      setConv(jid, 'esperando_tratamiento', { pacienteEncontrado: encontrado });
    } else {
      const primerNombre = nombreIngresado.split(' ')[0];
      await botSend(sock, jid, { text: `Hola ${primerNombre}! No te encuentro en el sistema todavía, pero te ayudo igual. ¿Sobre qué tratamiento querés consultar?` });
      setConv(jid, 'esperando_tratamiento', { nombreIngresado });
    }
    return;
  }

  // ── DETECCIÓN DE TRATAMIENTO ──────────────────────────────────────────────
  const tratamientoDirecto = detectarTratamiento(body);
  if (tratamientoDirecto) {
    if (INFO_TRATAMIENTOS[tratamientoDirecto]) {
      await botSend(sock, jid, { text: INFO_TRATAMIENTOS[tratamientoDirecto] });
      if (esAltoValor(tratamientoDirecto)) {
        setConv(jid, 'esperando_confirmacion_consulta', { tratamiento: tratamientoDirecto });
      } else {
        setConv(jid, 'esperando_horario', { tratamiento: tratamientoDirecto });
      }
    } else {
      await botSend(sock, jid, {
        text: `${saludoHora()}${nombre ? ' ' + nombre : ''}, te habla Aldana de One Depil. Consultame lo que necesitás que te ayudo.`,
      });
      setConv(jid, 'esperando_tratamiento');
    }
    return;
  }

  // ── INICIO DEL FLUJO (saludo o primer mensaje sin conversación activa) ────────
  const esSaludo = matchesAny(body, cfg.KEYWORDS.saludo);
  const quiereTurno = matchesAny(body, cfg.KEYWORDS.turno);
  const quierePrecios = matchesAny(body, cfg.KEYWORDS.precios);
  const quiereServicios = matchesAny(body, cfg.KEYWORDS.servicios);
  const nB2 = normalize(body);
  const loMismoSinConv = nB2.includes('lo mismo') || nB2.includes('mismo de siempre') || nB2.includes('lo de siempre');

  // Horario y ubicación solo cuando no hay flujo activo
  if (!conv && matchesAny(body, cfg.KEYWORDS.horario)) {
    await botSend(sock, jid, { text: `Atendemos lunes a viernes de 15 a 21hs y sábados de 9 a 15hs. Estamos en ${cfg.CLINICA.direccion}. ¿Querés que coordinemos un turno?` });
    return;
  }
  if (!conv && matchesAny(body, cfg.KEYWORDS.ubicacion)) {
    await botSend(sock, jid, { text: `Estamos en el Pase de Compras de Ayres Village Open Mall, San Juan 📍 Atendemos lunes a viernes 15 a 21hs y sábados 9 a 15hs. ¿Venís por primera vez?` });
    return;
  }

  if (quiereTurno || loMismoSinConv) {
    // "lo mismo de siempre" con paciente conocido
    if (loMismoSinConv && paciente) {
      const ultimoTurno = (data.turnos || [])
        .filter(t => t.pacienteId === paciente.id && t.servicio)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
      if (ultimoTurno) {
        await botSend(sock, jid, { text: `Perfecto${nombre ? ' ' + nombre : ''}, te busco turno para *${ultimoTurno.servicio}* como la última vez.` });
        setConv(jid, 'esperando_horario', { tratamiento: ultimoTurno.servicio });
        return;
      }
    }
    // Mensaje con día/hora incluido
    const tieneDia = /lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|\d{1,2}\/\d{1,2}|\d{1,2}hs|a las \d/.test(nB2);
    if (tieneDia) {
      await confirmarTurnoConSena(sock, jid, paciente, num, body, 'el turno solicitado', 40000);
    } else {
      await botSend(sock, jid, { text: `${nombre ? nombre + ', ¿q' : '¿Q'}ué tratamiento o consulta querés hacer?` });
      setConv(jid, 'esperando_tratamiento');
    }
    return;
  }

  if (quierePrecios) {
    await botSend(sock, jid, { text: `Los precios varían según el tratamiento. ¿Sobre cuál querés saber?\n\n• Depilación láser\n• Tratamientos faciales (Botox, Endolift, Endymed, HIFU)\n• Reducción corporal (Criolipólisis, enCurve, CM Slim)\n• Consultas médicas — $40.000\n• Sueroterapia` });
    setConv(jid, 'esperando_tratamiento');
    return;
  }

  if (quiereServicios) {
    await botSend(sock, jid, {
      text: `En One Depil hacemos:\n\n💎 *Tecnología médica*\nEndolift · Endymed · HIFU · Criolipólisis · enCurve · CM Slim\n\n✨ *Estética facial*\nBotox · PRP · Mesoterapia · Alquimia · Peeling · Limpiezas · EndyEyes\n\n🌸 *Depilación*\nLáser definitiva Mediostar — todas las zonas\n\n🩺 *Consultas médicas*\nEstética (Dra. Sabrina / Dr. Ribaudo) · Ginecología · Endocrinología · Sueroterapia\n\n¿Hay alguno que te interesa?`,
    });
    setConv(jid, 'esperando_tratamiento');
    return;
  }


  if (esSaludo || !conv) {
    if (paciente) {
      const primerNombre = paciente.nombre.split(' ')[0];
      const ultimoTurno = (data.turnos || [])
        .filter(t => t.pacienteId === paciente.id)
        .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
      const historial = ultimoTurno ? ` La última vez viniste para ${ultimoTurno.servicio || 'un tratamiento'}.` : '';
      await botSend(sock, jid, {
        text: `${saludoHora()} ${primerNombre}! Soy Aldana de One Depil.${historial} ¿En qué te puedo ayudar hoy?`,
      });
      setConv(jid, 'esperando_tratamiento', { pacienteEncontrado: paciente });
    } else {
      await botSend(sock, jid, {
        text: `${saludoHora()}! Soy Aldana, coordinadora de One Depil 🌸 ¿Me decís tu nombre y apellido para ver si ya tenés historial con nosotros?`,
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

  const BOT_START_TS = Math.floor(Date.now() / 1000); // timestamp de arranque en segundos

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid || jid.endsWith('@g.us')) continue;

      // Ignorar mensajes históricos anteriores al arranque del bot
      const msgTs = msg.messageTimestamp || 0;
      if (Number(msgTs) < BOT_START_TS) continue;

      // Mensaje saliente: determinar si lo envió el bot o un humano
      if (msg.key.fromMe) {
        const msgId = msg.key.id;
        if (botMsgIds.has(msgId)) {
          botMsgIds.delete(msgId);
        } else {
          // Mensaje enviado manualmente por el operador humano
          humanoCargo(jid);
          clearConv(jid);
          console.log(`👤 [HUMANO] Tomó el control de ${jid}`);
        }
        continue;
      }

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
