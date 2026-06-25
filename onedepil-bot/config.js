module.exports = {
  CLINICA: {
    nombre: 'ONE DEPIL',
    profesional: 'Dra. Sabrina Quiroga',
    direccion: 'Pase de Compras, Ayres Village Open Mall, San Juan',
    horario: 'Lunes a Viernes 15 a 21hs · Sábados 9 a 15hs',
    instagram: '@onedepil_oficial',
    wa: '5492646725551',
  },

  // Admin principal (Sabrina / clínica)
  ADMIN_WA: '5492646725551@s.whatsapp.net',

  // Equipo que recibe reportes cada 30 minutos
  EQUIPO: [
    { nombre: 'Aldana', wa: '5492645635397@s.whatsapp.net' },
    { nombre: 'Gerardo', wa: '5493825414533@s.whatsapp.net' },
  ],

  // Archivo donde el dashboard exporta los datos
  DATA_FILE: './data.json',

  // Recordatorios de turno: todos los días a las 10am
  CRON_RECORDATORIOS: '0 10 * * *',

  // Briefing matutino para el equipo: lunes a sábado a las 9am
  CRON_BRIEFING: '0 9 * * 1-6',

  // Reporte de consultas cada 30 min de 10 a 21hs, lunes a sábado
  CRON_REPORTE: '*/30 10-21 * * 1-6',

  KEYWORDS: {
    turno:    ['turno','turnos','sacar turno','quiero turno','reservar','agenda','agendar','saco','quiero sacar'],
    precios:  ['precio','precios','cuánto','cuanto','costo','costos','valores','tarifa','sale','cuanto sale','cuanto cuesta','cuesta'],
    horario:  ['horario','horarios','atienden','abren','cierran','cuando atienden','que dias'],
    ubicacion:['donde','dónde','dirección','ubicación','como llegar','ayres','direccion','quedan','estan'],
    servicios:['servicios','tratamientos','que hacen','que ofrecen','depilacion','botox','laser','endolift','tienen','ofrecen','realizan'],
    confirmar:['confirmo','confirmar','si confirmo','voy','ahi voy','ahi estoy','confirme','ahi estare'],
    cancelar: ['cancelo','cancelar','no puedo','no voy','no puedo ir','no voy a poder'],
    saludo:   ['hola','buenas','buenos dias','buenas tardes','buenas noches','hi','hello','buen dia','como estan'],
  },
};
