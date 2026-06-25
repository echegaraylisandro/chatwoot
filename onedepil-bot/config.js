module.exports = {
  CLINICA: {
    nombre: 'ONE DEPIL',
    profesional: 'Dra. Sabrina Quiroga',
    direccion: 'Pase de Compras, Ayres Village Open Mall, San Juan',
    horario: 'Lunes a Viernes 15 a 21hs · Sábados 9 a 15hs',
    instagram: '@onedepil_oficial',
    wa: '5492646725551',
  },

  ADMIN_WA: '5492646725551@s.whatsapp.net',

  // Equipo operativo — recibe alertas de consultas y turnos
  EQUIPO: [
    { nombre: 'Aldana',   wa: '5492645635397@s.whatsapp.net' },
    { nombre: 'Gerardo',  wa: '5493825414533@s.whatsapp.net' },
  ],

  // Dirección — reciben reportes financieros (NO Aldana)
  DIRECCION: [
    { nombre: 'Sabrina',  wa: '5492645884052@s.whatsapp.net' },
    { nombre: 'Gerardo',  wa: '5493825414533@s.whatsapp.net' },
    { nombre: 'Lisandro', wa: '5492613339961@s.whatsapp.net' },
  ],

  // Aldana por separado para avisos de deudores
  ALDANA_WA: '5492645635397@s.whatsapp.net',

  DATA_FILE: './data.json',

  CRON_RECORDATORIOS:   '0 10 * * *',       // recordatorios turnos — 10am todos los días
  CRON_BRIEFING:        '0 9 * * 1-6',       // agenda del día — 9am lunes a sábado
  CRON_REPORTE:         '*/30 10-21 * * 1-6', // resumen consultas — cada 30min de 10 a 21hs
  CRON_CIERRE:          '15 21 * * 1-6',     // cierre financiero diario — 21:15hs lunes a sábado
  CRON_DEUDORES:        '0 10 * * 1',        // alerta deudores — lunes 10am

  KEYWORDS: {
    turno:    ['turno','turnos','sacar turno','quiero turno','reservar','agenda','agendar','saco','quiero sacar'],
    precios:  ['precio','precios','cuánto','cuanto','costo','costos','valores','tarifa','sale','cuanto sale','cuanto cuesta','cuesta'],
    horario:  ['horario','horarios','atienden','abren','cierran','cuando atienden','que dias'],
    ubicacion:['donde','dónde','dirección','ubicación','como llegar','ayres','direccion','quedan','estan'],
    servicios:['servicios','que hacen','que ofrecen','tienen','ofrecen','realizan','que tratamientos','tratamientos tienen','que hacen ahi'],
    confirmar:['confirmo','confirmar','si confirmo','voy','ahi voy','ahi estoy','confirme','ahi estare'],
    cancelar: ['cancelo','cancelar','no puedo','no voy','no puedo ir','no voy a poder'],
    saludo:   ['hola','buenas','buenos dias','buenas tardes','buenas noches','hi','hello','buen dia','como estan'],
  },
};
