/**
 * 后端文件日志模块
 * 按天滚动，写到 server/logs/ 目录
 * 记录：连接/断开（含原因）、命令执行失败、任务进度、API 错误
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/** 当前日期字符串 YYYY-MM-DD */
function dateStr(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** 时间戳字符串 HH:mm:ss.SSS */
function timeStr(d = new Date()) {
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

/** 获取/创建当天日志文件的写入流 */
let _currentDate = '';
let _stream = null;

function getStream() {
  const today = dateStr();
  if (_currentDate === today && _stream && !_stream.destroyed) {
    return _stream;
  }
  // 关闭旧流
  if (_stream && !_stream.destroyed) {
    _stream.end();
  }
  _currentDate = today;
  const logFile = path.join(LOG_DIR, `${today}.log`);
  _stream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf8' });
  _stream.on('error', (err) => {
    console.error('[Logger] 写入日志文件失败:', err.message);
  });
  return _stream;
}

/**
 * 写一行日志到文件 + console
 * @param {'INFO'|'WARN'|'ERROR'|'CONN'|'DISC'|'TASK'|'CMD'} level
 * @param {string} tag - 模块标识，如 ConnMgr, TaskRunner, API
 * @param {string} message
 * @param {object} [extra] - 附加数据（JSON 序列化）
 */
function log(level, tag, message, extra) {
  const now = new Date();
  const ts = `${dateStr(now)} ${timeStr(now)}`;
  const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
  const line = `[${ts}] [${level}] [${tag}] ${message}${extraStr}\n`;

  // 写文件
  try {
    getStream().write(line);
  } catch (e) { /* ignore */ }

  // 同时输出到 console（pm2 会捕获）
  if (level === 'ERROR') {
    console.error(line.trimEnd());
  } else {
    console.log(line.trimEnd());
  }
}

const logger = {
  info: (tag, msg, extra) => log('INFO', tag, msg, extra),
  warn: (tag, msg, extra) => log('WARN', tag, msg, extra),
  error: (tag, msg, extra) => log('ERROR', tag, msg, extra),

  /** 连接建立 */
  connected: (tokenId, tokenName) => {
    log('CONN', 'ConnMgr', `连接建立: ${tokenName}`, { tokenId });
  },

  /** 连接断开（含原因） */
  disconnected: (tokenId, tokenName, code, reason) => {
    log('DISC', 'ConnMgr', `连接断开: ${tokenName} | code=${code} reason=${reason || '无'}`, { tokenId, code, reason });
  },

  /** 用户主动断开 */
  userDisconnect: (tokenId, tokenName) => {
    log('DISC', 'ConnMgr', `用户主动断开: ${tokenName}`, { tokenId });
  },

  /** 连接错误 */
  connectionError: (tokenId, tokenName, error) => {
    log('ERROR', 'ConnMgr', `连接错误: ${tokenName} | ${error}`, { tokenId });
  },

  /** 命令执行失败 */
  commandFailed: (tokenId, cmd, error) => {
    log('ERROR', 'Command', `命令失败: ${cmd} | ${error}`, { tokenId });
  },

  /** 命令执行成功（可选，默认不开） */
  commandSuccess: (tokenId, cmd) => {
    log('INFO', 'Command', `命令成功: ${cmd}`, { tokenId });
  },

  /** 任务开始 */
  taskStart: (tokenId, taskName) => {
    log('TASK', 'TaskRunner', `任务开始: ${taskName}`, { tokenId });
  },

  /** 任务结束 */
  taskEnd: (tokenId, taskName, status, duration) => {
    log('TASK', 'TaskRunner', `任务结束: ${taskName} | status=${status} | ${duration}ms`, { tokenId, status, duration });
  },

  /** 任务步骤失败 */
  taskStepFailed: (tokenId, step, error) => {
    log('ERROR', 'TaskRunner', `任务步骤失败: ${step} | ${error}`, { tokenId });
  },

  /** API 请求错误 */
  apiError: (method, path, error) => {
    log('ERROR', 'API', `${method} ${path} | ${error}`);
  },

  /** 获取日志目录路径 */
  getLogDir: () => LOG_DIR,
};

module.exports = logger;
