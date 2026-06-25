module.exports = {
  apps: [{
    name: 'aldana',
    script: 'bot.js',
    cwd: '/root/onedepil-bot',
    restart_delay: 5000,
    max_restarts: 10,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      TZ: 'America/Argentina/San_Juan',
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/root/onedepil-bot/logs/error.log',
    out_file: '/root/onedepil-bot/logs/output.log',
    merge_logs: true,
  }],
};
