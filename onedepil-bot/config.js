module.exports = {
  CLINICA: {
    nombre: 'ONE DEPIL',
    profesional: 'Dra. Sabrina Quiroga',
    direccion: 'Pase de Compras, Ayres Village Open Mall, San Juan',
    horario: 'Lunes a Viernes 15 a 21hs · Sábados 9 a 15hs',
    instagram: '@onedepil_oficial',
    wa: '5492646725551',
  },

  // Número del admin que recibe notificaciones del bot (mismo número de la clínica)
  ADMIN_WA: '5492646725551@s.whatsapp.net',

  // Archivo donde el dashboard exporta los datos (copialo al lado del bot)
  DATA_FILE: './data.json',

  // Horario de envío automático de recordatorios (cron syntax)
  // Default: todos los días a las 10:00am
  CRON_RECORDATORIOS: '0 10 * * *',

  // Horario del briefing matutino para el admin
  CRON_BRIEFING: '0 8 * * 1-6',

  // Palabras clave que activan respuesta automática
  KEYWORDS: {
    turno:    ['turno','turnos','sacar turno','quiero turno','reservar','agenda','agendar'],
    precios:  ['precio','precios','cuánto','cuanto','costo','costos','valores','tarifa'],
    horario:  ['horario','horarios','atienden','abren','cierran','cuando atienden'],
    ubicacion:['donde','dónde','dirección','ubicación','como llegar','ayres'],
    servicios:['servicios','tratamientos','que hacen','que ofrecen','depilacion','botox','laser','endolift'],
    confirmar:['confirmo','confirmar','si confirmo','voy','ahi voy','ahi estoy'],
    cancelar: ['cancelo','cancelar','no puedo','no voy','no puedo ir'],
    saludo:   ['hola','buenas','buenos dias','buenas tardes','buenas noches','hi','hello'],
  },
};
